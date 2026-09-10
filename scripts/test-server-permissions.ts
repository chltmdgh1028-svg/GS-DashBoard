import zlib from "node:zlib";
import { aggregateAll, calculateStoreMetrics } from "../src/aggregations/aggregation.js";
import { defaultCampaignConfig } from "../src/config/defaultConfig.js";
import type { CampaignDataset, DailyMetric, FocusStoreMetric, ProductMetric, Store } from "../src/domain/types.js";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:8090";

async function request<T>(pathName: string, init: RequestInit = {}, cookie = "") {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(`${baseUrl}${pathName}`, { ...init, headers });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `${pathName} failed with ${response.status}`);
  return { data, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? cookie };
}

async function login(userId: string, password: string) {
  return request<{ user: { role: "admin" | "ofc"; ofc?: string } }>("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, password }),
  });
}

function buildDataset(): CampaignDataset {
  const config = {
    ...structuredClone(defaultCampaignConfig),
    campaignId: "permission-test",
    campaignName: "권한 테스트 Campaign",
    focusUnits: [{ focusUnitId: "focus-a", focusUnitName: "중점 A", productCodes: ["P1"] }],
    targetByBusinessUnit: {},
  };
  const stores: Store[] = [
    {
      storeId: "V001",
      storeName: "테스트점A",
      currentCode: "V001",
      aliases: ["V001"],
      businessUnit: "1부문",
      region: "1지역",
      team: "1팀",
      ofc: "OFC-A",
      storeType: "GS1타입",
    },
    {
      storeId: "V002",
      storeName: "테스트점B",
      currentCode: "V002",
      aliases: ["V002"],
      businessUnit: "1부문",
      region: "1지역",
      team: "1팀",
      ofc: "OFC-B",
      storeType: "GS1타입",
    },
  ];
  const dailyMetrics: DailyMetric[] = [
    { campaignId: config.campaignId, storeId: "V001", date: "2026-09-01", dayIndex: 0, salesAmount: 1000, purchaseCost: 500, periodType: "current" },
    { campaignId: config.campaignId, storeId: "V002", date: "2026-09-01", dayIndex: 0, salesAmount: 2000, purchaseCost: 800, periodType: "current" },
  ];
  const productMetrics: ProductMetric[] = [
    { campaignId: config.campaignId, storeId: "V001", productCode: "P1", productName: "상품1", categoryCode: "05", categoryName: "채소", inboundQty: 1, salesQty: 1, salesAmount: 1000 },
    { campaignId: config.campaignId, storeId: "V002", productCode: "P1", productName: "상품1", categoryCode: "05", categoryName: "채소", inboundQty: 1, salesQty: 1, salesAmount: 2000 },
  ];
  const focusMetrics: FocusStoreMetric[] = [
    { campaignId: config.campaignId, storeId: "V001", focusUnitId: "focus-a", focusUnitName: "중점 A", productCodes: ["P1"], orderQty: 1, handled: true },
    { campaignId: config.campaignId, storeId: "V002", focusUnitId: "focus-a", focusUnitName: "중점 A", productCodes: ["P1"], orderQty: 1, handled: true },
  ];
  const issues = [];
  const storeMetrics = calculateStoreMetrics({
    config,
    stores,
    operatingDays: new Map([["V001", 1], ["V002", 1]]),
    dailyMetrics,
    categoryMetrics: [],
    productMetrics,
    focusMetrics,
    wasteCosts: new Map(),
    freshSales: new Map(),
    groupForCategory: () => "fresh",
    issues,
  });
  return {
    config,
    fileRoles: {},
    stores,
    dailyMetrics,
    categoryMetrics: [],
    productMetrics,
    focusMetrics,
    storeMetrics,
    productCatalog: [{ productCode: "P1", productName: "상품1", categoryCode: "05", categoryName: "채소" }],
    focusUnits: config.focusUnits,
    aggregates: aggregateAll(stores, storeMetrics),
    issues,
    createdAt: new Date().toISOString(),
  };
}

const admin = await login("admin", "fresh1652");
const dataset = buildDataset();

async function issueSyncToken() {
  const token = await request<{ token: string }>("/api/admin/local-sync-token", { method: "POST" }, admin.cookie);
  return token.data.token;
}

