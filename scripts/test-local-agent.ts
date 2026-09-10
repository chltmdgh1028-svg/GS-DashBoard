import fs from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import { defaultCampaignConfig } from "../src/config/defaultConfig.js";

const centralUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:8095";
const agentUrl = process.env.TEST_AGENT_URL || "http://127.0.0.1:8788";
const sourceDir = process.env.TEST_SOURCE_DIR || "C:/Users/Administrator/Downloads";
const inputDir = path.resolve(process.env.TEST_AGENT_INPUT_DIR || "outputs/local-agent-input-test/full");
const missingDir = path.resolve(process.env.TEST_AGENT_MISSING_DIR || "outputs/local-agent-input-test/missing");
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

async function request<T>(url: string, init: RequestInit = {}, cookie = "") {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(url, { ...init, headers });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `${url} failed with ${response.status}`);
  return { data, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? cookie };
}

async function login() {
  return request<{ user: { role: "admin" } }>(`${centralUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "admin", password: "fresh1652" }),
  });
}

async function prepareFolders() {
  await fs.rm(path.dirname(inputDir), { recursive: true, force: true });
  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(missingDir, { recursive: true });
  for (const name of sourceNames) {
    await fs.copyFile(path.join(sourceDir, name), path.join(inputDir, name));
  }
  for (const name of sourceNames.slice(0, -1)) {
    await fs.copyFile(path.join(sourceDir, name), path.join(missingDir, name));
  }
}

async function setFolder(folderPath: string) {
  return request<{ folderPath: string; folderConnected: boolean }>(`${agentUrl}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: centralUrl },
    body: JSON.stringify({ folderPath }),
  });
}

async function createModifiedOperatingDaysCopy() {
  const sourcePath = path.join(sourceDir, sourceNames[2]);
  const outputPath = path.join(inputDir, "1.영업일수 내용변경.xlsx");
  const workbook = XLSX.read(await fs.readFile(sourcePath), { cellDates: true, cellFormula: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const target = XLSX.utils.encode_cell({ r: 0, c: range.e.c + 1 });
  sheet[target] = { t: "s", v: "content-hash-test" };
  range.e.c += 1;
  sheet["!ref"] = XLSX.utils.encode_range(range);
  const output = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await fs.writeFile(outputPath, output);
  await fs.utimes(outputPath, new Date(), new Date());
  return outputPath;
}

await prepareFolders();

const offline = await fetch("http://127.0.0.1:8799/health").catch(() => undefined);
if (offline?.ok) throw new Error("Unexpected agent running on offline test port");

const blockedOrigin = await fetch(`${agentUrl}/health`, { headers: { Origin: "http://not-allowed.example" } });
if (blockedOrigin.status !== 403) throw new Error(`Disallowed origin was not blocked: ${blockedOrigin.status}`);

await setFolder(missingDir);
const missingScan = await request<{
  missingRoles: string[];
}>(`${agentUrl}/files`, { headers: { Origin: centralUrl } });
if (!missingScan.data.missingRoles.length) throw new Error("Missing required file was not detected");

await setFolder(inputDir);
const scan = await request<{
  connected: boolean;
  missingRoles: string[];
  files: { found: boolean; hash?: string }[];
}>(`${agentUrl}/files`, { headers: { Origin: centralUrl } });
if (!scan.data.connected) throw new Error("Agent input folder is not connected");
if (scan.data.missingRoles.length) throw new Error(`Required files missing: ${scan.data.missingRoles.join(", ")}`);
if (scan.data.files.filter((file) => file.found).length < 10) throw new Error("Agent did not recognize the full source set");
if (scan.data.files.some((file) => file.found && !file.hash)) throw new Error("Agent did not calculate file hashes");

const admin = await login();
async function syncOnce() {
  const status = await request<{ hasActiveRevision: boolean }>(`${centralUrl}/api/admin/campaigns/sync-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ campaignId: defaultCampaignConfig.campaignId }),
  }, admin.cookie);
  const token = await request<{ token: string }>(`${centralUrl}/api/admin/local-sync-token`, { method: "POST" }, admin.cookie);
  const snapshot = await request<{
    status: "COMPLETED" | "UNCHANGED";
    scan: { selectedByRole: Record<string, { name: string; modifiedAt: string; hash: string }> };
    gzipBase64?: string;
    rawSizeBytes?: number;
    gzipSizeBytes?: number;
  }>(`${agentUrl}/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: centralUrl },
    body: JSON.stringify({ token: token.data.token, force: !status.data.hasActiveRevision }),
  });

  if (snapshot.data.status === "UNCHANGED") return { data: snapshot.data };
  if (!snapshot.data.gzipBase64) throw new Error("Agent did not return gzip payload");

  const central = await request<{
    campaign: { revisionCount?: number; activeRevisionNumber?: number };
    dataset: { stores: unknown[] };
  }>(`${centralUrl}/api/admin/campaigns/browser-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-GS-Snapshot-Encoding": "gzip",
      "X-GS-Sync-Token": token.data.token,
    },
    body: Buffer.from(snapshot.data.gzipBase64, "base64"),
  }, admin.cookie);

  await request(`${agentUrl}/sync-complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: centralUrl },
    body: JSON.stringify({ selectedByRole: snapshot.data.scan.selectedByRole }),
  });

  return { data: { ...snapshot.data, central: central.data } };
}

