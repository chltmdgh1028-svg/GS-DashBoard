/**
 * Browser-side API client.
 *
 * Always same-origin `/api/*`: the session cookie is httpOnly, so the browser
 * never holds a token and nothing here needs to know how auth works.
 */
import type {
  AuthenticatedUser,
  ConsoleOverview,
  ConsoleScope,
  DecisionAction,
  ExceptionItem,
  InspectionRecord,
  InspectorLoad,
} from "./domain/types";

/** An exception as the queue endpoint returns it: overdue is computed server-side. */
export type QueuedException = ExceptionItem & { overdue: boolean };

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });

  if (!response.ok) {
    // An error body is not guaranteed - a platform-level 502 is plain text.
    const message = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => undefined);
    throw new ApiError(response.status, message ?? `요청이 실패했습니다 (HTTP ${response.status}).`);
  }

  return response.json() as Promise<T>;
}

function withDate(path: string, date?: string) {
  return date ? `${path}${path.includes("?") ? "&" : "?"}date=${encodeURIComponent(date)}` : path;
}

export function fetchSession() {
  return request<{ user: AuthenticatedUser | null; centers: string[] }>("/api/session");
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

export function fetchOverview(date?: string) {
  return request<ConsoleOverview>(withDate("/api/console/overview", date));
}

export function fetchExceptions(state: string, date?: string) {
  return request<{ businessDate: string; scope: ConsoleScope; items: QueuedException[] }>(
    withDate(`/api/console/exceptions?state=${encodeURIComponent(state)}`, date),
  );
}

/**
 * `date` is required: an exception id only resolves inside its own business
 * date, so a decision on yesterday's queue must say so.
 */
export function decideException(id: string, action: DecisionAction, date: string, note?: string) {
  return request<{ item: ExceptionItem }>(`/api/console/exceptions/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    body: JSON.stringify({ action, note, date }),
  });
}

export function fetchInspections(date?: string) {
  return request<{ businessDate: string; scope: ConsoleScope; records: InspectionRecord[] }>(
    withDate("/api/console/inspections", date),
  );
}

export function fetchInspectors(date?: string) {
  return request<{ businessDate: string; scope: ConsoleScope; inspectors: InspectorLoad[] }>(
    withDate("/api/console/inspectors", date),
  );
}