async function syncDataset(tokenValue: string) {
  const body = zlib.gzipSync(Buffer.from(JSON.stringify({ dataset }), "utf8"));
  return request<{
    campaign: { id: string; activeRevisionNumber?: number; revisionCount?: number };
    generatedAccounts: { ofc: string; userId: string; password: string }[];
    accountCount: number;
    dataset: Record<string, unknown>;
  }>("/api/admin/campaigns/browser-sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-GS-Snapshot-Encoding": "gzip",
      "X-GS-Sync-Token": tokenValue,
    },
    body,
  }, admin.cookie);
}

const firstToken = await issueSyncToken();
const firstSync = await syncDataset(firstToken);

const invalidTokenResponse = await fetch(`${baseUrl}/api/admin/campaigns/browser-sync`, {
  method: "POST",
  headers: {
    "Content-Type": "application/octet-stream",
    "X-GS-Snapshot-Encoding": "gzip",
    "X-GS-Sync-Token": "invalid-token",
    Cookie: admin.cookie,
  },
  body: zlib.gzipSync(Buffer.from(JSON.stringify({ dataset }), "utf8")),
});
if (invalidTokenResponse.status !== 401) throw new Error(`Invalid sync token was not rejected: ${invalidTokenResponse.status}`);

const replayResponse = await fetch(`${baseUrl}/api/admin/campaigns/browser-sync`, {
  method: "POST",
  headers: {
    "Content-Type": "application/octet-stream",
    "X-GS-Snapshot-Encoding": "gzip",
    "X-GS-Sync-Token": firstToken,
    Cookie: admin.cookie,
  },
  body: zlib.gzipSync(Buffer.from(JSON.stringify({ dataset }), "utf8")),
});
if (replayResponse.status !== 401) throw new Error(`Replay sync token was not rejected: ${replayResponse.status}`);

const secondSync = await syncDataset(await issueSyncToken());
const campaignList = await request<{
  campaigns: { id: string; activeRevisionNumber?: number; revisionCount?: number }[];
}>("/api/campaigns", {}, admin.cookie);

if (campaignList.data.campaigns.length !== 1) throw new Error(`Duplicate campaigns created: ${campaignList.data.campaigns.length}`);
if (campaignList.data.campaigns[0].revisionCount !== 2 || campaignList.data.campaigns[0].activeRevisionNumber !== 2) {
  throw new Error(`Revision tracking failed: ${JSON.stringify(campaignList.data.campaigns[0])}`);
}

const ofc = await login("OFC-A", "1부문");
const dashboard = await request<{
  dataset: {
    stores: { ofc?: string; storeId: string }[];
    storeMetrics: { storeId: string }[];
    permissions: { canUpload: boolean; canViewValidation: boolean; canViewAllStores: boolean };
    issues?: unknown[];
    dailyMetrics?: unknown[];
    categoryMetrics?: unknown[];
    productMetrics?: unknown[];
    focusMetrics?: unknown[];
  };
}>("/api/dashboard/latest", {}, ofc.cookie);

const payload = dashboard.data.dataset;
const forbiddenKeys = ["dailyMetrics", "categoryMetrics", "productMetrics", "focusMetrics"].filter((key) =>
  Object.prototype.hasOwnProperty.call(payload, key),
);
const foreignStores = payload.stores.filter((store) => store.ofc !== "OFC-A");
if (forbiddenKeys.length) throw new Error(`OFC response leaked raw facts: ${forbiddenKeys.join(", ")}`);
if (payload.issues) throw new Error("OFC response leaked validation issues");
if (payload.permissions.canUpload || payload.permissions.canViewValidation || payload.permissions.canViewAllStores) {
  throw new Error("OFC permissions are too broad");
}
if (foreignStores.length) throw new Error(`OFC response includes foreign stores: ${foreignStores.length}`);

console.log(JSON.stringify({
  adminLocalSync: {
    firstRevision: firstSync.data.campaign.activeRevisionNumber,
    secondRevision: secondSync.data.campaign.activeRevisionNumber,
    campaignCountAfterResync: campaignList.data.campaigns.length,
    invalidTokenStatus: invalidTokenResponse.status,
    replayTokenStatus: replayResponse.status,
  },
  ofcScope: {
    storeCount: payload.stores.length,
    metricCount: payload.storeMetrics.length,
    forbiddenKeys,
    foreignStoreCount: foreignStores.length,
  },
}, null, 2));
