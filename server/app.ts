import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import express from "express";
import type { AuthenticatedUser, CampaignConfig, CampaignDataset } from "../src/domain/types.js";
import { campaignMeta, dashboardForUser } from "../src/server/scope.js";

interface StoredCampaign {
  id: string;
  campaignName: string;
  createdAt: string;
  updatedAt: string;
  activeRevisionId: string;
  revisions: StoredCampaignRevision[];
}

interface StoredCampaignRevision {
  id: string;
  revisionNumber: number;
  createdAt: string;
  dataset: CampaignDataset;
}

interface OfcAccount {
  ofc: string;
  userId: string;
  password: string;
}

interface AppDb {
  campaigns: StoredCampaign[];
  ofcAccounts: OfcAccount[];
}

const adminId = process.env.ADMIN_ID || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "admin";
const syncTokenSecret = process.env.SYNC_TOKEN_SECRET || `${adminId}:${adminPassword}`;
const sessionSecret = process.env.SESSION_SECRET || syncTokenSecret;
const sessionTtlMs = Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const syncTokenTtlMs = Number(process.env.SYNC_TOKEN_TTL_MS || 5 * 60 * 1000);
const defaultDataDir = process.env.VERCEL ? path.join(os.tmpdir(), "gs-dashboard-data") : path.join(process.cwd(), "data");
const dataDir = process.env.DATA_DIR || defaultDataDir;
const dbPath = path.join(dataDir, "app-db.json");
const sessions = new Map<string, AuthenticatedUser>();
const usedSyncTokens = new Map<string, number>();
// Request body encodings the API accepts. gzip is what the Local Agent uses for
// Snapshot uploads; identity keeps every other client and manual call working.
const supportedRequestEncodings = new Set(["identity", "gzip", "deflate"]);

function emptyDb(): AppDb {
  return { campaigns: [], ofcAccounts: [] };
}

function normalizeStoredCampaign(raw: unknown): StoredCampaign | undefined {
  const item = raw as Partial<StoredCampaign> & { dataset?: CampaignDataset };
  if (!item) return undefined;

  if (Array.isArray(item.revisions) && item.revisions.length > 0) {
    const revisions = item.revisions
      .filter((revision): revision is StoredCampaignRevision => Boolean(revision?.dataset))
      .map((revision, index) => ({
        id: revision.id || crypto.randomUUID(),
        revisionNumber: revision.revisionNumber || index + 1,
        createdAt: revision.createdAt || revision.dataset.createdAt || new Date().toISOString(),
        dataset: revision.dataset,
      }));
    if (!revisions.length) return undefined;
    const activeRevisionId = item.activeRevisionId && revisions.some((revision) => revision.id === item.activeRevisionId)
      ? item.activeRevisionId
      : revisions[0].id;
    const active = revisions.find((revision) => revision.id === activeRevisionId) ?? revisions[0];
    return {
      id: item.id || active.dataset.config.campaignId,
      campaignName: item.campaignName || active.dataset.config.campaignName,
      createdAt: item.createdAt || revisions[revisions.length - 1]?.createdAt || active.createdAt,
      updatedAt: item.updatedAt || active.createdAt,
      activeRevisionId,
      revisions,
    };
  }

  if (!item.dataset) return undefined;
  const revisionId = item.id || crypto.randomUUID();
  const campaignId = item.dataset.config.campaignId || item.id || crypto.randomUUID();
  const dataset = {
    ...item.dataset,
    config: { ...item.dataset.config, campaignId },
  };
  return {
    id: campaignId,
    campaignName: dataset.config.campaignName,
    createdAt: dataset.createdAt,
    updatedAt: dataset.createdAt,
    activeRevisionId: revisionId,
    revisions: [{ id: revisionId, revisionNumber: 1, createdAt: dataset.createdAt, dataset }],
  };
}

function normalizeDb(raw: unknown): AppDb {
  const parsed = raw as Partial<AppDb> | undefined;
  return {
    campaigns: (parsed?.campaigns ?? []).map(normalizeStoredCampaign).filter((campaign): campaign is StoredCampaign => Boolean(campaign)),
    ofcAccounts: parsed?.ofcAccounts ?? [],
  };
}

function readDb(): AppDb {
  if (!fs.existsSync(dbPath)) return emptyDb();
  return normalizeDb(JSON.parse(fs.readFileSync(dbPath, "utf8")));
}

