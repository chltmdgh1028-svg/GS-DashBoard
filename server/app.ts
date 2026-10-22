/**
 * Inspection Operations Console - API.
 *
 * Every read and write is a call to the inspection app's `/api/gas`. The
 * console stores nothing and derives nothing: a number on this screen came
 * from the same handler the field app calls.
 *
 * The correction path is the only write, and it is deliberately narrow:
 *
 *   1. the browser corrects a qty on a row it has read
 *   2. the server sends it with the CAS base (`baseQty`, `baseRevision`) from
 *      that read, so a row changed in the meantime is rejected by the app's
 *      state machine instead of silently overwritten
 *   3. `requestId` is stable per correction, so a retry after a timeout is
 *      the same request rather than a second one
 *   4. `confirmInspectionQty` then reads the canonical row back and says
 *      whether this exact request landed
 *
 * Step 4 is what makes it safe to retry: an unknown outcome is resolved by
 * reading, never by writing again.
 */
import crypto from "node:crypto";
import express from "express";
import type { AuthenticatedUser } from "../src/domain/types.js";
import {
  adminGridUrl,
  correctionsEnabled,
  inspectionApiConfig,
  inspectionBase,
  missingInspectionVars,
} from "./config.js";
import { gas, InspectionApiError, NotConfiguredError } from "./inspectionApi.js";

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

function requireCorrections(_req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!correctionsEnabled()) {
    return res.status(403).json({
      error: "이 배포는 조회 전용입니다. 보정을 허용하려면 CORRECTIONS_ENABLED=true 를 설정하세요.",
    });
  }
  next();
}

function sendError(res: express.Response, cause: unknown) {
  if (cause instanceof NotConfiguredError) {
    return res.status(503).json({ error: cause.message, missing: cause.missing });
  }
  if (cause instanceof InspectionApiError) {
    return res.status(cause.status).json({ error: cause.message, code: cause.code, retryable: cause.retryable });
  }
  console.error(cause);
  return res.status(500).json({ error: "서버 처리 중 오류가 발생했습니다." });
}

const str = (value: unknown) => String(value ?? "").trim();

