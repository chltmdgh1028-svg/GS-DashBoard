/**
 * Self-check for the console's non-trivial logic.
 *
 * It runs against a stub that speaks the inspection app's `/api/gas`
 * protocol, never against production: the point is to prove this console
 * sends what that API expects and refuses what it should refuse, not to
 * exercise live inspection data.
 *
 * The correction path gets the most attention, because it is the only write
 * and the ways it can be silently wrong are the expensive ones: a lost CAS
 * base overwrites someone else's edit, a malformed requestId loses write
 * ordering, and a retried timeout double-applies.
 *
 * Run with `npm test`.
 */
import assert from "node:assert/strict";
import http from "node:http";

interface Received {
  action: string;
  body: Record<string, unknown>;
}

const received: Received[] = [];
/** Makes the stub answer the next call with this body instead of the default. */
let nextResponse: Record<string, unknown> | undefined;

const ROWS = [
  {
    __rowNumber: 2,
    작업기준일또는CSV식별값: "JOB-20261022",
    상품코드: "8800001",
    상품명: "사과 부사 5kg",
    협력사명: "가온프레시",
    센터명: "수도권센터",
    발주수량: 100,
    검품수량: 90,
    불량수량: 5,
    불량사유: "외관 불량",
  },
];

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

    if (nextResponse) {
      const response = nextResponse;
      nextResponse = undefined;
      return send(response);
    }

    if (body.action === "getInspectionRows") {
      return send({ ok: true, rows: ROWS, diagnostics: { role: "ADMIN", filterMode: "current" } });
    }
    if (body.action === "getReturnExchangeRecords") return send({ ok: true, records: [] });
    if (body.action === "getHistoryData") return send({ ok: true, data: [] });
    if (body.action === "saveInspectionQtyFastBatch") return send({ ok: true, version: 7 });
    if (body.action === "confirmInspectionQty") return send({ ok: true, matches: true, requestIdMatched: true });
    if (body.action === "getNativeWriteStatus") {
      return send({ ok: true, nativeAck: { version: 1, backend: "supabase", state: "COMMITTED", authoritative: true } });
    }
    if (body.action === "recoverNativeWrite") return send({ ok: true, nativeAck: { state: "COMMITTED" } });
    return send({ ok: false, error: "UNSUPPORTED" });
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
process.env.CORRECTIONS_ENABLED = "true";

const { createApp } = await import("../server/app.js");

async function start() {
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  const base = `http://127.0.0.1:${address.port}`;

  const signIn = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "ops", password: "test-admin-password" }),
  });
  return { server, base, cookie: signIn.headers.get("set-cookie")?.split(";")[0] ?? "", status: signIn.status };
}

const main = await start();
const { base, cookie } = main;

const json = (response: Response) => response.json() as Promise<Record<string, unknown>>;
const post = (path: string, body: unknown, jar = cookie) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(jar ? { cookie: jar } : {}) },
    body: JSON.stringify(body),
  });

/** A correction the row actually supports, reused across the checks. */
const correction = {
  jobKey: "JOB-20261022",
  productCode: "8800001",
  partnerName: "가온프레시",
  productName: "사과 부사 5kg",
  qty: 95,
  orderQty: 100,
  baseQty: 90,
  requestId: `qty-${Date.now()}-abcd1234`,
};