function writeDb(db: AppDb) {
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = `${dbPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, dbPath);
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index < 0 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signPayload(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function issueSessionCookie(user: AuthenticatedUser) {
  const now = Date.now();
  const payload = base64UrlJson({ user, iat: now, exp: now + sessionTtlMs });
  return `${payload}.${signPayload(payload, sessionSecret)}`;
}

function verifySessionCookie(value: string | undefined) {
  if (!value?.includes(".")) return undefined;
  const [payload, signature] = value.split(".");
  const expected = signPayload(payload, sessionSecret);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { user?: AuthenticatedUser; exp?: number };
    if (!parsed.user || !parsed.exp || parsed.exp <= Date.now()) return undefined;
    return parsed.user;
  } catch {
    return undefined;
  }
}

function sessionFromRequest(req: express.Request) {
  const sid = parseCookies(req.headers.cookie).sid;
  if (!sid) return undefined;
  return sessions.get(sid) || verifySessionCookie(sid);
}

function setSession(res: express.Response, user: AuthenticatedUser) {
  const sid = issueSessionCookie(user);
  sessions.set(sid, user);
  res.cookie("sid", sid, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
}

function clearSession(req: express.Request, res: express.Response) {
  const sid = parseCookies(req.headers.cookie).sid;
  if (sid) sessions.delete(sid);
  res.clearCookie("sid");
}

function requireUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = sessionFromRequest(req);
  if (!user) return res.status(401).json({ error: "로그인이 필요합니다." });
  res.locals.user = user;
  next();
}

function requireAdmin(_req: express.Request, res: express.Response, next: express.NextFunction) {
  if ((res.locals.user as AuthenticatedUser | undefined)?.role !== "admin") {
    return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  }
  next();
}

function resolveCampaignId(config: CampaignConfig) {
  const explicitId = config.campaignId?.trim();
  if (explicitId) return explicitId;
  const nameKey = config.campaignName?.trim().replace(/\s+/g, "-");
  return nameKey ? `campaign:${nameKey}` : crypto.randomUUID();
}

function pruneUsedSyncTokens(now = Date.now()) {
  for (const [jti, expiresAt] of usedSyncTokens) {
    if (expiresAt <= now) usedSyncTokens.delete(jti);
  }
}

function signSyncPayload(payload: string) {
  return signPayload(payload, syncTokenSecret);
}

function issueSyncToken(user: AuthenticatedUser) {
  const now = Date.now();
  const payload = base64UrlJson({
    jti: crypto.randomUUID(),
    sub: user.userId,
    role: user.role,
    iat: now,
    exp: now + syncTokenTtlMs,
  });
  return `${payload}.${signSyncPayload(payload)}`;
}

function verifySyncToken(token: unknown) {
  if (typeof token !== "string" || !token.includes(".")) return { ok: false, error: "Sync Token이 없습니다." };
  const [payload, signature] = token.split(".");
  const expected = signSyncPayload(payload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return { ok: false, error: "Sync Token이 올바르지 않습니다." };
  }

  let data: { jti?: string; role?: string; exp?: number };
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { jti?: string; role?: string; exp?: number };
  } catch {
    return { ok: false, error: "Sync Token 형식이 올바르지 않습니다." };
  }
  const now = Date.now();
  pruneUsedSyncTokens(now);
  if (data.role !== "admin" || !data.jti || !data.exp) return { ok: false, error: "Sync Token 권한이 올바르지 않습니다." };
  if (data.exp <= now) return { ok: false, error: "Sync Token이 만료되었습니다." };
  if (usedSyncTokens.has(data.jti)) return { ok: false, error: "이미 사용된 Sync Token입니다." };
  usedSyncTokens.set(data.jti, data.exp);
  return { ok: true, error: "" };
}

function requireSyncToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const verified = verifySyncToken(req.headers["x-gs-sync-token"]);
  if (!verified.ok) return res.status(401).json({ error: verified.error });
  next();
}

function activeRevision(campaign: StoredCampaign) {
  return campaign.revisions.find((revision) => revision.id === campaign.activeRevisionId) ?? campaign.revisions[0];
}

function buildCampaignRevision(dataset: CampaignDataset, revisionNumber: number): StoredCampaignRevision {
  const campaignId = resolveCampaignId(dataset.config);
  const revisionDataset = {
    ...dataset,
    config: { ...dataset.config, campaignId },
  };
  return {
    id: crypto.randomUUID(),
    revisionNumber,
    createdAt: revisionDataset.createdAt || new Date().toISOString(),
    dataset: revisionDataset,
  };
}

function saveCampaign(dataset: CampaignDataset) {
  const db = readDb();
  const existing = new Map(db.ofcAccounts.map((account) => [account.ofc, account]));
  const generatedAccounts: OfcAccount[] = [];

  const ofcs = [...new Set(dataset.stores.map((store) => store.ofc).filter((ofc): ofc is string => Boolean(ofc)))].sort((a, b) => a.localeCompare(b, "ko"));
  for (const ofc of ofcs) {
    const account = { ofc, userId: ofc, password: ofc };
    if (!existing.has(ofc)) generatedAccounts.push(account);
    existing.set(ofc, account);
  }

  const campaignId = resolveCampaignId(dataset.config);
  const previous = db.campaigns.find((item) => item.id === campaignId);
  const revision = buildCampaignRevision({ ...dataset, config: { ...dataset.config, campaignId } }, (previous?.revisions.length ?? 0) + 1);
  const campaign: StoredCampaign = previous
    ? {
        ...previous,
        campaignName: revision.dataset.config.campaignName,
        updatedAt: revision.createdAt,
        activeRevisionId: revision.id,
        revisions: [revision, ...previous.revisions],
      }
    : {
        id: campaignId,
        campaignName: revision.dataset.config.campaignName,
        createdAt: revision.createdAt,
        updatedAt: revision.createdAt,
        activeRevisionId: revision.id,
        revisions: [revision],
      };

  db.campaigns = [campaign, ...db.campaigns.filter((item) => item.id !== campaignId)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  db.ofcAccounts = [...existing.values()].sort((a, b) => a.ofc.localeCompare(b.ofc, "ko"));
  writeDb(db);
  return { campaign, revision, generatedAccounts, accountCount: db.ofcAccounts.length };
}

function campaignMetaFromRecord(campaign: StoredCampaign) {
  const revision = activeRevision(campaign);
  return {
    ...campaignMeta(revision.dataset),
    id: campaign.id,
    campaignName: campaign.campaignName,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    activeRevisionId: revision.id,
    activeRevisionNumber: revision.revisionNumber,
    revisionCount: campaign.revisions.length,
  };
}

export function createApp() {
  const app = express();

  // Snapshot uploads arrive gzip-compressed (Content-Type: application/json with
  // Content-Encoding: gzip) because the hosted deployment caps a request body at
  // 4.5MB and a Campaign Snapshot is ~22MB of JSON. inflate:true decodes gzip and
  // deflate back to the original bytes before any route sees them, so the parsed
  // payload is identical either way and an uncompressed client still works.
  // The limit applies to the decoded body.
  app.use((req, res, next) => {
    const declared = String(req.headers["content-encoding"] ?? "")
      .toLowerCase()
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const unsupported = declared.filter((encoding) => !supportedRequestEncodings.has(encoding));
    if (unsupported.length) {
      return res.status(415).json({
        error: `지원하지 않는 Content-Encoding입니다 (${unsupported.join(", ")}). gzip 또는 비압축으로 보내세요.`,
      });
    }
    next();
  });
  app.use(express.json({ limit: "120mb", inflate: true }));

  app.post("/api/login", (req, res) => {
    const { userId, password } = req.body || {};
    if (userId === adminId && password === adminPassword) {
      const user: AuthenticatedUser = { role: "admin", userId: adminId, displayName: "본사 관리자" };
      setSession(res, user);
      return res.json({ user });
    }

    const account = readDb().ofcAccounts.find((item) => item.userId === userId && item.password === password);
    if (!account) return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    const user: AuthenticatedUser = { role: "ofc", userId: account.userId, displayName: account.ofc, ofc: account.ofc };
    setSession(res, user);
    return res.json({ user });
  });

  app.post("/api/logout", requireUser, (req, res) => {
    clearSession(req, res);
    res.json({ ok: true });
  });

  app.get("/api/session", (req, res) => {
    res.json({ user: sessionFromRequest(req) || null });
  });

  app.get("/api/campaigns", requireUser, (_req, res) => {
    res.json({ campaigns: readDb().campaigns.map(campaignMetaFromRecord) });
  });

  app.get("/api/dashboard/latest", requireUser, (_req, res) => {
    const campaign = readDb().campaigns.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!campaign) return res.json({ dataset: null });
    res.json({ dataset: dashboardForUser(activeRevision(campaign).dataset, res.locals.user as AuthenticatedUser) });
  });

  app.get("/api/dashboard/:campaignId", requireUser, (req, res) => {
    const campaign = readDb().campaigns.find((item) => item.id === req.params.campaignId);
    if (!campaign) return res.status(404).json({ error: "Campaign을 찾을 수 없습니다." });
    res.json({ dataset: dashboardForUser(activeRevision(campaign).dataset, res.locals.user as AuthenticatedUser) });
  });

  app.post("/api/admin/local-sync-token", requireUser, requireAdmin, (_req, res) => {
    const token = issueSyncToken(res.locals.user as AuthenticatedUser);
    res.json({
      token,
      expiresAt: new Date(Date.now() + syncTokenTtlMs).toISOString(),
      agentUrl: process.env.LOCAL_AGENT_URL || "http://127.0.0.1:8787",
    });
  });

  app.post(
    "/api/admin/campaigns/browser-sync",
    requireUser,
    requireAdmin,
    requireSyncToken,
    express.raw({ type: "application/octet-stream", limit: "40mb" }),
    (req, res) => {
      let dataset: CampaignDataset | undefined;
      try {
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
        const encoding = String(req.headers["x-gs-snapshot-encoding"] ?? "identity").toLowerCase();
        const raw = encoding === "gzip" ? zlib.gunzipSync(body) : body;
        const parsed = JSON.parse(raw.toString("utf8")) as { dataset?: CampaignDataset };
        dataset = parsed.dataset;
      } catch {
        return res.status(400).json({ error: "Snapshot gzip 또는 JSON 형식이 올바르지 않습니다." });
      }

      if (!dataset?.config || !Array.isArray(dataset.stores) || !Array.isArray(dataset.storeMetrics)) {
        return res.status(400).json({ error: "Local Agent Snapshot 데이터 형식이 올바르지 않습니다." });
      }
      const saved = saveCampaign(dataset);
      res.json({
        campaign: campaignMetaFromRecord(saved.campaign),
        generatedAccounts: saved.generatedAccounts,
        accountCount: saved.accountCount,
        dataset: dashboardForUser(saved.revision.dataset, res.locals.user as AuthenticatedUser),
      });
    },
  );

  app.post("/api/admin/campaigns/local-sync", (req, res) => {
    const verified = verifySyncToken(req.body?.token);
    if (!verified.ok) return res.status(401).json({ error: verified.error });
    const dataset = req.body?.dataset as CampaignDataset | undefined;
    if (!dataset?.config || !Array.isArray(dataset.stores) || !Array.isArray(dataset.storeMetrics)) {
      return res.status(400).json({ error: "Local Agent Snapshot 데이터 형식이 올바르지 않습니다." });
    }
    const saved = saveCampaign(dataset);
    const systemAdmin: AuthenticatedUser = { role: "admin", userId: "local-agent", displayName: "Local Agent" };
    res.json({
      campaign: campaignMetaFromRecord(saved.campaign),
      generatedAccounts: saved.generatedAccounts,
      accountCount: saved.accountCount,
      dataset: dashboardForUser(saved.revision.dataset, systemAdmin),
    });
  });

  app.get("/api/admin/campaigns/:campaignId/revisions", requireUser, requireAdmin, (req, res) => {
    const campaign = readDb().campaigns.find((item) => item.id === req.params.campaignId);
    if (!campaign) return res.status(404).json({ error: "Campaign을 찾을 수 없습니다." });
    res.json({
      campaign: campaignMetaFromRecord(campaign),
      revisions: campaign.revisions.map((revision) => ({
        ...campaignMeta(revision.dataset),
        id: revision.id,
        campaignId: campaign.id,
        revisionNumber: revision.revisionNumber,
        createdAt: revision.createdAt,
        active: revision.id === campaign.activeRevisionId,
      })),
    });
  });

  app.get("/api/admin/ofc-accounts", requireUser, requireAdmin, (_req, res) => {
    res.json({ accounts: readDb().ofcAccounts });
  });

  // Body decoding failures (corrupt gzip, malformed JSON, oversized payload) are
  // rejected before any route runs. Answer them as JSON so the Local Agent can
  // show the reason instead of the framework's HTML error page.
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    const failure = error as { type?: string; status?: number; statusCode?: number };
    const status = failure.status ?? failure.statusCode ?? 500;
    if (status < 400 || status >= 500) return next(error);
    if (failure.type === "entity.too.large") {
      return res.status(413).json({ error: "Snapshot 용량이 서버 허용치를 초과했습니다." });
    }
    if (failure.type === "encoding.unsupported") {
      return res.status(415).json({ error: "지원하지 않는 Content-Encoding입니다. gzip 또는 비압축으로 보내세요." });
    }
    return res.status(400).json({ error: "요청 본문을 읽지 못했습니다. 압축 또는 JSON 형식을 확인하세요." });
  });

  return app;
}
