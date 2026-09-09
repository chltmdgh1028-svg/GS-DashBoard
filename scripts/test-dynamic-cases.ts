import { defaultCampaignConfig } from "../src/config/defaultConfig";
import { aggregateAll, calculateStoreMetrics } from "../src/aggregations/aggregation";
import type { DailyMetric, FocusStoreMetric, ProductMetric, Store } from "../src/domain/types";

const config = {
  ...structuredClone(defaultCampaignConfig),
  campaignId: "test",
  focusUnits: [
    { focusUnitId: "focus-a", focusUnitName: "A", productCodes: ["P1"] },
    { focusUnitId: "focus-b", focusUnitName: "B Group", productCodes: ["P2", "P3"] },
  ],
  topN: 2,
  targetByBusinessUnit: {},
};

const stores: Store[] = [
  {
    storeId: "V001",
    currentCode: "V001",
    initialCode: "001",
    vStoreCode: "V001",
    aliases: ["001", "V001"],
    storeName: "테스트점",
    businessUnit: "1부문",
    region: "1지역",
    team: "1팀",
    ofc: "OFC-A",
    storeType: "GS1타입",
  },
];

const daily: DailyMetric[] = [
  { campaignId: "test", storeId: "V001", date: "2026-01-01", dayIndex: 0, periodType: "current", salesAmount: 1000, purchaseCost: 400 },
  { campaignId: "test", storeId: "V001", date: "2026-01-02", dayIndex: 1, periodType: "current", salesAmount: 3000, purchaseCost: 900 },
];

const products: ProductMetric[] = [
  { campaignId: "test", storeId: "V001", productCode: "P1", productName: "상품1", categoryCode: "02", categoryName: "간편식품", inboundQty: 1, salesQty: 1, salesAmount: 100 },
  { campaignId: "test", storeId: "V001", productCode: "P2", productName: "상품2", categoryCode: "05", categoryName: "채소", inboundQty: 0, salesQty: 0, salesAmount: 500 },
  { campaignId: "test", storeId: "V001", productCode: "P3", productName: "상품3", categoryCode: "05", categoryName: "채소", inboundQty: 2, salesQty: 1, salesAmount: 300 },
];

const focus: FocusStoreMetric[] = [
  { campaignId: "test", storeId: "V001", focusUnitId: "focus-a", focusUnitName: "A", productCodes: ["P1"], orderQty: 1, handled: true },
  { campaignId: "test", storeId: "V001", focusUnitId: "focus-b", focusUnitName: "B Group", productCodes: ["P2", "P3"], orderQty: 2, handled: true },
];

const issues = [];
const metrics = calculateStoreMetrics({
  config,
  stores,
  operatingDays: new Map([["V001", 2]]),
  dailyMetrics: daily,
  categoryMetrics: [],
  productMetrics: products,
  focusMetrics: focus,
  wasteCosts: new Map(),
  freshSales: new Map(),
  groupForCategory: (code) => code === "02" ? "cold" : code === "05" ? "fresh" : "other",
  issues,
});
const aggregate = aggregateAll(stores, metrics);

if (metrics[0].topProducts.length !== 2) throw new Error("TOP N configuration was not applied");
if (metrics[0].topProducts[0].productCode !== "P2") throw new Error("Product ranking did not sort by sales amount");
if (metrics[0].focusTotalUnits !== 2 || metrics[0].focusHandledUnits !== 2) throw new Error("Grouped focus unit handling failed");
if (metrics[0].targetAchievementRate !== undefined) throw new Error("Target KPI should be unavailable without target config");
if (aggregate.ofcs[0].label !== "OFC-A") throw new Error("OFC aggregate did not use uploaded organization data");

stores[0] = { ...stores[0], ofc: "OFC-B" };
const moved = aggregateAll(stores, metrics);
if (moved.ofcs[0].label !== "OFC-B") throw new Error("OFC reassignment did not update aggregate");

console.log(JSON.stringify({
  productCount: products.length,
  topN: metrics[0].topProducts.map((product) => product.productCode),
  focus: `${metrics[0].focusHandledUnits}/${metrics[0].focusTotalUnits}`,
  target: metrics[0].targetAchievementRate ?? "unregistered",
  ofcBefore: aggregate.ofcs[0].label,
  ofcAfter: moved.ofcs[0].label,
}, null, 2));
