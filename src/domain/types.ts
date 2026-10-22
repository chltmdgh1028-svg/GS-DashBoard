/**
 * Inspection Master Console - shared types.
 *
 * These mirror the inspection app's admin-grid contract exactly, because the
 * console is a second UI over that API rather than its own data model. The
 * grid is positional: `rows` is an array of rows, each an array of cells in
 * `columns` order, which is how the app validates and diffs them.
 */

export type Role = "admin";

export interface AuthenticatedUser {
  role: Role;
  userId: string;
  displayName: string;
}

/* --------------------------------------------------------------- Datasets */

/** The master datasets the inspection app exposes - the Google Sheet tabs. */
export interface DatasetEntry {
  name: string;
  label: string;
}

/* ------------------------------------------------------------------- Grid */

export interface GridColumn {
  key?: string;
  label: string;
  /** The app's inferred cell type: text, code, number, date, … */
  type: string;
  readOnly?: boolean;
  required?: boolean;
  options?: string[];
}

export interface RowMetadata {
  updatedAt?: string;
  updatedBy?: string;
}

/** `getAdminGrid`: the current state of one dataset. */
export interface GridView {
  dataset: string;
  label: string;
  columns: GridColumn[];
  /** Positional cells, in `columns` order. */
  rows: string[][];
  /** CAS token. Echoed on preview and save; a mismatch is a write conflict. */
  revision: number;
  /** Hash of the source the view was built from. Also part of the CAS check. */
  sourceHash: string;
  rowMetadata?: RowMetadata[];
  sourceOwner?: string;
}

export interface CellError {
  row: number;
  col: number;
  message: string;
}

export interface RowWarning {
  row: number;
  message: string;
}

/** `previewAdminGrid`: what a save would do. Writes nothing. */
export interface PreviewResult {
  ok: boolean;
  rows?: string[][];
  columns?: GridColumn[];
  errors: CellError[];
  warnings?: RowWarning[];
  /** The app's row-level diff against the current view. */
  changes?: unknown[];
  matches?: unknown[];
}

/** `saveAdminGrid`: the commit receipt. */
export interface SaveResult {
  ok: boolean;
  error?: string;
  message?: string;
  pendingWrite?: boolean;
  retryable?: boolean;
  nativeAck?: {
    state: string;
    operationId: string;
    payloadHash: string | null;
    authoritative: boolean;
  };
}

export interface HistoryResult {
  changes: unknown[];
}

/* ----------------------------------------------------------------- Health */

export interface ConsoleHealth {
  ok: boolean;
  adminConfigured: boolean;
  sessionSecretConfigured: boolean;
  inspectionApiConfigured: boolean;
  missingInspectionVars: string[];
  writesEnabled: boolean;
}
