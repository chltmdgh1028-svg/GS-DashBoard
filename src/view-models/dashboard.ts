/**
 * Presentation view models.
 *
 * Nothing in this file recomputes a KPI. It only:
 *  - joins values the server already produced (store + metric + aggregate),
 *  - derives a display-level comparison against the previous flyer from the
 *    already-computed `previousSalesTotal`,
 *  - turns server-computed booleans (`focusAchieved`, `targetAchieved`) into a
 *    coaching priority so an OFC can sort by "what to look at first".
 *
 * The verified aggregation in src/aggregations and src/server is untouched.
 */
import type { AggregateMetric, DashboardDataset, Store, StoreMetric } from "../domain/types";
import type { StatusKind } from "../ui/Badge";
import { ratioChange } from "./format";

/**
 * Display banding for the previous-flyer comparison.
 *
 * The comparison is *relative to the group being looked at*, not absolute:
 * a whole campaign can sit well below the previous flyer, and in that case an
 * absolute -20% rule would paint every row red and say nothing. What an OFC
 * needs is "this store is doing clearly worse than my other stores".
 */
export const RELATIVE_GAP_ALERT = -0.15;
export const RELATIVE_GAP_WATCH = -0.05;

export interface StoreRow {
  key: string;
  store: Store;
  metric: StoreMetric;
  /** (행사 총매출 / 직전전단 총매출) - 1 */
  previousDelta?: number;
  /** How far this store's change sits below the group's own change, in points. */
  relativeGap?: number;
  status: StatusKind;
  reasons: string[];
  /** Higher = look at this store first. */
  priority: number;
}

function statusOf(metric: StoreMetric, relativeGap?: number) {
  const reasons: string[] = [];
  let priority = 0;

  const hasData = (metric.operatingDays ?? 0) > 0 || metric.eventSalesTotal > 0;
  if (!hasData) {
    return { status: "nodata" as StatusKind, reasons: ["행사 실적 데이터 없음"], priority: 3 };
  }

  if (metric.focusTotalUnits > 0 && !metric.focusAchieved) {
    reasons.push("중점상품 취급률 기준 미달");
    priority += 2;
  }
  if (metric.targetAchievementRate != null && !metric.targetAchieved) {
    reasons.push("목표 일매출 미달");
    priority += 1;
  }
  if (relativeGap != null && relativeGap <= RELATIVE_GAP_ALERT) {
    reasons.push("직전전단 대비가 그룹 평균보다 크게 부진");
    priority += 2;
  } else if (relativeGap != null && relativeGap <= RELATIVE_GAP_WATCH) {
    reasons.push("직전전단 대비가 그룹 평균 이하");
    priority += 1;
  }

  const status: StatusKind = priority >= 2 ? "action" : priority === 1 ? "watch" : "good";
  return { status, reasons, priority };
}

export function buildStoreRows(dataset: DashboardDataset, storeFilter?: (store: Store) => boolean): StoreRow[] {
  const metricByStore = new Map(dataset.storeMetrics.map((metric) => [metric.storeId, metric]));
  const selected: { store: Store; metric: StoreMetric; previousDelta?: number }[] = [];
  let groupCurrent = 0;
  let groupPrevious = 0;

  for (const store of dataset.stores) {
    if (storeFilter && !storeFilter(store)) continue;
    const metric = metricByStore.get(store.storeId);
    if (!metric) continue;
    const previousDelta = ratioChange(metric.eventSalesTotal, metric.previousSalesTotal || undefined);
    if (previousDelta != null) {
      groupCurrent += metric.eventSalesTotal;
      groupPrevious += metric.previousSalesTotal;
    }
    selected.push({ store, metric, previousDelta });
  }

  const groupDelta = ratioChange(groupCurrent, groupPrevious || undefined);

  return selected.map(({ store, metric, previousDelta }) => {
    const relativeGap =
      previousDelta == null || groupDelta == null ? undefined : previousDelta - groupDelta;
    const { status, reasons, priority } = statusOf(metric, relativeGap);
    return { key: store.storeId, store, metric, previousDelta, relativeGap, status, reasons, priority };
  });
}

/** Group-level previous-flyer change for the same store set buildStoreRows used. */
export function storeRowsGroupDelta(rows: StoreRow[]) {
  let current = 0;
  let previous = 0;
  for (const row of rows) {
    if (row.previousDelta == null) continue;
    current += row.metric.eventSalesTotal;
    previous += row.metric.previousSalesTotal;
  }
  return ratioChange(current, previous || undefined);
}

export function storeRowSummary(rows: StoreRow[]) {
  return {
    total: rows.length,
    action: rows.filter((row) => row.status === "action").length,
    watch: rows.filter((row) => row.status === "watch").length,
    good: rows.filter((row) => row.status === "good").length,
    nodata: rows.filter((row) => row.status === "nodata").length,
  };
}

/* ------------------------------------------------ previous-flyer comparison */

interface ScopeTotals {
  storeCount: number;
  current: number;
  previous: number;
}

/**
 * Mirrors the inclusion rule used by the verified aggregation layer
 * (aggregations/aggregation.ts) so that the client-side previous-flyer total
 * is summed over exactly the same stores as the server-side current total.
 */
function participatesInAggregate(metric: StoreMetric) {
  return (
    (metric.operatingDays ?? 0) > 0 ||
    metric.eventSalesTotal > 0 ||
    metric.purchaseCostTotal > 0 ||
    metric.productHandlingRate.all != null
  );
}

