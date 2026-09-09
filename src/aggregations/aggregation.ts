import { safeDiv } from "../utils/format.js";
import type {
  AggregateMetric,
  CampaignConfig,
  CategoryMetric,
  DailyMetric,
  FocusStoreMetric,
  ProductMetric,
  QualityIssue,
  Store,
  StoreMetric,
} from "../domain/types.js";

interface StoreMetricInput {
  config: CampaignConfig;
  stores: Store[];
  operatingDays: Map<string, number>;
  dailyMetrics: DailyMetric[];
  categoryMetrics: CategoryMetric[];
  productMetrics: ProductMetric[];
  focusMetrics: FocusStoreMetric[];
  wasteCosts: Map<string, number>;
  freshSales: Map<string, number>;
  groupForCategory: (categoryCode: string) => string;
  issues: QualityIssue[];
}

function sum<T>(rows: T[], pick: (row: T) => number | undefined) {
  return rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
}

function byStore<T extends { storeId: string }>(rows: T[]) {
  const map = new Map<string, T[]>();
  for (const row of rows) map.set(row.storeId, [...(map.get(row.storeId) ?? []), row]);
  return map;
}

export function calculateStoreMetrics(input: StoreMetricInput): StoreMetric[] {
  const dailyByStore = byStore(input.dailyMetrics);
  const categoryByStore = byStore(input.categoryMetrics);
  const productByStore = byStore(input.productMetrics);
  const focusByStore = byStore(input.focusMetrics);

  return input.stores.map((store) => {
    const operatingDays = input.operatingDays.get(store.storeId);
    const currentDaily = (dailyByStore.get(store.storeId) ?? []).filter((metric) => metric.periodType === "current");
    const previousDaily = (dailyByStore.get(store.storeId) ?? []).filter((metric) => metric.periodType === "previous");
    const categories = categoryByStore.get(store.storeId) ?? [];
    const products = productByStore.get(store.storeId) ?? [];
    const focus = focusByStore.get(store.storeId) ?? [];
    const days = operatingDays && operatingDays > 0 ? operatingDays : undefined;

    const purchaseCostTotal = sum(currentDaily, (metric) => metric.purchaseCost);
    const categorySales: Record<string, number> = { cold: 0, fresh: 0, other: 0 };
    const categoryGrossProfit: Record<string, number> = { cold: 0, fresh: 0, other: 0 };
    for (const metric of categories) {
      const groupId = input.groupForCategory(metric.categoryCode);
      categorySales[groupId] = (categorySales[groupId] ?? 0) + metric.salesAmount;
      categoryGrossProfit[groupId] = (categoryGrossProfit[groupId] ?? 0) + metric.grossProfit;
    }

    const eventSalesFromCategory = Object.values(categorySales).reduce((a, b) => a + b, 0);
    const eventSalesFromDaily = sum(currentDaily, (metric) => metric.salesAmount);
    const eventSalesTotal = eventSalesFromDaily || eventSalesFromCategory;
    const previousSalesTotal = sum(previousDaily, (metric) => metric.salesAmount);
    const targetDailySales = store.businessUnit ? input.config.targetByBusinessUnit[store.businessUnit] : undefined;
    const eventDailyWon = safeDiv(eventSalesTotal, days);
    const targetAchievementRate = safeDiv(eventDailyWon, targetDailySales);
    const freshDailyWon = safeDiv(input.freshSales.get(store.storeId), days);
    const freshEventDailyWon = safeDiv(categorySales.fresh, days);
    const focusUnitIds = new Set(focus.map((metric) => metric.focusUnitId));
    const focusHandledUnits = focus.filter((metric) => metric.handled).length;
    const focusTotalUnits = focusUnitIds.size;
    const focusHandlingRate = safeDiv(focusHandledUnits, focusTotalUnits);
    const allProductCount = new Set(products.map((product) => product.productCode)).size;

    const productHandlingRate: Record<string, number | undefined> = {};
    for (const group of input.config.categoryGroups) {
      const groupProducts = products.filter((product) => group.id === "other" ? !input.config.categoryGroups.some((g) => g.id !== "other" && g.codes.includes(product.categoryCode)) : group.codes.includes(product.categoryCode));
      const unique = new Set(groupProducts.map((product) => product.productCode));
      const handled = new Set(groupProducts.filter((product) => product.inboundQty > 0).map((product) => product.productCode));
      productHandlingRate[group.id] = safeDiv(handled.size, unique.size);
    }
    productHandlingRate.all = safeDiv(new Set(products.filter((product) => product.inboundQty > 0).map((product) => product.productCode)).size, allProductCount);

    const categoryDailySales = Object.fromEntries(
      Object.entries(categorySales).map(([key, value]) => [key, safeDiv(value, days) ?? 0]),
    );
    const categoryProfitRate = Object.fromEntries(
      Object.entries(categoryGrossProfit).map(([key, value]) => [key, safeDiv(value, categorySales[key])]),
    );
    categoryProfitRate.all = safeDiv(Object.values(categoryGrossProfit).reduce((a, b) => a + b, 0), eventSalesFromCategory);

    const profitShare = store.storeType ? input.config.storeTypeProfitShare[store.storeType] : undefined;
    const grossProfitTotal = Object.values(categoryGrossProfit).reduce((a, b) => a + b, 0);
    const wasteCost = input.wasteCosts.get(store.storeId);
    const estimatedStoreProfit = profitShare == null
      ? undefined
      : grossProfitTotal * profitShare - (wasteCost ?? 0) * input.config.wasteChargeRate + (wasteCost ?? 0) * input.config.wasteChargeRate * input.config.wasteSupportRate;

    if (store.storeType && profitShare == null) {
      input.issues.push({ severity: "warning", category: "configuration", title: "손익 기준 미등록", detail: `${store.storeName}의 점포타입 ${store.storeType} 배분율이 Configuration에 없습니다.`, entityId: store.currentCode });
    }

    return {
      storeId: store.storeId,
      operatingDays,
      purchaseCostTotal,
      eventSalesTotal,
      eventDailySales: safeDiv(eventSalesTotal, days),
      previousSalesTotal,
      categorySales,
      categoryGrossProfit,
      categoryDailySales,
      categoryProfitRate,
      productHandlingRate,
      freshSalesTotal: input.freshSales.get(store.storeId),
      freshDailySales: freshDailyWon,
      eventFreshComposition: safeDiv(freshEventDailyWon, freshDailyWon),
      targetDailySales,
      targetAchievementRate,
      targetAchieved: targetAchievementRate != null && targetAchievementRate >= input.config.targetAchievementThreshold,
      targetScore: targetAchievementRate == null ? undefined : targetAchievementRate >= input.config.targetAchievementThreshold ? 0.5 : 0,
      focusHandledUnits,
      focusTotalUnits,
      focusHandlingRate,
      focusAchieved: focusHandlingRate != null && focusHandlingRate >= input.config.focusHandlingThreshold,
      focusScore: focusHandlingRate == null ? undefined : focusHandlingRate >= input.config.focusHandlingThreshold ? 0.5 : 0,
      wasteCost,
      profitShare,
      estimatedStoreProfit,
      topProducts: [...products]
        .filter((product) => product.salesAmount > 0)
        .sort((a, b) => b.salesAmount - a.salesAmount)
        .slice(0, input.config.topN),
    };
  });
}

