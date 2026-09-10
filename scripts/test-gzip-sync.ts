/**
 * Verifies the gzip Snapshot upload path end to end against a local server.
 *
 * Covers: identical dataset before/after compression, Content-Type and
 * Content-Encoding handling, backward compatibility with uncompressed clients,
 * and that corrupt gzip, bad payloads, invalid tokens and replayed one-time
 * tokens are still rejected.
 *
 * Reads a previously produced Snapshot from outputs/ when one is available so
 * the payload is the real ~22MB shape; falls back to a small synthetic dataset
 * otherwise. Never touches the project's own data directory.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-gzip-test-"));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_ID = process.env.ADMIN_ID || "admin";
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

const { createApp } = await import("../server/app.js");
const app = createApp();
const server = http.createServer(app);

interface Result {
  status: number;
  body: string;
  setCookie?: string;
}

function send(
  requestPath: string,
  options: { method?: string; body?: Buffer | string; headers?: Record<string, string>; cookie?: string } = {},
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("server not listening"));
    const payload = typeof options.body === "string" ? Buffer.from(options.body, "utf8") : options.body;
    const req = http.request(
      {
        host: "127.0.0.1",
        port: address.port,
        path: requestPath,
        method: options.method ?? "GET",
        headers: {
          ...(payload ? { "Content-Length": payload.byteLength } : {}),
          ...(options.cookie ? { Cookie: options.cookie } : {}),
          ...options.headers,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, setCookie: (res.headers["set-cookie"] ?? [])[0] }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` -> ${detail}`}`);
}

function loadDataset(): unknown {
  const snapshot = path.join(process.cwd(), "outputs", "exe-server-data-260910", "app-db.json");
  if (fs.existsSync(snapshot)) {
    const db = JSON.parse(fs.readFileSync(snapshot, "utf8")) as {
      campaigns: { revisions: { dataset: unknown }[] }[];
    };
    const dataset = db.campaigns[0]?.revisions[0]?.dataset;
    if (dataset) return dataset;
  }
  console.log("(no local Snapshot found - using a synthetic dataset)");
  return {
    config: { campaignId: "gzip-test", campaignName: "gzip 테스트 행사", topN: 20 },
    fileRoles: {},
    stores: [{ storeId: "S1", storeName: "테스트점", currentCode: "V0001", aliases: [], team: "T", ofc: "O", businessUnit: "B" }],
    dailyMetrics: [],
    categoryMetrics: [],
    productMetrics: [],
    focusMetrics: [],
    storeMetrics: [
      {
        storeId: "S1",
        operatingDays: 10,
        purchaseCostTotal: 0,
        eventSalesTotal: 1000,
        previousSalesTotal: 900,
        categorySales: {},
        categoryGrossProfit: {},
        categoryDailySales: {},
        categoryProfitRate: {},
        productHandlingRate: {},
        targetAchieved: false,
        focusHandledUnits: 0,
        focusTotalUnits: 0,
        focusAchieved: false,
        topProducts: [],
      },
    ],
    productCatalog: [],
    focusUnits: [],
    aggregates: { national: {}, businessUnits: [], teams: [], ofcs: [] },
    issues: [],
    createdAt: new Date().toISOString(),
  };
}

function storedDataset() {
  const db = JSON.parse(fs.readFileSync(path.join(dataDir, "app-db.json"), "utf8")) as {
    campaigns: { revisions: { revisionNumber: number; dataset: unknown }[] }[];
  };
  return db.campaigns[0];
}

async function adminCookie() {
  const login = await send("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: process.env.ADMIN_ID, password: process.env.ADMIN_PASSWORD }),
  });
  if (login.status !== 200) throw new Error(`login failed: ${login.status} ${login.body}`);
  return (login.setCookie ?? "").split(";")[0];
}

async function syncToken(cookie: string) {
  const issued = await send("/api/admin/local-sync-token", { method: "POST", cookie });
  if (issued.status !== 200) throw new Error(`token failed: ${issued.status} ${issued.body}`);
  return (JSON.parse(issued.body) as { token: string }).token;
}

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const dataset = loadDataset();
  const cookie = await adminCookie();

  // ---- size report -------------------------------------------------------
  const rawBody = Buffer.from(JSON.stringify({ token: "x".repeat(200), dataset }), "utf8");
  const gzipped = zlib.gzipSync(rawBody, { level: 9 });
  const mb = (n: number) => `${(n / 1048576).toFixed(2)}MB`;
  console.log(
    `payload: raw ${mb(rawBody.byteLength)} -> gzip ${mb(gzipped.byteLength)} ` +
      `(${((gzipped.byteLength / rawBody.byteLength) * 100).toFixed(2)}%)`,
  );

  // ---- 1. compressed upload succeeds -------------------------------------
  const token1 = await syncToken(cookie);
  const body1 = zlib.gzipSync(Buffer.from(JSON.stringify({ token: token1, dataset }), "utf8"), { level: 9 });
  const upload = await send("/api/admin/campaigns/local-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
    body: body1,
  });
  check("gzip Snapshot upload -> 200", upload.status === 200, `${upload.status} ${upload.body.slice(0, 200)}`);
  check("response carries campaign meta", upload.body.includes("\"campaign\""), upload.body.slice(0, 120));

  // ---- 2. stored dataset is byte-identical to what was sent ---------------
  const campaign = storedDataset();
  const sentJson = JSON.stringify(dataset);
  const storedJson = JSON.stringify(campaign?.revisions[0]?.dataset);
  check("stored dataset identical to sent dataset", sentJson === storedJson, `${sentJson.length} vs ${storedJson.length} bytes`);
  check("revision R1 created", campaign?.revisions[0]?.revisionNumber === 1, JSON.stringify(campaign?.revisions.map((r) => r.revisionNumber)));

  // ---- 3. one-time token cannot be replayed ------------------------------
  const replay = await send("/api/admin/campaigns/local-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
    body: body1,
  });
  check("replayed sync token -> 401", replay.status === 401, `${replay.status} ${replay.body}`);
  check("replay message names the reuse", replay.body.includes("이미 사용된"), replay.body);

  // ---- 4. corrupt gzip is rejected as JSON -------------------------------
  const corrupt = await send("/api/admin/campaigns/local-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
    body: Buffer.from("this is definitely not gzip", "utf8"),
  });
  check("corrupt gzip -> 400", corrupt.status === 400, `${corrupt.status}`);
  check("corrupt gzip answered as JSON", corrupt.body.trim().startsWith("{"), corrupt.body.slice(0, 120));

  // ---- 5. valid gzip wrapping malformed JSON -----------------------------
  const badJson = await send("/api/admin/campaigns/local-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
    body: zlib.gzipSync(Buffer.from("{ not json", "utf8")),
  });
  check("gzip with malformed JSON -> 400 JSON", badJson.status === 400 && badJson.body.trim().startsWith("{"), `${badJson.status} ${badJson.body.slice(0, 120)}`);

  // ---- 6. unsupported encoding -------------------------------------------
  const brotli = await send("/api/admin/campaigns/local-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Encoding": "br" },
    body: zlib.brotliCompressSync(Buffer.from(JSON.stringify({ token: "x", dataset: {} }), "utf8")),
  });
  check("unsupported Content-Encoding -> 415 JSON", brotli.status === 415 && brotli.body.trim().startsWith("{"), `${brotli.status} ${brotli.body.slice(0, 120)}`);

  // ---- 7. invalid token inside a valid gzip ------------------------------
  const badToken = await send("/api/admin/campaigns/local-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
    body: zlib.gzipSync(Buffer.from(JSON.stringify({ token: "bogus.token", dataset }), "utf8")),
  });
  check("invalid token inside gzip -> 401", badToken.status === 401, `${badToken.status} ${badToken.body.slice(0, 120)}`);

  // ---- 8. uncompressed client still works (backward compatible) ----------
  const token2 = await syncToken(cookie);
  const plain = await send("/api/admin/campaigns/local-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: token2, dataset }),
  });
  check("uncompressed upload still accepted -> 200", plain.status === 200, `${plain.status} ${plain.body.slice(0, 120)}`);

  const after = storedDataset();
  check("second upload became revision R2", after?.revisions[0]?.revisionNumber === 2, JSON.stringify(after?.revisions.map((r) => r.revisionNumber)));
  check(
    "gzip and plain uploads stored identical datasets",
    JSON.stringify(after?.revisions[0]?.dataset) === JSON.stringify(after?.revisions[1]?.dataset),
    "revision payloads differ",
  );

  // ---- 9. dashboard reads the active revision ----------------------------
  const latest = await send("/api/dashboard/latest", { cookie });
  check("GET /api/dashboard/latest after gzip sync -> 200", latest.status === 200, `${latest.status}`);
  check("dashboard payload is not empty", latest.body.includes("\"aggregates\""), latest.body.slice(0, 120));

  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(failures === 0 ? "\nAll gzip sync checks passed." : `\n${failures} check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