export interface ComparisonIndex {
  national?: ScopeTotals;
  byBusinessUnit: Map<string, ScopeTotals>;
  byTeam: Map<string, ScopeTotals>;
  byOfc: Map<string, ScopeTotals>;
  /** OFC name only - used when the aggregate was built for a single OFC user. */
  byOfcName: Map<string, ScopeTotals>;
}

function add(map: Map<string, ScopeTotals>, key: string | undefined, metric: StoreMetric) {
  if (!key) return;
  const current = map.get(key) ?? { storeCount: 0, current: 0, previous: 0 };
  current.storeCount += 1;
  current.current += metric.eventSalesTotal;
  current.previous += metric.previousSalesTotal;
  map.set(key, current);
}

export function buildComparisonIndex(dataset: DashboardDataset): ComparisonIndex {
  const metricByStore = new Map(dataset.storeMetrics.map((metric) => [metric.storeId, metric]));
  const index: ComparisonIndex = {
    national: { storeCount: 0, current: 0, previous: 0 },
    byBusinessUnit: new Map(),
    byTeam: new Map(),
    byOfc: new Map(),
    byOfcName: new Map(),
  };
  for (const store of dataset.stores) {
    const metric = metricByStore.get(store.storeId);
    if (!metric || !participatesInAggregate(metric)) continue;
    if (index.national) {
      index.national.storeCount += 1;
      index.national.current += metric.eventSalesTotal;
      index.national.previous += metric.previousSalesTotal;
    }
    add(index.byBusinessUnit, store.businessUnit, metric);
    add(index.byTeam, store.team, metric);
    add(index.byOfc, `${store.team}|${store.ofc}`, metric);
    add(index.byOfcName, store.ofc, metric);
  }
  return index;
}

function totalsFor(index: ComparisonIndex, aggregate: AggregateMetric) {
  if (aggregate.level === "national") return index.national;
  if (aggregate.level === "businessUnit") return index.byBusinessUnit.get(aggregate.key);
  if (aggregate.level === "team") return index.byTeam.get(aggregate.label);
  return index.byOfc.get(aggregate.key) ?? index.byOfcName.get(aggregate.label);
}

/**
 * Previous-flyer change for an aggregate row, or undefined when the logged-in
 * user cannot see every store behind that aggregate (an OFC sees the national
 * summary but only their own store facts, so a national delta would be wrong).
 */
export function previousDeltaFor(index: ComparisonIndex, aggregate: AggregateMetric) {
  const totals = totalsFor(index, aggregate);
  if (!totals || totals.storeCount !== aggregate.storeCount || totals.previous <= 0) return undefined;
  return ratioChange(totals.current, totals.previous);
}

export function previousTotalFor(index: ComparisonIndex, aggregate: AggregateMetric) {
  const totals = totalsFor(index, aggregate);
  if (!totals || totals.storeCount !== aggregate.storeCount || totals.previous <= 0) return undefined;
  return totals.previous;
}

/* ---------------------------------------------------------- focus products */

export interface FocusStoreRow {
  key: string;
  store: Store;
  handled: number;
  total: number;
  rate?: number;
  missing: number;
  achieved: boolean;
}

/**
 * Per-store focus coverage, built from the store metric the server already
 * scoped for this user. Per-SKU x per-store handling is not part of the
 * dashboard payload, so the SKU list stays at Focus Unit level.
 */
export function buildFocusStoreRows(dataset: DashboardDataset, storeFilter?: (store: Store) => boolean): FocusStoreRow[] {
  const metricByStore = new Map(dataset.storeMetrics.map((metric) => [metric.storeId, metric]));
  const rows: FocusStoreRow[] = [];
  for (const store of dataset.stores) {
    if (storeFilter && !storeFilter(store)) continue;
    const metric = metricByStore.get(store.storeId);
    if (!metric || metric.focusTotalUnits === 0) continue;
    rows.push({
      key: store.storeId,
      store,
      handled: metric.focusHandledUnits,
      total: metric.focusTotalUnits,
      rate: metric.focusHandlingRate,
      missing: metric.focusTotalUnits - metric.focusHandledUnits,
      achieved: metric.focusAchieved,
    });
  }
  return rows;
}

/* -------------------------------------------------------------- categories */

export const categoryLabels: Record<string, string> = {
  all: "전체",
  cold: "냉장/냉동/빵",
  fresh: "신선",
  other: "기타",
};

export function categoryRowsFor(metric: StoreMetric) {
  return ["all", "cold", "fresh", "other"].map((id) => ({
    id,
    label: categoryLabels[id] ?? id,
    sales: id === "all" ? metric.eventSalesTotal : (metric.categorySales[id] ?? 0),
    daily: id === "all" ? metric.eventDailySales : metric.categoryDailySales[id],
    profitRate: metric.categoryProfitRate[id],
    handlingRate: metric.productHandlingRate[id],
  }));
}

/* ---------------------------------------------------------------- helpers */

export function storeScopeLabel(store?: Store) {
  if (!store) return "-";
  return [store.businessUnit, store.team, store.ofc].filter(Boolean).join(" · ");
}

export function ofcsForTeam(dataset: DashboardDataset, team?: string) {
  return dataset.aggregates.ofcs.filter((row) => !team || row.team === team);
}
