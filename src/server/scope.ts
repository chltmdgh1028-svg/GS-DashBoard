import type {
  AggregateMetric,
  AuthenticatedUser,
  CampaignDataset,
  CampaignListItem,
  DashboardDataset,
  FocusSummary,
  Store,
  StoreDailySeriesPoint,
  StoreMetric,
} from "../domain/types";
import { safeDiv } from "../utils/format";

function sum<T>(rows: T[], pick: (row: T) => number | undefined) {
  return rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
}

function aggregate(label: string, level: AggregateMetric["level"], stores: Store[], metrics: StoreMetric[], key: string): AggregateMetric {
  const metricByStore = new Map(metrics.map((metric) => [metric.storeId, metric]));
  const selected = stores
    .map((store) => ({ store, metric: metricByStore.get(store.storeId) }))
    .filter((row) => row.metric);
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

function dailySeriesForStores(dataset: CampaignDataset, allowedStoreIds: Set<string>) {
  const grouped: Record<string, StoreDailySeriesPoint[]> = {};
  for (const storeId of allowedStoreIds) {
    const current = dataset.dailyMetrics.filter((row) => row.storeId === storeId && row.periodType === "current");
    const previous = dataset.dailyMetrics.filter((row) => row.storeId === storeId && row.periodType === "previous");
    const max = Math.max(current.length, previous.length);
    grouped[storeId] = Array.from({ length: max }, (_, index) => ({
      day: `${index + 1}일차`,
      currentSales: current[index]?.salesAmount,
      previousSales: previous[index]?.salesAmount,
      purchaseCost: current[index]?.purchaseCost,
    }));
  }
  return grouped;
}

function focusRateForStores(dataset: CampaignDataset, focusUnitId: string, storeIds: Set<string>) {
  const rows = dataset.focusMetrics.filter((metric) => metric.focusUnitId === focusUnitId && storeIds.has(metric.storeId));
  return safeDiv(rows.filter((metric) => metric.handled).length, rows.length);
}

function focusSummaries(dataset: CampaignDataset, stores: Store[], user: AuthenticatedUser): FocusSummary[] {
  const nationalStoreIds = new Set(dataset.stores.map((store) => store.storeId));
  const ownStoreIds = new Set(stores.map((store) => store.storeId));
  const ownTeam = stores[0]?.team;
  const teamStoreIds = new Set(dataset.stores.filter((store) => store.team === ownTeam).map((store) => store.storeId));

  return dataset.focusUnits.map((unit) => ({
    focusUnitId: unit.focusUnitId,
    focusUnitName: unit.focusUnitName,
    categoryName: unit.categoryName,
    productCodes: unit.productCodes,
    nationalRate: focusRateForStores(dataset, unit.focusUnitId, nationalStoreIds),
    teamRate: user.role === "ofc" ? focusRateForStores(dataset, unit.focusUnitId, teamStoreIds) : undefined,
    ofcRate: user.role === "ofc" ? focusRateForStores(dataset, unit.focusUnitId, ownStoreIds) : undefined,
  }));
}

export function campaignMeta(dataset: CampaignDataset): CampaignListItem {
  return {
    id: dataset.config.campaignId,
    campaignName: dataset.config.campaignName,
    createdAt: dataset.createdAt,
    storeCount: dataset.stores.length,
    productCount: dataset.productCatalog.length,
    issueCount: dataset.issues.length,
  };
}

export function dashboardForUser(dataset: CampaignDataset, user: AuthenticatedUser): DashboardDataset {
  const isAdmin = user.role === "admin";
  const stores = isAdmin ? dataset.stores : dataset.stores.filter((store) => store.ofc === user.ofc);
  const storeIds = new Set(stores.map((store) => store.storeId));
  const storeMetrics = dataset.storeMetrics.filter((metric) => storeIds.has(metric.storeId));
  const ownStore = stores[0];
  const ownTeamAggregate = ownStore
    ? aggregate(ownStore.team ?? "소속팀 미지정", "team", dataset.stores.filter((store) => store.team === ownStore.team), dataset.storeMetrics, `team:${ownStore.team}`)
    : undefined;
  const ownOfcAggregate = ownStore
    ? aggregate(user.ofc ?? ownStore.ofc ?? "OFC 미지정", "ofc", stores, storeMetrics, `ofc:${user.ofc ?? ownStore.ofc}`)
    : undefined;

  return {
    config: {
      campaignId: dataset.config.campaignId,
      campaignName: dataset.config.campaignName,
      topN: dataset.config.topN,
    },
    adminConfig: isAdmin ? dataset.config : undefined,
    stores,
    storeMetrics,
    productCatalog: dataset.productCatalog,
    focusUnits: dataset.focusUnits,
    focusSummaries: focusSummaries(dataset, stores, user),
    dailySeriesByStore: dailySeriesForStores(dataset, storeIds),
    aggregates: isAdmin
      ? dataset.aggregates
      : {
          national: dataset.aggregates.national,
          businessUnits: [],
          teams: ownTeamAggregate ? [ownTeamAggregate] : [],
          ofcs: ownOfcAggregate ? [ownOfcAggregate] : [],
        },
    createdAt: dataset.createdAt,
    permissions: {
      canUpload: isAdmin,
      canManageCampaigns: isAdmin,
      canManageConfig: isAdmin,
      canViewValidation: isAdmin,
      canViewAllStores: isAdmin,
    },
    userScope: {
      role: user.role,
      ofc: user.ofc,
      team: ownStore?.team,
      businessUnit: ownStore?.businessUnit,
    },
    fileRoles: isAdmin ? dataset.fileRoles : undefined,
    issues: isAdmin ? dataset.issues : undefined,
  };
}

export function assertNoRawFacts(payload: DashboardDataset) {
  const forbidden = ["dailyMetrics", "categoryMetrics", "productMetrics", "focusMetrics"];
  return forbidden.filter((key) => Object.prototype.hasOwnProperty.call(payload, key));
}
