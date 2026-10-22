/**
 * Inspection Operations Console - API.
 *
 * Shape is shared by both runtimes: `server.ts` runs this as a normal Node
 * server, and `api/index.ts` runs the same app as a single Vercel function
 * (see that file for why every `/api/*` path is funnelled through one handler).
 *
 * Authorisation model:
 *  - `admin`  (본사 운영) sees every center.
 *  - `center` (센터 담당) sees exactly one center. The scope is taken from the
 *    signed session, never from a query parameter, so a center user cannot
 *    widen their own view by editing a URL.
 *
 * Credentials come from the environment only. There is deliberately no
 * in-code password fallback: an unconfigured deployment refuses to sign
 * anyone in rather than quietly accepting a published default.
 */
import crypto from "node:crypto";
import express from "express";
import type {
  AuthenticatedUser,
  ConsoleScope,
  DecisionAction,
  ExceptionDecision,
  ExceptionItem,
  InspectionRecord,
} from "../src/domain/types.js";
import {
  ALL_CENTERS,
  applyDecisions,
  currentBusinessDate,
  deriveExceptions,
  inspectorLoadFor,
  isOverdue,
  loadRecords,
  overviewFor,
  stateForAction,
  writeDecision,
} from "./store.js";

const adminId = process.env.ADMIN_ID || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "";

/**
 * Center sign-in is opt-in. Without CENTER_PASSWORD only 본사 운영 can log in,
 * so a fresh deployment is never broader than it was configured to be.
 */
const centerPassword = process.env.CENTER_PASSWORD || "";

const sessionTtlMs = Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000);

/**
 * A generated secret keeps an unconfigured deployment safe rather than
 * predictable; the cost is that sessions do not survive a restart or span
 * instances, which is why production sets SESSION_SECRET explicitly.
 */
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const sessionSecretConfigured = Boolean(process.env.SESSION_SECRET);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/* ----------------------------------------------------------------- Session */

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

function signPayload(payload: string) {
  return crypto.createHmac("sha256", sessionSecret).update(payload).digest("base64url");
}

function issueSessionCookie(user: AuthenticatedUser) {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({ user, iat: now, exp: now + sessionTtlMs }), "utf8").toString(
    "base64url",
  );
  return `${payload}.${signPayload(payload)}`;
}

function verifySessionCookie(value: string | undefined): AuthenticatedUser | undefined {
  if (!value?.includes(".")) return undefined;
  const [payload, signature] = value.split(".");
  const expected = signPayload(payload);
  if (signature.length !== expected.length) return undefined;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      user?: AuthenticatedUser;
      exp?: number;
    };
    if (!parsed.user || !parsed.exp || parsed.exp <= Date.now()) return undefined;
    return parsed.user;
  } catch {
    return undefined;
  }
}

function sessionFromRequest(req: express.Request) {
  return verifySessionCookie(parseCookies(req.headers.cookie).sid);
}

/** Constant-time compare that tolerates differing lengths. */
function secretEquals(given: string, expected: string) {
  if (!expected) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = sessionFromRequest(req);
  if (!user) return res.status(401).json({ error: "로그인이 필요합니다." });
  res.locals.user = user;
  next();
}

/* ------------------------------------------------------------------- Scope */

function scopeFor(user: AuthenticatedUser): ConsoleScope {
  if (user.role === "center" && user.center) {
    return { label: user.center, centers: [user.center] };
  }
  return { label: "전체 센터", centers: [...ALL_CENTERS] };
}

/**
 * Which operating day the request is about.
 *
 * A write carries it in the body and a read in the query string, because an
 * exception id is only meaningful inside its own business date: resolving a
 * decision against today's feed would 404 on anything raised yesterday.
 */
function businessDateFrom(req: express.Request) {
  for (const candidate of [req.body?.date, req.query.date]) {
    const requested = String(candidate ?? "");
    if (DATE_PATTERN.test(requested)) return requested;
  }
  return currentBusinessDate();
}

interface ScopedFeed {
  records: InspectionRecord[];
  exceptions: ExceptionItem[];
  scope: ConsoleScope;
  businessDate: string;
  seeded: boolean;
}

/**
 * The single read path. Every endpoint derives its answer from this so a
 * scope rule can never be enforced in one place and forgotten in another.
 */
