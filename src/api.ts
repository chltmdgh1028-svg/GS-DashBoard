/**
 * Browser-side API client. Always same-origin `/api/*`: the session cookie is
 * httpOnly and the inspection app's token never leaves our server.
 */
import type {
  AuthenticatedUser,
  ConsoleHealth,
  InspectionRowsResponse,
  MovementRecord,
  QtyConfirmation,
  QtyCorrection,
  WriteReceipt,
} from "./domain/types";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  /** True when the same request may be retried, or the receipt checked. */
  readonly retryable: boolean;
  readonly missing?: string[];

  constructor(status: number, message: string, code?: string, retryable = false, missing?: string[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.missing = missing;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });

  if (!response.ok) {
    const body = await response
      .json()
      .then((parsed: { error?: string; code?: string; retryable?: boolean; missing?: string[] }) => parsed)
      .catch(() => undefined);
    throw new ApiError(
      response.status,
      body?.error ?? `요청이 실패했습니다 (HTTP ${response.status}).`,
      body?.code,
      body?.retryable === true,
      body?.missing,
    );
  }

  return response.json() as Promise<T>;
}

function query(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function fetchHealth() {
  return request<ConsoleHealth>("/api/health");
}

export function fetchSession() {
  return request<{
    user: AuthenticatedUser | null;
    correctionsEnabled: boolean;
    adminGridUrl: string | null;
    inspectionBase: string | null;
  }>("/api/session");
}

export function login(userId: string, password: string) {
  return request<{ user: AuthenticatedUser }>("/api/login", {
    method: "POST",
    body: JSON.stringify({ userId, password }),
  });
}

export function logout() {
  return request<{ ok: true }>("/api/logout", { method: "POST" });
}

/**
 * The only filters the inspection app actually honours. Verified on
 * production: `date` and `selectedCenter` change nothing (the same 1,890 rows
 * come back for any date), so they are not offered. `filterMode` is `current`
 * (today's job) or `all` (every retained job); a single job is selected from
 * the rows already received.
 */
export type FilterMode = "current" | "all";

export interface RowFilters {
  filterMode: FilterMode;
  [key: string]: string | undefined;
}

export function fetchRows(filters: RowFilters) {
  return request<InspectionRowsResponse>(`/api/ops/rows${query(filters)}`);
}

export function fetchMovements(filters: RowFilters) {
  return request<{ ok?: boolean; records?: MovementRecord[] }>(
    `/api/ops/movements${query(filters)}`,
  );
}

export function fetchHistory() {
  return request<{ ok?: boolean; data?: unknown[] }>("/api/ops/history");
}

/** The app needs both the operation id and the payload hash to find a receipt. */
export function fetchWriteStatus(operationId: string, kind: string, payloadHash: string) {
  return request<WriteReceipt>("/api/ops/write-status", {
    method: "POST",
    body: JSON.stringify({ operationId, kind, payloadHash }),
  });
}

export function recoverWrite(operationId: string, kind: string, payloadHash: string, reason?: string) {
  return request<WriteReceipt>("/api/ops/recover-write", {
    method: "POST",
    body: JSON.stringify({ operationId, kind, payloadHash, reason }),
  });
}

export function correctQty(correction: QtyCorrection) {
  return request<{ saved: WriteReceipt }>("/api/ops/correct-qty", {
    method: "POST",
    body: JSON.stringify(correction),
  });
}

/**
 * Resolve an uncertain correction by reading the canonical row back. This is
 * the only correct response to a timeout: never resubmit the write.
 */
export function confirmQty(jobKey: string, productCode: string, requestId: string) {
  return request<QtyConfirmation>("/api/ops/confirm-qty", {
    method: "POST",
    body: JSON.stringify({ jobKey, productCode, requestId }),
  });
}

/** Photo URL. The signed id is itself the capability, so no header is needed. */
export function photoUrl(base: string, id: string, size = "w320") {
  return `${base}/api/photo?id=${encodeURIComponent(id)}&sz=${encodeURIComponent(size)}`;
}

/** `qty-<timestamp>-<id>`: the app parses the timestamp for write ordering. */
export function newQtyRequestId() {
  return `qty-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}
