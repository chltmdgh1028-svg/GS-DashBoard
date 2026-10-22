/**
 * Inspection Operations Console - domain model.
 *
 * The vocabulary here is deliberately the same as the 검품 (inspection) data
 * already produced by the field app: a 검품 건 is an `InspectionRecord`, its
 * outcome is an `InspectionResult`, quantities are 입고/검품/불량/반품/교환.
 * Reusing those names means a number on this screen and a number in the
 * inspection report mean the same thing.
 *
 * What makes this a *console* rather than a dashboard: every rate is computed
 * once on the server and carried on the payload, and the things an operator
 * must act on are first-class (`ExceptionItem`) and carry a decision.
 */

export type Role = "admin" | "center";

export interface AuthenticatedUser {
  role: Role;
  userId: string;
  displayName: string;
  /** Set for role "center": the only center this user may read. */
  center?: string;
}

/* ------------------------------------------------------------- Inspection */

export type InspectionResult = "normal" | "return" | "exchange" | "defect";

/** Severity levels the shared UI kit renders (ValidationBadge). */
export type Severity = "info" | "warning" | "error";

export type CenterHealth = "normal" | "warning" | "error";

export interface InspectionRecord {
  id: string;
  /** Business date, YYYY-MM-DD. */
  date: string;
  /** Local time of the inspection, HH:mm. */
  time: string;
  center: string;
  sku: string;
  productName: string;
  category: string;
  supplier: string;
  inspector: string;
  inboundQty: number;
  inspectionQty: number;
  defectQty: number;
  returnQty: number;
  exchangeQty: number;
  /** inspectionQty / inboundQty, computed server-side. */
  inspectionRate: number;
  /** defectQty / inspectionQty, computed server-side. */
  defectRate: number;
  result: InspectionResult;
  defectReasons: string[];
  photoCount: number;
}

/* -------------------------------------------------------------- Exceptions */

/**
 * The reasons an inspection lands in the operator's queue. Each one is a
 * condition the field app cannot resolve by itself - it needs a decision from
 * 본사 운영 or the center lead.
 */
export type ExceptionKind =
  | "defect_critical"
  | "return_pending"
  | "exchange_pending"
  | "inspection_shortfall"
  | "photo_missing";

export type ExceptionState = "open" | "held" | "resolved" | "dismissed";

export type DecisionAction = "hold" | "approve" | "reject" | "dismiss";

export interface ExceptionDecision {
  action: DecisionAction;
  note?: string;
  decidedBy: string;
  decidedAt: string;
}

export interface ExceptionItem {
  id: string;
  inspectionId: string;
  kind: ExceptionKind;
  severity: Severity;
  state: ExceptionState;
  center: string;
  sku: string;
  productName: string;
  supplier: string;
  inspector: string;
  /** ISO timestamp the exception was raised. */
  raisedAt: string;
  /** ISO timestamp the decision is due. Past due and still open = overdue. */
  dueAt: string;
  summary: string;
  defectRate?: number;
  qty?: number;
  decision?: ExceptionDecision;
}

/* ----------------------------------------------------------- Center status */

export interface CenterStatus {
  center: string;
  health: CenterHealth;
  inboundQty: number;
  inspectionQty: number;
  inspectionRate: number;
  /** Operating target for the inspection rate, e.g. 0.9. */
  inspectionTarget: number;
  defectQty: number;
  defectRate: number;
  openExceptions: number;
  overdueExceptions: number;
  inspectorCount: number;
  lastActivityAt?: string;
}

/* -------------------------------------------------------------- Overview */

export interface ConsoleTotals {
  inboundQty: number;
  inspectionQty: number;
  inspectionRate: number;
  inspectionTarget: number;
  defectQty: number;
  defectRate: number;
  returnQty: number;
  exchangeQty: number;
  inspectedSkus: number;
  photoCount: number;
}

export interface HourlyBucket {
  /** HH:00 label. */
  hour: string;
  inspectionQty: number;
  defectQty: number;
}

export interface ConsoleScope {
  label: string;
  centers: string[];
}

export interface ConsoleOverview {
  /** When the server produced this payload. */
  asOf: string;
  businessDate: string;
  scope: ConsoleScope;
  totals: ConsoleTotals;
  openExceptions: number;
  overdueExceptions: number;
  criticalExceptions: number;
  centers: CenterStatus[];
  hourly: HourlyBucket[];
  /** True when the payload came from the built-in seed, not a live source. */
  seeded: boolean;
}

/* ------------------------------------------------------------ Inspectors */

export interface InspectorLoad {
  inspector: string;
  center: string;
  inspections: number;
  inspectionQty: number;
  defectQty: number;
  defectRate: number;
  openExceptions: number;
  lastActivityAt?: string;
}
