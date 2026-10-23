/**
 * Filtering, ordering, grouping and summarising of inspection rows.
 *
 * Pure functions over the rows the inspection app returned, kept out of the
 * view so they can be checked against a real captured response. Nothing here
 * recomputes a business number: a summary only adds up what each row already
 * says, and 검품률 is Σ검품수량 / Σ발주수량 over the rows in view.
 */
import type { InspectionRow } from "../domain/types";
import { compareKo, compareSupplier, sortName } from "./korean";
import { photoIdsOf } from "../photos";

const text = (value: unknown) => (value == null ? "" : String(value));
export const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const supplierOf = (row: InspectionRow) => text(row.협력사명).trim();
export const dptOf = (row: InspectionRow) => text(row["DPT명"]).trim();
export const jobOf = (row: InspectionRow) => text(row.작업기준일또는CSV식별값).trim();
export const hasIssue = (row: InspectionRow) =>
  num(row.회송수량) > 0 || num(row.교환수량) > 0 || text(row.불량사유).trim() !== "";

/* ----------------------------------------------------------------- Filters */

export type StatusFilter = "all" | "done" | "todo";
export type IssueFilter = "all" | "any" | "return" | "exchange" | "reason";
export type PhotoFilter = "all" | "with" | "without";

export interface RowFilters {
  job: string;
  suppliers: string[];
  dpts: string[];
  status: StatusFilter;
  issue: IssueFilter;
  photo: PhotoFilter;
  query: string;
}

export const EMPTY_FILTERS: RowFilters = {
  job: "",
  suppliers: [],
  dpts: [],
  status: "all",
  issue: "all",
  photo: "all",
  query: "",
};

/** How many filters are narrowing the list (the job and search count; "all" values do not). */
export function activeFilterCount(f: RowFilters) {
  return (
    (f.job ? 1 : 0) +
    (f.suppliers.length ? 1 : 0) +
    (f.dpts.length ? 1 : 0) +
    (f.status !== "all" ? 1 : 0) +
    (f.issue !== "all" ? 1 : 0) +
    (f.photo !== "all" ? 1 : 0) +
    (f.query.trim() ? 1 : 0)
  );
}