try {
  /* -------------------------------------------------------------- auth */

  assert.equal(main.status, 200, "admin login must succeed");
  assert.ok(cookie, "login must set a session cookie");

  const legacy = await post("/api/login", { userId: "admin", password: "fresh1652" }, "");
  assert.equal(legacy.status, 401, "legacy default credentials must be rejected");

  const anonymous = await fetch(`${base}/api/ops/rows`);
  assert.equal(anonymous.status, 401, "unauthenticated reads must be refused");

  /* ------------------------------------------------------------- reads */

  const rows = await fetch(`${base}/api/ops/rows?jobKey=JOB-20261022&filterMode=all`, {
    headers: { cookie },
  }).then(json);
  assert.equal((rows.rows as unknown[]).length, 1, "rows must pass through unchanged");

  const rowCall = received.findLast((entry) => entry.action === "getInspectionRows");
  const rowPayload = rowCall?.body.payload as Record<string, unknown>;
  assert.equal(rowPayload.jobKey, "JOB-20261022", "filters must reach the app");
  assert.equal(rowPayload.filterMode, "all");
  assert.equal(rowPayload.includePhotos, "true", "photos must be requested with the rows");

  // Every call must mark itself as a service integration, or the app's
  // minimum-client-version gate answers CLIENT_UPDATE_REQUIRED.
  assert.equal(rowCall?.body.clientPlatform, "service", "calls must declare clientPlatform service");
  assert.equal(rowCall?.body.caller, "inspection-master-console", "calls must declare a caller");
  assert.equal(rowCall?.body.sessionToken, "stub-session-token", "the token must be attached server-side");

  await fetch(`${base}/api/ops/movements`, { headers: { cookie } }).then(json);
  await fetch(`${base}/api/ops/history`, { headers: { cookie } }).then(json);

  /* -------------------------------------------------- correction guards */

  for (const [label, body] of [
    ["missing baseQty", { ...correction, baseQty: undefined }],
    ["negative qty", { ...correction, qty: -1 }],
    ["fractional qty", { ...correction, qty: 1.5 }],
    ["missing jobKey", { ...correction, jobKey: "" }],
    ["bare uuid requestId", { ...correction, requestId: "0f8c2b1a" }],
    ["requestId without timestamp", { ...correction, requestId: "qty-abc-1" }],
  ] as const) {
    const before = received.length;
    const response = await post("/api/ops/correct-qty", body);
    assert.equal(response.status, 400, `${label} must be refused`);
    assert.equal(received.length, before, `${label} must never reach the inspection app`);
  }

  /* ------------------------------------------------------ correction ok */

  const saved = await post("/api/ops/correct-qty", correction);
  assert.equal(saved.status, 200, "a well-formed correction must be accepted");

  const saveCall = received.findLast((entry) => entry.action === "saveInspectionQtyFastBatch");
  const row = (saveCall?.body.rows as Record<string, unknown>[])[0];
  assert.equal(row.type, "inspection");
  assert.equal(row["검품수량"], 95, "the new qty must be sent");
  assert.equal(row.baseQty, 90, "the CAS base must be sent, or a stale correction would overwrite");
  assert.equal(row.requestId, correction.requestId, "the requestId must reach the app unchanged");
  assert.equal(row.isUserAction, true);
  assert.equal(row.explicitZero, false, "a non-zero correction must not be flagged explicitZero");
  assert.equal(row["작업기준일또는CSV식별값"], correction.jobKey);

  // Zero is a real correction, not an empty one, and must say so or the app
  // treats the field as absent.
  await post("/api/ops/correct-qty", { ...correction, qty: 0, requestId: `qty-${Date.now()}-zero0000` });
  const zeroRow = (received.findLast((entry) => entry.action === "saveInspectionQtyFastBatch")
    ?.body.rows as Record<string, unknown>[])[0];
  assert.equal(zeroRow["검품수량"], 0);
  assert.equal(zeroRow.explicitZero, true, "a zero correction must set explicitZero");

  /* --------------------------------------------------- uncertain outcome */

  // A pending write must come back as pending rather than throwing, so the
  // caller resolves it by reading instead of writing again.
  nextResponse = { ok: false, pendingWrite: true, error: "NATIVE_WRITE_PENDING", message: "확인 중" };
  const pending = await post("/api/ops/correct-qty", {
    ...correction,
    requestId: `qty-${Date.now()}-pend0001`,
  });
  assert.equal(pending.status, 200, "a pending write must not be reported as a failure");
  const pendingBody = (await pending.json()) as { saved: { pendingWrite?: boolean } };
  assert.equal(pendingBody.saved.pendingWrite, true, "the pending flag must reach the browser");

  const confirmed = await post("/api/ops/confirm-qty", {
    jobKey: correction.jobKey,
    productCode: correction.productCode,
    requestId: correction.requestId,
  }).then(json);
  assert.equal(confirmed.matches, true, "confirmation must read the canonical row back");

  /* ------------------------------------------------- receipts / recovery */

  const receipt = await post("/api/ops/write-status", {
    operationId: "op-1",
    kind: "action_status",
  }).then(json);
  assert.equal((receipt.nativeAck as Record<string, unknown>).state, "COMMITTED");

  const noOperation = await post("/api/ops/write-status", { kind: "action_status" });
  assert.equal(noOperation.status, 400, "a receipt lookup needs an operationId");

  main.server.close();

  /* ----------------------------------------------------- correction gate */

  process.env.CORRECTIONS_ENABLED = "false";
  const readOnly = await start();
  const before = received.length;

  const blockedCorrection = await fetch(`${readOnly.base}/api/ops/correct-qty`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: readOnly.cookie },
    body: JSON.stringify(correction),
  });
  assert.equal(blockedCorrection.status, 403, "corrections must be refused when not enabled");

  const blockedRecovery = await fetch(`${readOnly.base}/api/ops/recover-write`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: readOnly.cookie },
    body: JSON.stringify({ operationId: "op-1", kind: "action_status" }),
  });
  assert.equal(blockedRecovery.status, 403, "recovery must be refused when corrections are not enabled");
  assert.equal(received.length, before, "a blocked write must never reach the inspection app");

  // Reading stays available on a read-only deployment.
  const stillReads = await fetch(`${readOnly.base}/api/ops/rows`, { headers: { cookie: readOnly.cookie } });
  assert.equal(stillReads.status, 200, "a read-only deployment must still read");
  readOnly.server.close();

  /* ------------------------------------------------------ not configured */

  delete process.env.INSPECTION_APP_BASE;
  const unconfigured = await start();
  const health = await fetch(`${unconfigured.base}/api/health`).then(json);
  assert.equal(health.inspectionApiConfigured, false);
  assert.deepEqual(health.missingInspectionVars, ["INSPECTION_APP_BASE"]);

  const unconfiguredRead = await fetch(`${unconfigured.base}/api/ops/rows`, {
    headers: { cookie: unconfigured.cookie },
  });
  assert.equal(unconfiguredRead.status, 503, "an unconfigured console must report 503, never fabricate data");
  unconfigured.server.close();

  console.log(`OK  stubCalls=${received.length}`);
} finally {
  main.server.close();
  stub.close();
}
