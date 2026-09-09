export type FileRole =
  | "storeMaster"
  | "organizationMaster"
  | "operatingDays"
  | "currentDaily"
  | "previousDaily"
  | "categoryMetrics"
  | "wasteCost"
  | "productMetrics"
  | "focusProducts"
  | "freshSales"
  | "target"
  | "reference"
  | "unknown";

export type Severity = "error" | "warning" | "info";
export type QualityCategory =
  | "actualData"
  | "masterOrganization"
  | "coverage"
  | "configuration"
  | "displayAlias";

export interface QualityIssue {
  severity: Severity;
  category: QualityCategory;
  title: string;
  detail: string;
  entityId?: string;
}

export interface CategoryGroupConfig {
  id: "cold" | "fresh" | "other" | string;
  label: string;
  codes: string[];
}

export interface FocusUnitConfig {
  focusUnitId: string;
  focusUnitName: string;
  productCodes: string[];
  categoryCode?: string;
  categoryName?: string;
}

export interface CampaignConfig {
  campaignId: string;
  campaignName: string;
  startDate?: string;
  endDate?: string;
  categoryGroups: CategoryGroupConfig[];
  focusUnits: FocusUnitConfig[];
  targetByBusinessUnit: Record<string, number>;
  targetAchievementThreshold: number;
  focusHandlingThreshold: number;
  topN: number;
  storeTypeProfitShare: Record<string, number>;
  wasteChargeRate: number;
  wasteSupportRate: number;
  focusAutoGroupCategories: string[];
  storeTypeAliases: Record<string, string>;
}

export interface Store {
  storeId: string;
  storeName: string;
  currentCode: string;
  initialCode?: string;
  vStoreCode?: string;
  aliases: string[];
  businessUnit?: string;
  region?: string;
  team?: string;
  ofc?: string;
  storeType?: string;
  concept?: string;
  conceptType?: string;
  conceptStartDate?: string;
  masterBusinessUnit?: string;
  masterRegion?: string;
  masterTeam?: string;
  masterOfc?: string;
  masterStoreType?: string;
}

export interface DailyMetric {
  campaignId: string;
  storeId: string;
  date: string;
  dayIndex: number;
  salesAmount?: number;
  purchaseCost?: number;
  periodType: "current" | "previous";
}

export interface CategoryMetric {
  campaignId: string;
  storeId: string;
  categoryCode: string;
  categoryName: string;
  salesAmount: number;
  grossProfit: number;
}

export interface ProductMetric {
  campaignId: string;
  storeId: string;
  productCode: string;
  productName: string;
  categoryCode: string;
  categoryName: string;
  inboundQty: number;
  salesQty: number;
  salesAmount: number;
}

export interface FocusStoreMetric {
  campaignId: string;
  storeId: string;
  focusUnitId: string;
  focusUnitName: string;
  productCodes: string[];
  orderQty: number;
  handled: boolean;
}

export interface StoreMetric {
  storeId: string;
  operatingDays?: number;
  purchaseCostTotal: number;
  eventSalesTotal: number;
  eventDailySales?: number;
  previousSalesTotal: number;
  categorySales: Record<string, number>;
  categoryGrossProfit: Record<string, number>;
  categoryDailySales: Record<string, number>;
  categoryProfitRate: Record<string, number | undefined>;
  productHandlingRate: Record<string, number | undefined>;
  freshSalesTotal?: number;
  freshDailySales?: number;
  eventFreshComposition?: number;
  targetDailySales?: number;
  targetAchievementRate?: number;
  targetAchieved: boolean;
  targetScore?: number;
  focusHandledUnits: number;
  focusTotalUnits: number;
  focusHandlingRate?: number;
  focusAchieved: boolean;
  focusScore?: number;
  wasteCost?: number;
  profitShare?: number;
  estimatedStoreProfit?: number;
  topProducts: ProductMetric[];
}

export interface AggregateMetric {
  key: string;
  label: string;
  level: "national" | "businessUnit" | "team" | "ofc";
  businessUnit?: string;
  region?: string;
  team?: string;
  ofc?: string;
  storeCount: number;
  ofcCount: number;
  operatingDays: number;
  purchaseCostTotal: number;
  eventSalesTotal: number;
  eventDailySales?: number;
  coldDailySales?: number;
  freshEventDailySales?: number;
  otherDailySales?: number;
  targetAchievedStores: number;
  focusAchievedStores: number;
  focusHandlingRate?: number;
  freshDailySales?: number;
  eventFreshComposition?: number;
}

export interface ProductCatalogItem {
  productCode: string;
  productName: string;
  categoryCode: string;
  categoryName: string;
}

export interface CampaignDataset {
  config: CampaignConfig;
  fileRoles: Record<string, FileRole>;
  stores: Store[];
  dailyMetrics: DailyMetric[];
  categoryMetrics: CategoryMetric[];
  productMetrics: ProductMetric[];
  focusMetrics: FocusStoreMetric[];
  storeMetrics: StoreMetric[];
  productCatalog: ProductCatalogItem[];
  focusUnits: FocusUnitConfig[];
  aggregates: {
    national: AggregateMetric;
    businessUnits: AggregateMetric[];
    teams: AggregateMetric[];
    ofcs: AggregateMetric[];
  };
  issues: QualityIssue[];
  createdAt: string;
}

export interface AuthenticatedUser {
  role: "admin" | "ofc";
  userId: string;
  displayName: string;
  ofc?: string;
}

export interface CampaignListItem {
  id: string;
  campaignName: string;
  createdAt: string;
  storeCount: number;
  productCount: number;
  issueCount: number;
}

export interface StoreDailySeriesPoint {
  day: string;
  currentSales?: number;
  previousSales?: number;
  purchaseCost?: number;
}

export interface FocusSummary {
  focusUnitId: string;
  focusUnitName: string;
  categoryName?: string;
  productCodes: string[];
  nationalRate?: number;
  teamRate?: number;
  ofcRate?: number;
}

export interface DashboardDataset {
  config: Pick<CampaignConfig, "campaignId" | "campaignName" | "topN">;
  adminConfig?: CampaignConfig;
  stores: Store[];
  storeMetrics: StoreMetric[];
  productCatalog: ProductCatalogItem[];
  focusUnits: FocusUnitConfig[];
  focusSummaries: FocusSummary[];
  dailySeriesByStore: Record<string, StoreDailySeriesPoint[]>;
  aggregates: {
    national: AggregateMetric;
    businessUnits: AggregateMetric[];
    teams: AggregateMetric[];
    ofcs: AggregateMetric[];
  };
  createdAt: string;
  permissions: {
    canUpload: boolean;
    canManageCampaigns: boolean;
    canManageConfig: boolean;
    canViewValidation: boolean;
    canViewAllStores: boolean;
  };
  userScope: {
    role: "admin" | "ofc";
    ofc?: string;
    team?: string;
    businessUnit?: string;
  };
  fileRoles?: Record<string, FileRole>;
  issues?: QualityIssue[];
}