const firstSync = await syncOnce();
if (firstSync.data.status !== "COMPLETED" || !firstSync.data.central) throw new Error("First Agent sync did not complete");
const unchangedScan = await request<{ changedSinceLastSync: boolean }>(`${agentUrl}/files`, { headers: { Origin: centralUrl } });
if (unchangedScan.data.changedSinceLastSync) throw new Error("Agent still reports changes immediately after first sync");
await fs.copyFile(path.join(sourceDir, sourceNames[2]), path.join(inputDir, "1.영업일수 파일명변경.xlsx"));
await fs.utimes(path.join(inputDir, "1.영업일수 파일명변경.xlsx"), new Date(), new Date());
const sameContentScan = await request<{ changedSinceLastSync: boolean }>(`${agentUrl}/files`, { headers: { Origin: centralUrl } });
if (sameContentScan.data.changedSinceLastSync) throw new Error("Same content with newer name/mtime should remain unchanged");
const unchangedSync = await syncOnce();
if (unchangedSync.data.status !== "UNCHANGED") throw new Error(`Same content re-sync should be UNCHANGED: ${unchangedSync.data.status}`);
await createModifiedOperatingDaysCopy();
const secondSync = await syncOnce();
if (secondSync.data.status !== "COMPLETED" || !secondSync.data.central) throw new Error("Changed content sync did not complete");
if (secondSync.data.central.campaign.revisionCount !== 2 || secondSync.data.central.campaign.activeRevisionNumber !== 2) {
  throw new Error(`Agent re-sync did not create an active second revision: ${JSON.stringify(secondSync.data.central.campaign)}`);
}

const changedScan = await request<{ changedSinceLastSync: boolean }>(`${agentUrl}/files`, { headers: { Origin: centralUrl } });
if (changedScan.data.changedSinceLastSync) throw new Error("Agent still reports changes immediately after sync");

console.log(JSON.stringify({
  agent: {
    fullFolder: inputDir,
    recognizedFiles: scan.data.files.filter((file) => file.found).length,
    missingRolesWhenFileRemoved: missingScan.data.missingRoles,
    blockedOriginStatus: blockedOrigin.status,
  },
  sync: {
    firstRevision: firstSync.data.central.campaign.activeRevisionNumber,
    sameContentChanged: sameContentScan.data.changedSinceLastSync,
    sameContentSyncStatus: unchangedSync.data.status,
    secondRevision: secondSync.data.central.campaign.activeRevisionNumber,
    revisionCount: secondSync.data.central.campaign.revisionCount,
    storeCount: secondSync.data.central.dataset.stores.length,
    unchangedAfterFirstSync: unchangedScan.data.changedSinceLastSync,
    changedAfterSync: changedScan.data.changedSinceLastSync,
  },
}, null, 2));