export function applyFilters(rows: InspectionRow[], f: RowFilters): InspectionRow[] {
  const suppliers = new Set(f.suppliers);
  const dpts = new Set(f.dpts);
  const needle = f.query.trim().toLowerCase();

  return rows.filter((row) => {
    if (f.job && jobOf(row) !== f.job) return false;
    if (suppliers.size && !suppliers.has(supplierOf(row))) return false;
    if (dpts.size && !dpts.has(dptOf(row))) return false;

    const inspected = num(row.검품수량) > 0;
    if (f.status === "done" && !inspected) return false;
    if (f.status === "todo" && inspected) return false;

    if (f.issue === "any" && !hasIssue(row)) return false;
    if (f.issue === "return" && !(num(row.회송수량) > 0)) return false;
    if (f.issue === "exchange" && !(num(row.교환수량) > 0)) return false;
    if (f.issue === "reason" && text(row.불량사유).trim() === "") return false;

    if (f.photo !== "all") {
      const has = photoIdsOf(row).length > 0;
      if (f.photo === "with" && !has) return false;
      if (f.photo === "without" && has) return false;
    }

    if (needle) {
      const haystack = [row.상품코드, row.상품명, row.협력사명, row["DPT명"], row.불량사유]
        .map(text)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

/** Distinct values with how many rows carry each, in 가나다 order (blank last). */
export function facet(
  rows: InspectionRow[],
  pick: (row: InspectionRow) => string,
  blankLabel: string,
): { value: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(pick(row), (counts.get(pick(row)) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => compareSupplier(a, b))
    .map(([value, count]) => ({ value, label: value || blankLabel, count }));
}

/* ----------------------------------------------------------------- Sorting */

export type SortKey =
  | "supplier"
  | "name"
  | "code"
  | "dpt"
  | "ordered"
  | "inspected"
  | "rate"
  | "returns"
  | "exchanges"
  | "reason"
  | "photos"
  | "job";

export interface SortSpec {
  key: SortKey;
  dir: "asc" | "desc";
}

export const rateOf = (row: InspectionRow) => {
  const ordered = num(row.발주수량);
  return ordered > 0 ? num(row.검품수량) / ordered : 0;
};

const comparators: Record<SortKey, (a: InspectionRow, b: InspectionRow) => number> = {
  supplier: (a, b) => compareSupplier(supplierOf(a), supplierOf(b)),
  name: (a, b) => compareKo(text(a.상품명), text(b.상품명)),
  code: (a, b) => text(a.상품코드).localeCompare(text(b.상품코드)),
  dpt: (a, b) => compareKo(dptOf(a), dptOf(b)),
  ordered: (a, b) => num(a.발주수량) - num(b.발주수량),
  inspected: (a, b) => num(a.검품수량) - num(b.검품수량),
  rate: (a, b) => rateOf(a) - rateOf(b),
  returns: (a, b) => num(a.회송수량) - num(b.회송수량),
  exchanges: (a, b) => num(a.교환수량) - num(b.교환수량),
  reason: (a, b) => compareKo(text(a.불량사유), text(b.불량사유)),
  photos: (a, b) => photoIdsOf(a).length - photoIdsOf(b).length,
  job: (a, b) => jobOf(a).localeCompare(jobOf(b)),
};

/**
 * Order rows by one column. Ties always fall back to supplier → name → code so
 * the order is stable and a list never reshuffles between two equal values.
 */
export function sortRows(rows: InspectionRow[], spec: SortSpec): InspectionRow[] {
  const primary = comparators[spec.key];
  const sign = spec.dir === "asc" ? 1 : -1;
  return [...rows].sort(
    (a, b) =>
      primary(a, b) * sign ||
      comparators.supplier(a, b) ||
      comparators.name(a, b) ||
      comparators.code(a, b),
  );
}

/* ------------------------------------------------------------- Summaries */

export interface Summary {
  rows: number;
  /** Rows with 검품수량 > 0. */
  inspectedRows: number;
  ordered: number;
  inspected: number;
  /** Σ검품수량 / Σ발주수량, or 0 when nothing was ordered. */
  rate: number;
  returns: number;
  exchanges: number;
  photos: number;
}

export function summarize(rows: InspectionRow[]): Summary {
  let ordered = 0;
  let inspected = 0;
  let returns = 0;
  let exchanges = 0;
  let photos = 0;
  let inspectedRows = 0;
  for (const row of rows) {
    ordered += num(row.발주수량);
    inspected += num(row.검품수량);
    returns += num(row.회송수량);
    exchanges += num(row.교환수량);
    photos += photoIdsOf(row).length;
    if (num(row.검품수량) > 0) inspectedRows += 1;
  }
  return {
    rows: rows.length,
    inspectedRows,
    ordered,
    inspected,
    rate: ordered > 0 ? inspected / ordered : 0,
    returns,
    exchanges,
    photos,
  };
}

/* ---------------------------------------------------------------- Grouping */

export interface SupplierGroup {
  /** The supplier name exactly as received ("" for rows without one). */
  key: string;
  label: string;
  rows: InspectionRow[];
  summary: Summary;
}

export const NO_SUPPLIER_LABEL = "(협력사 미지정)";

/**
 * Group by supplier in 가나다 order. Rows inside a group keep the order they
 * arrive in, so sort them first. Blank suppliers form one group, always last.
 */
export function groupBySupplier(rows: InspectionRow[], direction: "asc" | "desc" = "asc"): SupplierGroup[] {
  const byKey = new Map<string, InspectionRow[]>();
  for (const row of rows) {
    const key = supplierOf(row);
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  return [...byKey.entries()]
    .sort(([a], [b]) => compareSupplier(a, b, direction))
    .map(([key, groupRows]) => ({
      key,
      label: key || NO_SUPPLIER_LABEL,
      rows: groupRows,
      summary: summarize(groupRows),
    }));
}

/** First 가나다 initial of a supplier, for a jump index (ㄱ, ㄴ, ...); anything else becomes "A-Z". */
export function initialOf(name: string): string {
  const first = sortName(name).charAt(0);
  if (!first) return "#";
  const code = first.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const initials = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
    const raw = initials[Math.floor((code - 0xac00) / 588)];
    // Tense consonants are indexed under their plain one, as a printed directory does.
    return ({ ㄲ: "ㄱ", ㄸ: "ㄷ", ㅃ: "ㅂ", ㅆ: "ㅅ", ㅉ: "ㅈ" } as Record<string, string>)[raw] ?? raw;
  }
  return "A-Z";
}
