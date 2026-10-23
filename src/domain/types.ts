/**
 * Inspection Operations Console - shared types.
 *
 * The inspection app answers with the field app's own row shape: Korean
 * column names, loosely typed cells, `__`-prefixed internals. Those names are
 * kept verbatim rather than mapped to English, so a value on this screen and
 * a value in the field app are visibly the same field and a row discussed in
 * one is findable in the other.
 */

export type Role = "admin";

export interface AuthenticatedUser {
  role: Role;
  userId: string;
  displayName: string;
}

/**
 * One inspection row as `getInspectionRows` returns it, named from a real
 * production response (2026-10-23, 1,890 rows) rather than from the app's
 * source. Notably absent from a row: 센터명 and 불량수량. The defect picture is
 * 불량사유 + 회송수량 + 교환수량; the center only exists on 회송/교환 records.
 * Fields the console does not read stay reachable through the index signature.
 */
export interface InspectionRow {
  __rowNumber?: number;
  작업기준일또는CSV식별값?: string;
  상품코드?: string;
  상품명?: string;
  협력사명?: string;
  standardPartnerName?: string;
  "DPT명"?: string;
  소분류명?: string;
  발주수량?: number | string;
  검품수량?: number | string;
  회송수량?: number | string;
  교환수량?: number | string;
  불량사유?: string;
  버전?: number | string;
  수량요청ID?: string;
  수량요청리비전?: number | string;
  작성일시?: string;
  수정일시?: string;
  photoFileIds?: string[];
  사진파일ID목록?: string;
  [key: string]: unknown;
}

export interface InspectionRowsResponse {
  ok?: boolean;
  rows?: InspectionRow[];
  /** Observed: `{ version, lastAction, lastUpdated }` of the canonical source. */
  sourceVersion?: { version?: string; lastAction?: string; lastUpdated?: string };
  rowIdentityNamespace?: string;
  [key: string]: unknown;
}

/**
 * 회송 / 교환 record as `getReturnExchangeRecords` returns it (key `records`,
 * confirmed on production). `처리유형` is 회송 or 교환; the amounts are the
 * separate 회송수량 / 교환수량 columns; the status is `effectiveActionStatus`.
 */
export interface MovementRecord {
  __rowNumber?: number;
  작성일시?: string;
  작업기준일또는CSV식별값?: string;
  상품명?: string;
  상품코드?: string;
  센터명?: string;
  협력사명?: string;
  처리유형?: string;
  회송수량?: number | string;
  교환수량?: number | string;
  불량사유?: string;
  비고?: string;
  사진개수?: number | string;
  수정자?: string;
  수정일시?: string;
  recordId?: string;
  operationId?: string;
  autoActionStatus?: string;
  overrideActionStatus?: string;
  effectiveActionStatus?: string;
  [key: string]: unknown;
}

/* ------------------------------------------------------- Write receipts */

/** The native write ledger's verdict on one operation. */
export interface NativeAck {
  version?: number;
  backend?: string;
  operationId?: string;
  kind?: string;
  payloadHash?: string | null;
  /** COMMITTED | REJECTED | PENDING | UNKNOWN */
  state?: string;
  authoritative?: boolean;
  retryAfterMs?: number;
}

export interface WriteReceipt {
  ok?: boolean;
  error?: string;
  message?: string;
  pendingWrite?: boolean;
  retryable?: boolean;
  nativeAck?: NativeAck;
  [key: string]: unknown;
}

/** `confirmInspectionQty`: whether this exact request is what the row now holds. */
export interface QtyConfirmation {
  ok?: boolean;
  matches?: boolean;
  requestIdMatched?: boolean;
  [key: string]: unknown;
}

/** What a correction needs from the row it was made against. */
export interface QtyCorrection {
  jobKey: string;
  productCode: string;
  partnerName: string;
  productName?: string;
  qty: number;
  orderQty?: number;
  /** The qty the operator was looking at. The app refuses the write if it moved. */
  baseQty: number;
  /** The row's 수량요청리비전 as read. Closes the gap where a qty changes and changes back. */
  baseRevision?: number;
  /** `qty-<timestamp>-<id>`; stable across retries of the same correction. */
  requestId: string;
}

/**
 * What a save actually did, per row. `ok: true` from the app does NOT mean the
 * correction landed - a CAS conflict is also `ok: true` - so this is read from
 * the per-row result and nothing else.
 */
export type QtyStatus =
  | "updated"
  | "idempotent_replay"
  | "conflict"
  | "stale_ignored"
  | "blocked"
  | "pending"
  | "unknown";

export interface QtyOutcome {
  status: QtyStatus;
  reason?: string;
  message?: string;
  /** The qty the app says it saved. */
  savedQty?: number;
  /** On a conflict: the value the row holds now, to show instead of overwriting it. */
  currentQty?: number;
  currentRevision?: number;
  version?: string;
  updatedAt?: string;
}

/**
 * The canonical row read back after a save (or after an uncertain one). This,
 * not the save response, is what decides whether the correction is in effect.
 */
export interface QtyVerification {
  found: boolean;
  qty?: number;
  revision?: number;
  requestId?: string;
  version?: string;
  updatedAt?: string;
  matchesQty: boolean;
  matchesRequestId: boolean;
  /** Supplementary: the app's own confirmInspectionQty. May be inconclusive; never decides alone. */
  confirm?: { matches?: boolean; requestIdMatched?: boolean; error?: string };
}

/* ----------------------------------------------------------------- Health */

export interface ConsoleHealth {
  ok: boolean;
  adminConfigured: boolean;
  sessionSecretConfigured: boolean;
  inspectionApiConfigured: boolean;
  missingInspectionVars: string[];
  correctionsEnabled: boolean;
}
