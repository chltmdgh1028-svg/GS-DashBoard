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
 * One inspection row as `getInspectionRows` returns it. Only the fields the
 * console actually reads are named; the rest stay accessible through the
 * index signature, because the app may add a column without a release here.
 */
export interface InspectionRow {
  __rowNumber?: number;
  작업기준일또는CSV식별값?: string;
  상품코드?: string;
  상품명?: string;
  협력사명?: string;
  센터명?: string;
  발주수량?: number | string;
  검품수량?: number | string;
  불량수량?: number | string;
  불량사유?: string;
  비고?: string;
  버전?: number | string;
  작성일시?: string;
  수정일시?: string;
  [key: string]: unknown;
}

export interface InspectionRowsResponse {
  ok?: boolean;
  rows?: InspectionRow[];
  diagnostics?: Record<string, unknown>;
  photos?: unknown;
  [key: string]: unknown;
}

/** 회송 / 교환 record. Same treatment: the app's own field names. */
export interface MovementRecord {
  __rowNumber?: number;
  구분?: string;
  상품코드?: string;
  상품명?: string;
  협력사명?: string;
  센터명?: string;
  수량?: number | string;
  사유?: string;
  처리상태?: string;
  작성일시?: string;
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
  partnerName?: string;
  productName?: string;
  qty: number;
  orderQty?: number;
  /** The qty the operator was looking at. The app refuses the write if it moved. */
  baseQty: number;
  baseRevision?: number;
  /** `qty-<timestamp>-<id>`; stable across retries of the same correction. */
  requestId: string;
}

/* ----------------------------------------------------------------- Health */

export interface ConsoleHealth {
  ok: boolean;
  adminConfigured: boolean;
  sessionSecretConfigured: boolean;
  inspectionApiConfigured: boolean;
  missingInspectionVars: string[];
  correctionsEnabled: boolean;
  adminGridUrl: string | null;
  inspectionBase: string | null;
}
