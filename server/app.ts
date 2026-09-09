import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { defaultCampaignConfig } from "../src/config/defaultConfig.js";
import type { AuthenticatedUser, CampaignConfig, CampaignDataset, FileRole } from "../src/domain/types.js";
import { parseCampaignFiles, type CampaignInputFile } from "../src/parsers/excel.js";
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

interface PasteEntry {
  role: FileRole;
  name?: string;
  tsv: string;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024, files: 20 } });
const adminId = process.env.ADMIN_ID || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "admin";
const defaultDataDir = process.env.VERCEL ? path.join(os.tmpdir(), "gs-dashboard-data") : path.join(process.cwd(), "data");
const dataDir = process.env.DATA_DIR || defaultDataDir;
const dbPath = path.join(dataDir, "app-db.json");
const sessions = new Map<string, AuthenticatedUser>();

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

function sessionFromRequest(req: express.Request) {
  const sid = parseCookies(req.headers.cookie).sid;
  return sid ? sessions.get(sid) : undefined;
}

function setSession(res: express.Response, user: AuthenticatedUser) {
  const sid = crypto.randomBytes(24).toString("hex");
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

function bufferToInputFile(file: Express.Multer.File): CampaignInputFile {
  return {
    name: file.originalname,
    arrayBuffer: async () => {
      const copy = new Uint8Array(file.buffer.byteLength);
      copy.set(file.buffer);
      return copy.buffer;
    },
  };
}

function parseTsv(tsv: string) {
  return tsv
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("\t"));
}

function pasteEntryToInputFile(entry: PasteEntry): CampaignInputFile {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(parseTsv(entry.tsv)), "붙여넣기");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return {
    name: entry.name || `paste-${entry.role}.xlsx`,
    forcedRole: entry.role,
    arrayBuffer: async () => bytes,
  };
}

function configFromRequest(raw: unknown): CampaignConfig {
  if (!raw) return structuredClone(defaultCampaignConfig);
  try {
    return { ...structuredClone(defaultCampaignConfig), ...(typeof raw === "string" ? JSON.parse(raw) : raw) };
  } catch {
    return structuredClone(defaultCampaignConfig);
  }
}

function resolveCampaignId(config: CampaignConfig) {
  const explicitId = config.campaignId?.trim();
  if (explicitId) return explicitId;
  const nameKey = config.campaignName?.trim().replace(/\s+/g, "-");
  return nameKey ? `campaign:${nameKey}` : crypto.randomUUID();
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
  app.use(express.json({ limit: "120mb" }));

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

  app.post("/api/admin/campaigns/upload", requireUser, requireAdmin, upload.array("files"), async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined)?.map(bufferToInputFile) ?? [];
    if (!files.length) return res.status(400).json({ error: "업로드된 Excel 파일이 없습니다." });
    const dataset = await parseCampaignFiles(files, configFromRequest(req.body.config));
    const saved = saveCampaign(dataset);
    res.json({
      campaign: campaignMetaFromRecord(saved.campaign),
      generatedAccounts: saved.generatedAccounts,
      accountCount: saved.accountCount,
      dataset: dashboardForUser(saved.revision.dataset, res.locals.user as AuthenticatedUser),
    });
  });

  app.post("/api/admin/campaigns/paste", requireUser, requireAdmin, async (req, res) => {
    const entries = (req.body?.entries ?? []) as PasteEntry[];
    const files = entries.filter((entry) => entry.role && entry.tsv?.trim()).map(pasteEntryToInputFile);
    if (!files.length) return res.status(400).json({ error: "붙여넣기 데이터가 없습니다." });
    const dataset = await parseCampaignFiles(files, configFromRequest(req.body?.config));
    const saved = saveCampaign(dataset);
    res.json({
      campaign: campaignMetaFromRecord(saved.campaign),
      generatedAccounts: saved.generatedAccounts,
      accountCount: saved.accountCount,
      dataset: dashboardForUser(saved.revision.dataset, res.locals.user as AuthenticatedUser),
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

  return app;
}
