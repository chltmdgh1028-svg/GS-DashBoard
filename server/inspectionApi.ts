/**
 * Client for the inspection app's admin-grid API.
 *
 * This is the only way the console reaches canonical data, and it is
 * deliberately not a Supabase client. The inspection app's `adminGrid`
 * module holds the validation that protects the master rows - criteria JSON
 * preservation, duplicate-rule detection, 사용여부 coercion, product-code
 * normalisation, reservation quantity rules, work-schedule parsing - and it
 * stamps 수정자/수정일시 from the real session user. A second implementation
 * writing the same rows through `app_grid_decide` would have to reproduce all
 * of that exactly or corrupt the master, so the console calls it instead.
 *
 * Actions (POST {base}/api/admin-grid):
 *   getAdminGrid        -> the dataset view: columns, rows, revision, sourceHash
 *   previewAdminGrid    -> validation result; writes nothing
 *   saveAdminGrid       -> commits, via app_grid_decide
 *   getAdminGridHistory -> change list
 *   getAdminGridChange  -> one change, before/after diff
 *
 * Calls are server-to-server. No Origin header is sent, so the app's origin
 * allowlist is satisfied without adding this console to it, and the session
 * token never reaches a browser.
 */
import { inspectionApiConfig, missingInspectionVars } from "./config.js";

/**
 * Declared so the inspection app's minimum-client-version gate treats this as
 * a service integration rather than a stale field build - the same exemption
 * the Inspection Dashboard server uses.
 */
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

  constructor(action: string, status: number, message: string, code?: string) {
    super(message);
    this.action = action;
    this.status = status;
    this.code = code;
  }
}

const TIMEOUT_MS = Number(process.env.INSPECTION_TIMEOUT_MS || 30_000);

/**
 * Error codes the app returns in a 200 body. They are business outcomes, not
 * transport failures, so each maps to the status that describes it.
 */
const CODE_STATUS: Record<string, number> = {
  NATIVE_WRITE_CONFLICT: 409,
  GRID_DATASET_INVALID: 404,
  GRID_CHANGE_NOT_FOUND: 404,
  GRID_ACTION_INVALID: 400,
  GRID_COLUMNS_INVALID: 400,
  GRID_ROWS_INVALID: 400,
  GRID_COLUMNS_CANNOT_DISCARD_SOURCE: 400,
  GRID_DATASET_TOO_LARGE: 413,
  GRID_PAYLOAD_TOO_LARGE: 413,
  NATIVE_BACKEND_NOT_CONFIGURED: 503,
  NATIVE_CANONICAL_REQUIRED: 503,
  NATIVE_AUTH_UNCONFIRMED: 401,
  ORIGIN_NOT_ALLOWED: 502,
  CLIENT_UPDATE_REQUIRED: 502,
};

export interface AdminGridRequest {
  action: string;
  operationId?: string;
  /** getNativeWriteStatus reads this at the top level, not inside payload. */
  payloadHash?: string;
  nativeWrite?: { version: 1; backend: "supabase"; expectedRevision: number };
  payload?: Record<string, unknown>;
}

export async function adminGrid<T>(request: AdminGridRequest): Promise<T> {
  const config = inspectionApiConfig();
  if (!config) throw new NotConfiguredError(missingInspectionVars());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${config.base}/api/admin-grid`, {
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
      throw new InspectionApiError(request.action, 502, `검품 앱이 JSON이 아닌 응답을 보냈습니다: ${text.slice(0, 200)}`);
    }

    const envelope = (body ?? {}) as { ok?: boolean; error?: string; message?: string };

    if (!response.ok) {
      throw new InspectionApiError(
        request.action,
        response.status,
        envelope.message || envelope.error || `HTTP ${response.status}`,
        envelope.error,
      );
    }

    // The app answers business failures with HTTP 200 and ok:false.
    if (envelope.ok === false) {
      const code = envelope.error;
      throw new InspectionApiError(
        request.action,
        (code ? CODE_STATUS[code] : undefined) ?? 409,
        envelope.message || code || `${request.action} 요청이 거부되었습니다.`,
        code,
      );
    }

    return body as T;
  } catch (cause) {
    if (cause instanceof InspectionApiError || cause instanceof NotConfiguredError) throw cause;
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new InspectionApiError(request.action, 504, `검품 앱이 ${TIMEOUT_MS}ms 안에 응답하지 않았습니다.`);
    }
    throw new InspectionApiError(request.action, 502, cause instanceof Error ? cause.message : String(cause));
  } finally {
    clearTimeout(timer);
  }
}
