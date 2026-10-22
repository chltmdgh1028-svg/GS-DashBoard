/**
 * Self-check for the console's non-trivial logic.
 *
 * It runs against a stub that speaks the inspection app's admin-grid
 * protocol, never against production: the point is to prove this console
 * sends what that API expects and refuses what it should refuse, not to
 * exercise someone else's live master data.
 *
 * What is checked is what would be silently wrong rather than loudly broken:
 * the CAS pair reaching the app unaltered, the write gate, the dataset
 * allowlist, idempotent operation ids, the service-caller marking that keeps
 * the client-version gate from rejecting us, and error-code mapping.
 *
 * Run with `npm test`.
 */
import assert from "node:assert/strict";
import http from "node:http";

/* ------------------------------------------------- stub inspection app */

interface Received {
  action: string;
  body: Record<string, unknown>;
}

const received: Received[] = [];
/** Set to make the stub answer a business failure for the next call. */
let failWith: { error: string; message?: string } | undefined;

const VIEW = {
  ok: true,
  dataset: "event_rows",
  label: "행사표",
  columns: [
    { key: "상품코드", label: "상품코드", type: "text", readOnly: false },
    { key: "행사명", label: "행사명", type: "text", readOnly: false },
    { key: "수정자", label: "수정자", type: "text", readOnly: true },
  ],
  rows: [
    ["8800001", "가을 행사", "kim"],
    ["8800002", "겨울 행사", "lee"],
  ],
  revision: 42,
  sourceHash: "hash-42",
  sourceOwner: "supabase",
};

const stub = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}") as Record<string, unknown>;
    received.push({ action: String(body.action), body });

    const send = (payload: unknown) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(payload));
    };

    if (failWith) {
      const failure = failWith;
      failWith = undefined;
      return send({ ok: false, ...failure });
    }

    if (body.action === "getAdminGrid") return send(VIEW);
    if (body.action === "previewAdminGrid") return send({ ok: true, errors: [], changes: [{ row: 0 }] });
    if (body.action === "saveAdminGrid") {
      return send({ ok: true, nativeAck: { version: 1, backend: "supabase", state: "COMMITTED", authoritative: true } });
    }
    if (body.action === "getAdminGridHistory") return send({ ok: true, changes: [] });
    return send({ ok: false, error: "GRID_ACTION_INVALID" });
  });
});

await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
const stubAddress = stub.address();
if (!stubAddress || typeof stubAddress === "string") throw new Error("stub did not bind");

process.env.INSPECTION_APP_BASE = `http://127.0.0.1:${stubAddress.port}`;
process.env.INSPECTION_SESSION_TOKEN = "stub-session-token";
process.env.ADMIN_ID = "ops";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.SESSION_SECRET = "test-session-secret";
process.env.MASTER_WRITES_ENABLED = "true";

const { createApp } = await import("../server/app.js");

const app = createApp();
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("server did not bind");
const base = `http://127.0.0.1:${address.port}`;

const json = (response: Response) => response.json() as Promise<Record<string, unknown>>;

