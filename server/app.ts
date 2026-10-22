/**
 * Inspection Master Console - API.
 *
 * This service stores no inspection data. Every read and every write is a
 * call to the inspection app's admin-grid API, which owns the canonical rows
 * and the validation that protects them. There is no seed and no cache: if
 * the inspection app is unreachable the console says so rather than showing a
 * number from somewhere else.
 *
 * The write path mirrors the app's own: `previewAdminGrid` validates and
 * reports per-cell errors without writing, then `saveAdminGrid` commits under
 * the `revision` + `sourceHash` the preview was based on. If either moved in
 * the meantime the app answers NATIVE_WRITE_CONFLICT and nothing is written,
 * so a stale tab cannot overwrite someone else's edit.
 */
import crypto from "node:crypto";
import express from "express";
import type {
  AuthenticatedUser,
  GridView,
  HistoryResult,
  PreviewResult,
  SaveResult,
} from "../src/domain/types.js";
import { inspectionApiConfig, missingInspectionVars, writesEnabled } from "./config.js";
import { DATASETS, isKnownDataset } from "./datasets.js";
import { adminGrid, InspectionApiError, NotConfiguredError } from "./inspectionApi.js";

const adminId = process.env.ADMIN_ID || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const sessionTtlMs = Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const sessionSecretConfigured = Boolean(process.env.SESSION_SECRET);

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

function requireWrites(_req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!writesEnabled()) {
    return res.status(403).json({
      error: "이 배포는 읽기 전용입니다. 수정하려면 MASTER_WRITES_ENABLED=true 를 설정하세요.",
    });
  }
  next();
}

function sendError(res: express.Response, cause: unknown) {
  if (cause instanceof NotConfiguredError) {
    return res.status(503).json({ error: cause.message, missing: cause.missing });
  }
  if (cause instanceof InspectionApiError) {
    return res.status(cause.status).json({ error: cause.message, code: cause.code });
  }
  console.error(cause);
  return res.status(500).json({ error: "서버 처리 중 오류가 발생했습니다." });
}

/** Reject an unknown dataset here so a typo never reaches the inspection app. */
function datasetParam(req: express.Request, res: express.Response) {
  const name = String(req.params.name);
  if (!isKnownDataset(name)) {
    res.status(404).json({ error: `알 수 없는 데이터셋입니다: ${name}` });
    return undefined;
  }
  return name;
}

/**
 * The CAS pair every write must carry, taken from the body the browser echoes
 * back from its last view. Both are validated as the app expects them:
 * `revision` must be a non-negative safe integer or `identity()` throws
 * NATIVE_WRITE_INVALID on the far side.
 */
function casFrom(body: unknown) {
  const source = (body ?? {}) as { expectedRevision?: unknown; sourceHash?: unknown };
  const expectedRevision = Number(source.expectedRevision);
  const sourceHash = String(source.sourceHash ?? "");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new InspectionApiError("cas", 400, "expectedRevision이 올바르지 않습니다. 화면을 새로 고치세요.");
  }
  if (!sourceHash) {
    throw new InspectionApiError("cas", 400, "sourceHash가 필요합니다. 화면을 새로 고치세요.");
  }
  return { expectedRevision, sourceHash };
}

function gridPayload(body: unknown) {
  const source = (body ?? {}) as { columns?: unknown; rows?: unknown };
  if (!Array.isArray(source.columns) || !Array.isArray(source.rows)) {
    throw new InspectionApiError("grid", 400, "columns와 rows가 필요합니다.");
  }
  return { columns: source.columns.map(String), rows: source.rows as string[][] };
}

/* --------------------------------------------------------------------- App */

