/**
 * Browser-side API client. Always same-origin `/api/*`: the session cookie is
 * httpOnly and the inspection app's token never leaves our server.
 */
import type {
  AuthenticatedUser,
  ConsoleHealth,
  DatasetEntry,
  GridView,
  HistoryResult,
  PreviewResult,
  SaveResult,
} from "./domain/types";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  /** Set on a 503: which environment variables are missing. */
  readonly missing?: string[];

  constructor(status: number, message: string, code?: string, missing?: string[]) {
    super(message);
    this.status = status;
    this.code = code;
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
      .then((parsed: { error?: string; code?: string; missing?: string[] }) => parsed)
      .catch(() => undefined);
    throw new ApiError(
      response.status,
      body?.error ?? `요청이 실패했습니다 (HTTP ${response.status}).`,
      body?.code,
      body?.missing,
    );
  }

  return response.json() as Promise<T>;
}

export function fetchHealth() {
  return request<ConsoleHealth>("/api/health");
}

export function fetchSession() {
  return request<{ user: AuthenticatedUser | null; writesEnabled: boolean }>("/api/session");
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

export function fetchDatasets() {
  return request<{ datasets: DatasetEntry[] }>("/api/master/datasets");
}

export function fetchView(name: string) {
  return request<{ view: GridView }>(`/api/master/datasets/${encodeURIComponent(name)}`);
}

export function fetchHistory(name: string) {
  return request<HistoryResult>(`/api/master/datasets/${encodeURIComponent(name)}/history`);
}

/** The CAS pair every write carries, taken from the view it was based on. */
export interface GridSubmission {
  columns: string[];
  rows: string[][];
  expectedRevision: number;
  sourceHash: string;
}

/** Validate only; the inspection app reports per-cell errors and writes nothing. */
export function previewGrid(name: string, submission: GridSubmission) {
  return request<PreviewResult>(`/api/master/datasets/${encodeURIComponent(name)}/preview`, {
    method: "POST",
    body: JSON.stringify(submission),
  });
}

/**
 * Commit. Reuse the `operationId` from the preview: the write is idempotent
 * on that id, so a retry confirms the first attempt rather than applying a
 * second one.
 */
export function saveGrid(name: string, submission: GridSubmission, operationId: string) {
  return request<SaveResult>(`/api/master/datasets/${encodeURIComponent(name)}/save`, {
    method: "POST",
    body: JSON.stringify({ ...submission, operationId }),
  });
}

export function fetchWriteStatus(operationId: string, payloadHash?: string) {
  return request<SaveResult>("/api/master/write-status", {
    method: "POST",
    body: JSON.stringify({ operationId, payloadHash }),
  });
}