function scopedFeed(req: express.Request, res: express.Response): ScopedFeed {
  const user = res.locals.user as AuthenticatedUser;
  const businessDate = businessDateFrom(req);
  const scope = scopeFor(user);
  const { records: all, seeded } = loadRecords(businessDate);
  const records = all.filter((record) => scope.centers.includes(record.center));
  const exceptions = applyDecisions(deriveExceptions(records));
  return { records, exceptions, scope, businessDate, seeded };
}

/* --------------------------------------------------------------------- App */

const DECISION_ACTIONS: DecisionAction[] = ["hold", "approve", "reject", "dismiss"];

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      adminConfigured: Boolean(adminPassword),
      centerLoginEnabled: Boolean(centerPassword),
      sessionSecretConfigured,
    });
  });

  app.post("/api/login", (req, res) => {
    const userId = String(req.body?.userId ?? "").trim();
    const password = String(req.body?.password ?? "");

    if (!adminPassword && !centerPassword) {
      return res.status(503).json({
        error: "로그인 자격이 설정되지 않았습니다. 서버에 ADMIN_PASSWORD를 설정하세요.",
      });
    }

    if (userId === adminId && secretEquals(password, adminPassword)) {
      const user: AuthenticatedUser = { role: "admin", userId: adminId, displayName: "본사 운영" };
      res.cookie("sid", issueSessionCookie(user), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
      return res.json({ user });
    }

    const center = ALL_CENTERS.find((name) => name === userId);
    if (center && secretEquals(password, centerPassword)) {
      const user: AuthenticatedUser = { role: "center", userId: center, displayName: center, center };
      res.cookie("sid", issueSessionCookie(user), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
      return res.json({ user });
    }

    return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
  });

  app.post("/api/logout", (_req, res) => {
    res.clearCookie("sid");
    res.json({ ok: true });
  });

  app.get("/api/session", (req, res) => {
    const user = sessionFromRequest(req) ?? null;
    res.json({ user, centers: user?.role === "admin" ? [...ALL_CENTERS] : user?.center ? [user.center] : [] });
  });

  app.get("/api/console/overview", requireUser, (req, res) => {
    const feed = scopedFeed(req, res);
    res.json(overviewFor(feed.records, feed.exceptions, feed.scope, feed.businessDate, feed.seeded));
  });

  app.get("/api/console/exceptions", requireUser, (req, res) => {
    const feed = scopedFeed(req, res);
    const requestedState = String(req.query.state ?? "pending");
    const now = Date.now();

    const items = feed.exceptions.filter((item) => {
      if (requestedState === "all") return true;
      if (requestedState === "overdue") return isOverdue(item, now);
      if (requestedState === "pending") return item.state === "open" || item.state === "held";
      return item.state === requestedState;
    });

    res.json({
      businessDate: feed.businessDate,
      scope: feed.scope,
      items: items.map((item) => ({ ...item, overdue: isOverdue(item, now) })),
    });
  });

  app.post("/api/console/exceptions/:id/decision", requireUser, (req, res) => {
    const user = res.locals.user as AuthenticatedUser;
    const action = String(req.body?.action ?? "") as DecisionAction;
    const note = String(req.body?.note ?? "").trim();

    if (!DECISION_ACTIONS.includes(action)) {
      return res.status(400).json({ error: `action은 ${DECISION_ACTIONS.join(", ")} 중 하나여야 합니다.` });
    }

    // The exception must exist inside the caller's scope. Looking it up through
    // the scoped feed is what stops a center user from deciding another
    // center's exception by guessing its id.
    const feed = scopedFeed(req, res);
    const target = feed.exceptions.find((item) => item.id === req.params.id);
    if (!target) return res.status(404).json({ error: "해당 예외 항목을 찾을 수 없습니다." });

    const decision: ExceptionDecision = {
      action,
      note: note || undefined,
      decidedBy: user.displayName,
      decidedAt: new Date().toISOString(),
    };

    writeDecision(target.id, decision);

    res.json({ item: { ...target, state: stateForAction(action), decision } });
  });

  app.get("/api/console/inspections", requireUser, (req, res) => {
    const feed = scopedFeed(req, res);
    res.json({ businessDate: feed.businessDate, scope: feed.scope, records: feed.records });
  });

  app.get("/api/console/inspectors", requireUser, (req, res) => {
    const feed = scopedFeed(req, res);
    res.json({
      businessDate: feed.businessDate,
      scope: feed.scope,
      inspectors: inspectorLoadFor(feed.records, feed.exceptions),
    });
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "존재하지 않는 API 경로입니다." });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    console.error(error);
    res.status(500).json({ error: "서버 처리 중 오류가 발생했습니다." });
  });

  return app;
}
