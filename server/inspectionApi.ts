/**
 * Client for the inspection app's operational API (`POST {base}/api/gas`).
 *
 * The console never talks to Supabase or R2 directly. That endpoint already
 * owns identity normalisation (job base key, canonical partner, record id),
 * the qty state machine with its CAS base, the movement state machine, and
 * the native write receipts. Re-implementing any of it here would make this a
 * second writer that has to match the first exactly or corrupt canonical rows.
 *
 * Calls are server-to-server, so no Origin header is sent and the app's origin
 * allowlist needs no entry for this console; the session token stays on our
 * server. `clientPlatform: "service"` marks the request as a service
 * integration so the minimum-client-version gate does not mistake it for a
 * stale field build - the same exemption the Inspection Dashboard uses.
 */
import { inspectionApiConfig, missingInspectionVars } from "./config.js";

const CALLER = "inspection-master-console";

export class NotConfiguredError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`검품 앱 연결이 설정되지 않았습니다. 누락된 환경변수: ${missing.join(", ")}`);
    this.missing = missing;
  }
}

export class InspectionApiError extends Error {
  readonly action: string;
  readonly code?: string;
  readonly status: number;
  /** True when the app says the condition is temporary and the same request may be retried. */
  readonly retryable: boolean;

  constructor(action: string, status: number, message: string, code?: string, retryable = false) {
    super(message);
    this.action = action;
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const TIMEOUT_MS = Number(process.env.INSPECTION_TIMEOUT_MS || 30_000);

/** Error codes the app returns inside a 200 body, mapped to what they mean. */
const CODE_STATUS: Record<string, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  USER_BLOCKED: 403,
  ORIGIN_NOT_ALLOWED: 502,
  CLIENT_UPDATE_REQUIRED: 502,
  GAS_URL_NOT_CONFIGURED: 503,
  NATIVE_CANONICAL_REQUIRED: 503,
  NATIVE_HISTORY_UNAVAILABLE: 503,
  NATIVE_HISTORY_AUTHORITY_UNKNOWN: 503,
  NATIVE_WRITE_CONFLICT: 409,
  NATIVE_WRITE_PENDING: 202,
  NATIVE_WRITE_UNKNOWN: 202,
  POST_ACTION_FAILED: 502,
};

export interface GasRequest {
  action: string;
  /** Native-write identity. Required by `updateActionStatus` and the receipt actions. */
  kind?: string;
  operationId?: string;
  payloadHash?: string;
  reason?: string;
  nativeWrite?: { version: 1; backend: "supabase"; expectedRevision: number };
  rows?: unknown[];
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * A response that reports a transient failure. These are not errors to show
 * as "it broke": the write may still land, so the caller has to check the
 * receipt rather than assume either outcome.
 */
export interface GasEnvelope {
  ok?: boolean;
  error?: string;
  message?: string;
  pendingWrite?: boolean;
  isTransient?: boolean;
  retryable?: boolean;
  /** Set by the app when a write may or may not have landed (e.g. QTY_POST_WRITE_VERIFY_MISMATCH). */
  requiresConfirmation?: boolean;
  nativeAck?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function gas<T extends GasEnvelope>(request: GasRequest): Promise<T> {
  const config = inspectionApiConfig();
  if (!config) throw new NotConfiguredError(missingInspectionVars());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${config.base}/api/gas`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        ...request,
        sessionToken: config.sessionToken,
        caller: CALLER,
        clientPlatform: "service",
      }),
    });

    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      throw new InspectionApiError(
        request.action,
        502,
        `검품 앱이 JSON이 아닌 응답을 보냈습니다: ${text.slice(0, 200)}`,
      );
    }

    const envelope = (body ?? {}) as GasEnvelope;

    if (!response.ok) {
      throw new InspectionApiError(
        request.action,
        response.status,
        envelope.message || envelope.error || `HTTP ${response.status}`,
        envelope.error,
        envelope.retryable === true,
      );
    }

    // A pending or unknown write is returned to the caller rather than thrown:
    // the operation may have committed, and the only correct next step is to
    // read the receipt, not to retry blindly or report a failure.
    if (envelope.ok === false && !envelope.pendingWrite) {
      const code = envelope.error;
      throw new InspectionApiError(
        request.action,
        (code ? CODE_STATUS[code] : undefined) ?? 409,
        envelope.message || code || `${request.action} 요청이 거부되었습니다.`,
        code,
        envelope.retryable === true || envelope.isTransient === true || envelope.requiresConfirmation === true,
      );
    }

    return envelope as T;
  } catch (cause) {
    if (cause instanceof InspectionApiError || cause instanceof NotConfiguredError) throw cause;
    if (cause instanceof Error && cause.name === "AbortError") {
      // A timed-out write is not a failed write. Surface it as retryable so the
      // caller checks the receipt by operation id instead of resubmitting.
      throw new InspectionApiError(
        request.action,
        504,
        `검품 앱이 ${TIMEOUT_MS}ms 안에 응답하지 않았습니다. 저장 여부는 저장/복구 상태에서 확인하세요.`,
        "TIMEOUT",
        true,
      );
    }
    // "fetch failed" tells an operator nothing. Say what it means for a write: no answer was received.
    throw new InspectionApiError(
      request.action,
      502,
      `검품 앱에서 응답을 받지 못했습니다 (${cause instanceof Error ? cause.message : String(cause)}). 요청이 반영되었는지는 알 수 없습니다.`,
      "NO_RESPONSE",
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}