async function post(path: string, body: unknown, cookie = "") {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

try {
  /* ------------------------------------------------------------- auth */

  const legacy = await post("/api/login", { userId: "admin", password: "fresh1652" });
  assert.equal(legacy.status, 401, "legacy default credentials must be rejected");

  const anonymous = await fetch(`${base}/api/master/datasets/event_rows`);
  assert.equal(anonymous.status, 401, "unauthenticated reads must be refused");

  const signIn = await post("/api/login", { userId: "ops", password: "test-admin-password" });
  assert.equal(signIn.status, 200, "admin login must succeed");
  const cookie = signIn.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.ok(cookie, "login must set a session cookie");

  /* ------------------------------------------------------------- reads */

  const datasets = await fetch(`${base}/api/master/datasets`, { headers: { cookie } }).then(json);
  assert.equal((datasets.datasets as unknown[]).length, 8, "all eight master datasets must be listed");

  const unknown = await fetch(`${base}/api/master/datasets/not_a_dataset`, { headers: { cookie } });
  assert.equal(unknown.status, 404, "an unknown dataset must be refused before reaching the app");
  assert.ok(
    !received.some((entry) => (entry.body.payload as { dataset?: string })?.dataset === "not_a_dataset"),
    "an unknown dataset must never be forwarded",
  );

  const viewResponse = await fetch(`${base}/api/master/datasets/event_rows`, { headers: { cookie } }).then(json);
  const view = viewResponse.view as typeof VIEW;
  assert.equal(view.revision, 42);
  assert.equal(view.sourceHash, "hash-42");

  // Every call must mark itself as a service integration, or the inspection
  // app's minimum-client-version gate answers CLIENT_UPDATE_REQUIRED.
  const readCall = received.find((entry) => entry.action === "getAdminGrid");
  assert.equal(readCall?.body.clientPlatform, "service", "calls must declare clientPlatform service");
  assert.equal(readCall?.body.caller, "inspection-master-console", "calls must declare a caller");
  assert.equal(readCall?.body.sessionToken, "stub-session-token", "the session token must be attached server-side");

  /* ------------------------------------------------------------ writes */

  const submission = {
    columns: view.columns.map((column) => column.label),
    rows: [
      ["8800001", "가을 행사 수정", "kim"],
      ["8800002", "겨울 행사", "lee"],
    ],
    expectedRevision: view.revision,
    sourceHash: view.sourceHash,
  };

  const preview = await post("/api/master/datasets/event_rows/preview", submission, cookie);
  assert.equal(preview.status, 200, "preview must succeed");
  const previewCall = received.findLast((entry) => entry.action === "previewAdminGrid");
  const previewPayload = previewCall?.body.payload as Record<string, unknown>;
  assert.equal(previewPayload.expectedRevision, 42, "preview must carry the CAS revision");
  assert.equal(previewPayload.sourceHash, "hash-42", "preview must carry the CAS source hash");

  // A missing or malformed CAS pair must be refused here: the far side would
  // throw NATIVE_WRITE_INVALID, which is a much less useful message.
  for (const bad of [
    { ...submission, expectedRevision: undefined },
    { ...submission, expectedRevision: -1 },
    { ...submission, expectedRevision: 1.5 },
    { ...submission, sourceHash: "" },
  ]) {
    const response = await post("/api/master/datasets/event_rows/preview", bad, cookie);
    assert.equal(response.status, 400, `malformed CAS must be refused: ${JSON.stringify(bad.expectedRevision)}`);
  }

  const noOperation = await post("/api/master/datasets/event_rows/save", submission, cookie);
  assert.equal(noOperation.status, 400, "a save without an operationId must be refused");

  const operationId = "op-0001";
  const saved = await post(
    "/api/master/datasets/event_rows/save",
    { ...submission, operationId },
    cookie,
  );
  assert.equal(saved.status, 200, "save must succeed");

  const saveCall = received.findLast((entry) => entry.action === "saveAdminGrid");
  assert.equal(saveCall?.body.operationId, operationId, "the operation id must reach the app unchanged");
  const nativeWrite = saveCall?.body.nativeWrite as Record<string, unknown>;
  assert.deepEqual(
    nativeWrite,
    { version: 1, backend: "supabase", expectedRevision: 42 },
    "nativeWrite must match what identity() requires",
  );
  assert.equal(
    (saveCall?.body.payload as Record<string, unknown>).expectedRevision,
    nativeWrite.expectedRevision,
    "payload and nativeWrite revisions must agree, or the app rejects the write",
  );

  /* ------------------------------------------------------- error mapping */

  failWith = { error: "NATIVE_WRITE_CONFLICT", message: "원본 revision이 다릅니다." };
  const conflict = await post("/api/master/datasets/event_rows/save", { ...submission, operationId }, cookie);
  assert.equal(conflict.status, 409, "a write conflict must surface as 409, not 200");

  failWith = { error: "GRID_DATASET_TOO_LARGE" };
  const tooLarge = await fetch(`${base}/api/master/datasets/product_master`, { headers: { cookie } });
  assert.equal(tooLarge.status, 413, "GRID_DATASET_TOO_LARGE must surface as 413");

  /* --------------------------------------------------------- write gate */

  process.env.MASTER_WRITES_ENABLED = "false";
  const readOnlyApp = createApp();
  const readOnlyServer = readOnlyApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => readOnlyServer.once("listening", resolve));
  const readOnlyAddress = readOnlyServer.address();
  if (!readOnlyAddress || typeof readOnlyAddress === "string") throw new Error("no port");

  const readOnlyLogin = await fetch(`http://127.0.0.1:${readOnlyAddress.port}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "ops", password: "test-admin-password" }),
  });
  const readOnlyCookie = readOnlyLogin.headers.get("set-cookie")?.split(";")[0] ?? "";

  const before = received.length;
  const blocked = await fetch(
    `http://127.0.0.1:${readOnlyAddress.port}/api/master/datasets/event_rows/save`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: readOnlyCookie },
      body: JSON.stringify({ ...submission, operationId: "op-0002" }),
    },
  );
  assert.equal(blocked.status, 403, "writes must be refused when MASTER_WRITES_ENABLED is not true");
  assert.equal(received.length, before, "a blocked write must never reach the inspection app");
  readOnlyServer.close();

  /* ------------------------------------------------------ not configured */

  delete process.env.INSPECTION_APP_BASE;
  const unconfiguredApp = createApp();
  const unconfiguredServer = unconfiguredApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => unconfiguredServer.once("listening", resolve));
  const unconfiguredAddress = unconfiguredServer.address();
  if (!unconfiguredAddress || typeof unconfiguredAddress === "string") throw new Error("no port");

  const health = await fetch(`http://127.0.0.1:${unconfiguredAddress.port}/api/health`).then(json);
  assert.equal(health.inspectionApiConfigured, false, "health must report the missing connection");
  assert.deepEqual(health.missingInspectionVars, ["INSPECTION_APP_BASE"]);

  const unconfiguredLogin = await fetch(`http://127.0.0.1:${unconfiguredAddress.port}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "ops", password: "test-admin-password" }),
  });
  const unconfiguredCookie = unconfiguredLogin.headers.get("set-cookie")?.split(";")[0] ?? "";
  const unconfiguredRead = await fetch(
    `http://127.0.0.1:${unconfiguredAddress.port}/api/master/datasets/event_rows`,
    { headers: { cookie: unconfiguredCookie } },
  );
  assert.equal(unconfiguredRead.status, 503, "an unconfigured console must report 503, never fabricate data");
  unconfiguredServer.close();

  console.log(`OK  datasets=8 stubCalls=${received.length}`);
} finally {
  server.close();
  stub.close();
}
