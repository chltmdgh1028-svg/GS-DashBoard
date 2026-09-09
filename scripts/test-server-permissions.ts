import fs from "node:fs/promises";
import path from "node:path";
import { File } from "node:buffer";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:8090";
const downloads = "C:/Users/Administrator/Downloads";
const sourceNames = [
  "신선강화 점포전개리스트(26.09.07)(공유용) 2 (1).xlsx",
  "조직도(260907)_안내용 (1).xlsx",
  "1.영업일수 (2).xlsx",
  "2.일자별매출액,매입원가 (3).xlsx",
  "3.직전전단매출액.xlsx",
  "4.대분류매출,매출이익 (2).xlsx",
  "5.폐기원가 (2).xlsx",
  "6.점별 입고,매출,매출액 (2).xlsx",
  "7.중점취급상품 (3).xlsx",
  "8.신선매출 (4).xlsx",
];

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

const admin = await login("admin", "admin");
const formData = new FormData();
for (const name of sourceNames) {
  const buffer = await fs.readFile(path.join(downloads, name));
  formData.append("files", new File([buffer], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

const upload = await request<{
  campaign: { id: string; activeRevisionNumber?: number; revisionCount?: number };
  generatedAccounts: { ofc: string; userId: string; password: string }[];
  accountCount: number;
  dataset: Record<string, unknown>;
}>("/api/admin/campaigns/upload", { method: "POST", body: formData }, admin.cookie);

const secondFormData = new FormData();
for (const name of sourceNames) {
  const buffer = await fs.readFile(path.join(downloads, name));
  secondFormData.append("files", new File([buffer], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

const secondUpload = await request<{
  campaign: { id: string; activeRevisionNumber?: number; revisionCount?: number };
}>("/api/admin/campaigns/upload", { method: "POST", body: secondFormData }, admin.cookie);

const campaignList = await request<{
  campaigns: { id: string; activeRevisionNumber?: number; revisionCount?: number }[];
}>("/api/campaigns", {}, admin.cookie);

if (campaignList.data.campaigns.length !== 1) {
  throw new Error(`Same campaign upload created duplicate campaigns: ${campaignList.data.campaigns.length}`);
}
if (campaignList.data.campaigns[0].id !== upload.data.campaign.id) {
  throw new Error("Re-upload changed campaign identity");
}
if (campaignList.data.campaigns[0].revisionCount !== 2 || campaignList.data.campaigns[0].activeRevisionNumber !== 2) {
  throw new Error(`Revision tracking failed: ${JSON.stringify(campaignList.data.campaigns[0])}`);
}

const accounts = await request<{ accounts: { ofc: string; userId: string; password: string }[] }>("/api/admin/ofc-accounts", {}, admin.cookie);
const targetAccount = accounts.data.accounts.find((account) => account.ofc !== "김수진1") ?? accounts.data.accounts[0];
if (!targetAccount) throw new Error("No OFC account generated");

const ofc = await login(targetAccount.userId, targetAccount.password);
const dashboard = await request<{
  dataset: {
    stores: { ofc?: string; storeId: string }[];
    storeMetrics: { storeId: string }[];
    permissions: { canUpload: boolean; canViewValidation: boolean; canViewAllStores: boolean };
    userScope: { role: string; ofc?: string };
    issues?: unknown[];
    dailyMetrics?: unknown[];
    categoryMetrics?: unknown[];
    productMetrics?: unknown[];
    focusMetrics?: unknown[];
  };
}>("/api/dashboard/latest", {}, ofc.cookie);

const dataset = dashboard.data.dataset;
const forbiddenKeys = ["dailyMetrics", "categoryMetrics", "productMetrics", "focusMetrics"].filter((key) =>
  Object.prototype.hasOwnProperty.call(dataset, key),
);
const foreignStores = dataset.stores.filter((store) => store.ofc !== targetAccount.ofc);
if (forbiddenKeys.length) throw new Error(`OFC response leaked raw facts: ${forbiddenKeys.join(", ")}`);
if (dataset.issues) throw new Error("OFC response leaked validation issues");
if (dataset.permissions.canUpload || dataset.permissions.canViewValidation || dataset.permissions.canViewAllStores) {
  throw new Error("OFC permissions are too broad");
}
if (foreignStores.length) throw new Error(`OFC response includes foreign stores: ${foreignStores.length}`);

console.log(JSON.stringify({
  adminUpload: {
    accountCount: upload.data.accountCount,
    generatedAccounts: upload.data.generatedAccounts.length,
    firstRevision: upload.data.campaign.activeRevisionNumber,
    secondRevision: secondUpload.data.campaign.activeRevisionNumber,
    campaignCountAfterReupload: campaignList.data.campaigns.length,
    leakedRawFactsToAdminDashboard: ["dailyMetrics", "categoryMetrics", "productMetrics", "focusMetrics"].filter((key) =>
      Object.prototype.hasOwnProperty.call(upload.data.dataset, key),
    ),
  },
  ofcScope: {
    ofc: targetAccount.ofc,
    storeCount: dataset.stores.length,
    metricCount: dataset.storeMetrics.length,
    permissions: dataset.permissions,
    forbiddenKeys,
    foreignStoreCount: foreignStores.length,
  },
}, null, 2));