function aggregate(label: string, level: AggregateMetric["level"], stores: Store[], metrics: StoreMetric[], key: string): AggregateMetric {
  const metricByStore = new Map(metrics.map((metric) => [metric.storeId, metric]));
  const selected = stores
    .map((store) => ({ store, metric: metricByStore.get(store.storeId) }))
    .filter(
      (row) =>
        row.metric &&
        ((row.metric.operatingDays ?? 0) > 0 ||
          row.metric.eventSalesTotal > 0 ||
          row.metric.purchaseCostTotal > 0 ||
          row.metric.productHandlingRate.all != null),
    );
  const operatingDays = sum(selected, (row) => row.metric?.operatingDays);
  const eventSalesTotal = sum(selected, (row) => row.metric?.eventSalesTotal);
  const freshSalesTotal = sum(selected, (row) => row.metric?.freshSalesTotal);
  const freshEventSalesTotal = sum(selected, (row) => row.metric?.categorySales.fresh);
  const focusHandled = sum(selected, (row) => row.metric?.focusHandledUnits);
  const focusTotal = sum(selected, (row) => row.metric?.focusTotalUnits);

  return {
    key,
    label,
    level,
    businessUnit: selected[0]?.store.businessUnit,
    region: selected[0]?.store.region,
    team: selected[0]?.store.team,
    ofc: selected[0]?.store.ofc,
    storeCount: selected.length,
    ofcCount: new Set(selected.map((row) => row.store.ofc).filter(Boolean)).size,
    operatingDays,
    purchaseCostTotal: sum(selected, (row) => row.metric?.purchaseCostTotal),
    eventSalesTotal,
    eventDailySales: safeDiv(eventSalesTotal, operatingDays),
    coldDailySales: safeDiv(sum(selected, (row) => row.metric?.categorySales.cold), operatingDays),
    freshEventDailySales: safeDiv(freshEventSalesTotal, operatingDays),
    otherDailySales: safeDiv(sum(selected, (row) => row.metric?.categorySales.other), operatingDays),
    targetAchievedStores: selected.filter((row) => row.metric?.targetAchieved).length,
    focusAchievedStores: selected.filter((row) => row.metric?.focusAchieved).length,
    focusHandlingRate: safeDiv(focusHandled, focusTotal),
    freshDailySales: safeDiv(freshSalesTotal, operatingDays),
    eventFreshComposition: safeDiv(safeDiv(freshEventSalesTotal, operatingDays), safeDiv(freshSalesTotal, operatingDays)),
  };
}

function groupBy<T>(items: T[], key: (item: T) => string | undefined) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return map;
}

export function aggregateAll(stores: Store[], metrics: StoreMetric[]) {
  const national = aggregate("전국", "national", stores, metrics, "national");
  const businessUnits = [...groupBy(stores, (store) => store.businessUnit)].map(([key, rows]) => aggregate(key, "businessUnit", rows, metrics, key));
  const teams = [...groupBy(stores, (store) => store.team)].map(([key, rows]) => aggregate(key, "team", rows, metrics, key));
  const ofcs = [...groupBy(stores, (store) => `${store.team}|${store.ofc}`)].map(([key, rows]) => aggregate(rows[0].ofc ?? key, "ofc", rows, metrics, key));
  return {
    national,
    businessUnits: businessUnits.sort((a, b) => a.label.localeCompare(b.label, "ko")),
    teams: teams.sort((a, b) => a.label.localeCompare(b.label, "ko")),
    ofcs: ofcs.sort((a, b) => `${a.team}${a.label}`.localeCompare(`${b.team}${b.label}`, "ko")),
  };
}