export function createApp() {
  const app = express();

  // The inspection app caps a grid save at 3.8MB; accept a little more so an
  // oversized edit is refused with its own message instead of a parser error.
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      adminConfigured: Boolean(adminPassword),
      sessionSecretConfigured,
      inspectionApiConfigured: Boolean(inspectionApiConfig()),
      missingInspectionVars: missingInspectionVars(),
      writesEnabled: writesEnabled(),
    });
  });

  app.post("/api/login", (req, res) => {
    const userId = String(req.body?.userId ?? "").trim();
    const password = String(req.body?.password ?? "");

    if (!adminPassword) {
      return res.status(503).json({
        error: "로그인 자격이 설정되지 않았습니다. 서버에 ADMIN_PASSWORD를 설정하세요.",
      });
    }
    if (userId !== adminId || !secretEquals(password, adminPassword)) {
      return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }

    const user: AuthenticatedUser = { role: "admin", userId: adminId, displayName: "검품 운영" };
    res.cookie("sid", issueSessionCookie(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    res.json({ user });
  });

  app.post("/api/logout", (_req, res) => {
    res.clearCookie("sid");
    res.json({ ok: true });
  });

  app.get("/api/session", (req, res) => {
    res.json({ user: sessionFromRequest(req) ?? null, writesEnabled: writesEnabled() });
  });

  app.get("/api/master/datasets", requireUser, (_req, res) => {
    res.json({ datasets: DATASETS });
  });

  app.get("/api/master/datasets/:name", requireUser, async (req, res) => {
    const dataset = datasetParam(req, res);
    if (!dataset) return;
    try {
      const view = await adminGrid<GridView>({ action: "getAdminGrid", payload: { dataset } });
      res.json({ view });
    } catch (cause) {
      sendError(res, cause);
    }
  });

  app.get("/api/master/datasets/:name/history", requireUser, async (req, res) => {
    const dataset = datasetParam(req, res);
    if (!dataset) return;
    try {
      res.json(await adminGrid<HistoryResult>({ action: "getAdminGridHistory", payload: { dataset } }));
    } catch (cause) {
      sendError(res, cause);
    }
  });

  /** Validate only. The inspection app reports per-cell errors and writes nothing. */
  app.post("/api/master/datasets/:name/preview", requireUser, requireWrites, async (req, res) => {
    const dataset = datasetParam(req, res);
    if (!dataset) return;
    try {
      const cas = casFrom(req.body);
      const grid = gridPayload(req.body);
      res.json(
        await adminGrid<PreviewResult>({
          action: "previewAdminGrid",
          payload: { dataset, ...grid, ...cas },
        }),
      );
    } catch (cause) {
      sendError(res, cause);
    }
  });

  /**
   * Commit. `operationId` makes the write idempotent, so a retry after a
   * timeout confirms the first attempt instead of applying a second one; the
   * browser must therefore reuse the id it previewed with.
   */
  app.post("/api/master/datasets/:name/save", requireUser, requireWrites, async (req, res) => {
    const dataset = datasetParam(req, res);
    if (!dataset) return;

    const operationId = String(req.body?.operationId ?? "").trim();
    if (!operationId) return res.status(400).json({ error: "operationId가 필요합니다." });

    try {
      const cas = casFrom(req.body);
      const grid = gridPayload(req.body);
      const result = await adminGrid<SaveResult>({
        action: "saveAdminGrid",
        operationId,
        nativeWrite: { version: 1, backend: "supabase", expectedRevision: cas.expectedRevision },
        payload: { dataset, ...grid, ...cas, operationId },
      });
      res.json(result);
    } catch (cause) {
      sendError(res, cause);
    }
  });

  /** Confirm a save whose response was lost, by the same operation id. */
  app.post("/api/master/write-status", requireUser, async (req, res) => {
    const operationId = String(req.body?.operationId ?? "").trim();
    const payloadHash = String(req.body?.payloadHash ?? "").trim();
    if (!operationId) return res.status(400).json({ error: "operationId가 필요합니다." });
    try {
      res.json(await adminGrid({ action: "getNativeWriteStatus", operationId, payloadHash }));
    } catch (cause) {
      sendError(res, cause);
    }
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "존재하지 않는 API 경로입니다." });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    sendError(res, error);
  });

  return app;
}