/* --------------------------------------------------------------------- App */

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      adminConfigured: Boolean(adminPassword),
      sessionSecretConfigured,
      inspectionApiConfigured: Boolean(inspectionApiConfig()),
      missingInspectionVars: missingInspectionVars(),
      correctionsEnabled: correctionsEnabled(),
      adminGridUrl: adminGridUrl() ?? null,
      inspectionBase: inspectionBase() ?? null,
    });
  });

  app.post("/api/login", (req, res) => {
    const userId = str(req.body?.userId);
    const password = String(req.body?.password ?? "");

    if (!adminPassword) {
      return res.status(503).json({ error: "로그인 자격이 설정되지 않았습니다. 서버에 ADMIN_PASSWORD를 설정하세요." });
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
    res.json({
      user: sessionFromRequest(req) ?? null,
      correctionsEnabled: correctionsEnabled(),
      adminGridUrl: adminGridUrl() ?? null,
      inspectionBase: inspectionBase() ?? null,
    });
  });

  /* ---------------------------------------------------------------- Reads */

  /**
   * Inspection rows: qty, reason and photo references in one payload.
   * `includePhotos` is passed through so the row detail does not need a
   * second round trip per row.
   */
  app.get("/api/ops/rows", requireUser, async (req, res) => {
    try {
      res.json(
        await gas({
          action: "getInspectionRows",
          payload: {
            jobKey: str(req.query.jobKey),
            date: str(req.query.date),
            selectedCenter: str(req.query.center),
            includeAllCenters: str(req.query.allCenters) || "true",
            filterMode: str(req.query.filterMode) || "current",
            includePhotos: str(req.query.includePhotos) || "true",
          },
        }),
      );
    } catch (cause) {
      sendError(res, cause);
    }
  });

  /** The job the field app is currently working, used to seed the filters. */
  app.get("/api/ops/current-job", requireUser, async (_req, res) => {
    try {
      res.json(await gas({ action: "getCurrentJob" }));
    } catch (cause) {
      sendError(res, cause);
    }
  });

  /** 회송 / 교환 records. */
  app.get("/api/ops/movements", requireUser, async (req, res) => {
    try {
      res.json(
        await gas({
          action: "getReturnExchangeRecords",
          payload: {
            filterMode: str(req.query.filterMode),
            jobKey: str(req.query.jobKey),
            date: str(req.query.date),
          },
        }),
      );
    } catch (cause) {
      sendError(res, cause);
    }
  });

  app.get("/api/ops/history", requireUser, async (_req, res) => {
    try {
      res.json(await gas({ action: "getHistoryData" }));
    } catch (cause) {
      sendError(res, cause);
    }
  });

  app.get("/api/ops/photos/archive", requireUser, async (req, res) => {
    try {
      res.json(await gas({ action: "getPhotoArchive", payload: { date: str(req.query.date) } }));
    } catch (cause) {
      sendError(res, cause);
    }
  });

  /* ------------------------------------------------------ Save / recovery */

  /**
   * The receipt for one write. `kind` selects which ledger the app reads, so
   * it must be the kind the write was made under.
   */
  app.post("/api/ops/write-status", requireUser, async (req, res) => {
    const operationId = str(req.body?.operationId);
    if (!operationId) return res.status(400).json({ error: "operationId가 필요합니다." });
    try {
      res.json(
        await gas({
          action: "getNativeWriteStatus",
          kind: str(req.body?.kind) || "action_status",
          operationId,
          payloadHash: str(req.body?.payloadHash),
        }),
      );
    } catch (cause) {
      sendError(res, cause);
    }
  });

  /** Ask the app to resolve a write left PENDING or UNKNOWN. */
  app.post("/api/ops/recover-write", requireUser, requireCorrections, async (req, res) => {
    const operationId = str(req.body?.operationId);
    if (!operationId) return res.status(400).json({ error: "operationId가 필요합니다." });
    try {
      res.json(
        await gas({
          action: "recoverNativeWrite",
          kind: str(req.body?.kind) || "action_status",
          operationId,
          payloadHash: str(req.body?.payloadHash),
          reason: str(req.body?.reason) || "console recovery",
        }),
      );
    } catch (cause) {
      sendError(res, cause);
    }
  });

  /* ------------------------------------------------------ Safe correction */

  /**
   * Correct one row's 검품수량.
   *
   * `baseQty` and `baseRevision` are the values the operator was looking at.
   * The app's qty state machine compares them with the stored row and refuses
   * the write if they have moved, so a correction made against a stale screen
   * cannot land. `requestId` carries the timestamp the app parses for
   * ordering and is stable across retries of the same correction.
   */
  app.post("/api/ops/correct-qty", requireUser, requireCorrections, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const jobKey = str(body.jobKey);
    const productCode = str(body.productCode);
    const requestId = str(body.requestId);
    const qty = Number(body.qty);

    if (!jobKey || !productCode) {
      return res.status(400).json({ error: "jobKey와 productCode가 필요합니다." });
    }
    if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
      return res.status(400).json({ error: "검품수량은 0 이상의 정수여야 합니다." });
    }
    if (!/^qty-\d{10,}-/.test(requestId)) {
      // The app derives write ordering from this prefix; a different shape
      // silently loses the timestamp and with it the ordering guarantee.
      return res.status(400).json({ error: "requestId는 qty-<timestamp>-<id> 형식이어야 합니다." });
    }

    const hasBaseQty = body.baseQty !== undefined && body.baseQty !== null && body.baseQty !== "";
    if (!hasBaseQty) {
      return res.status(400).json({ error: "baseQty가 필요합니다. 화면을 새로 고친 뒤 다시 시도하세요." });
    }

    try {
      const saved = await gas({
        action: "saveInspectionQtyFastBatch",
        rows: [
          {
            type: "inspection",
            작업기준일또는CSV식별값: jobKey,
            상품코드: productCode,
            협력사명: str(body.partnerName),
            상품명: str(body.productName),
            검품수량: qty,
            ...(body.orderQty === undefined ? {} : { 발주수량: Number(body.orderQty) }),
            baseQty: Number(body.baseQty),
            ...(body.baseRevision === undefined || body.baseRevision === null
              ? {}
              : { baseRevision: Number(body.baseRevision) }),
            requestId,
            isUserAction: true,
            explicitZero: qty === 0,
          },
        ],
      });

      res.json({ saved });
    } catch (cause) {
      sendError(res, cause);
    }
  });

  /**
   * Read the canonical row back and say whether this exact request landed.
   * This is how an unknown or timed-out correction is resolved - by reading,
   * never by writing again.
   */
  app.post("/api/ops/confirm-qty", requireUser, async (req, res) => {
    const jobKey = str(req.body?.jobKey);
    const productCode = str(req.body?.productCode);
    const requestId = str(req.body?.requestId);
    if (!jobKey || !productCode) {
      return res.status(400).json({ error: "jobKey와 productCode가 필요합니다." });
    }
    try {
      res.json(
        await gas({
          action: "confirmInspectionQty",
          payload: { jobKey, productCode, requestId, 상품코드: productCode, 작업기준일또는CSV식별값: jobKey },
        }),
      );
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
