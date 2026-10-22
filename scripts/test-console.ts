/**
 * Self-check for the console's non-trivial logic.
 *
 * Covers the three things that would be silently wrong rather than loudly
 * broken: the exception derivation rules, the aggregation arithmetic, and the
 * scope enforcement that stops one center reading or deciding another's work.
 *
 * Run with `npm test`. No framework on purpose - assert and exit code.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "console-test-"));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_ID = "ops";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.CENTER_PASSWORD = "test-center-password";
process.env.SESSION_SECRET = "test-session-secret";

const { createApp } = await import("../server/app.js");
const store = await import("../server/store.js");

const BUSINESS_DATE = "2026-10-21";

/* ------------------------------------------------- derivation + aggregation */

const { records } = store.loadRecords(BUSINESS_DATE);
assert.ok(records.length > 0, "seed must produce records");

// Deterministic: the same business date must yield the same feed, or two
// operators comparing screens would see different numbers.
assert.deepEqual(
  store.loadRecords(BUSINESS_DATE).records,
  records,
  "feed for a given business date must be reproducible",
);
assert.notDeepEqual(
  store.loadRecords("2026-10-20").records,
  records,
  "a different business date must yield a different feed",
);

for (const record of records) {
  assert.ok(record.inspectionQty <= record.inboundQty, `${record.id}: 검품 수량이 입고 수량을 초과`);
  assert.ok(record.defectQty <= record.inspectionQty, `${record.id}: 불량 수량이 검품 수량을 초과`);
  assert.ok(
    record.returnQty + record.exchangeQty <= record.defectQty,
    `${record.id}: 반품+교환이 불량 수량을 초과`,
  );
  assert.ok(Math.abs(record.inspectionRate - record.inspectionQty / record.inboundQty) < 1e-9);
}

const exceptions = store.deriveExceptions(records);

// Every rule in deriveExceptions must be reachable by the seed, otherwise the
// queue silently stops surfacing a whole class of problem.
for (const kind of [
  "defect_critical",
  "return_pending",
  "exchange_pending",
  "inspection_shortfall",
  "photo_missing",
] as const) {
  assert.ok(
    exceptions.some((item) => item.kind === kind),
    `seed must exercise the ${kind} rule`,
  );
}

// A shortfall is raised exactly when the rate is under target.
const shortfallIds = new Set(
  exceptions.filter((item) => item.kind === "inspection_shortfall").map((item) => item.inspectionId),
);
for (const record of records) {
  assert.equal(
    shortfallIds.has(record.id),
    record.inspectionRate < store.INSPECTION_TARGET,
    `${record.id}: 검품률 미달 판정이 목표와 불일치`,
  );
}

// Totals must equal the row-wise sums, and a rate must never be derived from
// an already-rounded rate.
const totals = store.totalsFor(records);
assert.equal(totals.inboundQty, records.reduce((sum, row) => sum + row.inboundQty, 0));
assert.equal(totals.inspectionQty, records.reduce((sum, row) => sum + row.inspectionQty, 0));
assert.ok(Math.abs(totals.inspectionRate - totals.inspectionQty / totals.inboundQty) < 1e-9);
assert.ok(Math.abs(totals.defectRate - totals.defectQty / totals.inspectionQty) < 1e-9);

const hourly = store.hourlyFor(records);
assert.equal(
  hourly.reduce((sum, bucket) => sum + bucket.inspectionQty, 0),
  totals.inspectionQty,
  "시간대별 합계가 전체 검품 수량과 불일치",
);

/* -------------------------------------------------------------- HTTP: scope */

const app = createApp();
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("server did not bind a port");
const base = `http://127.0.0.1:${address.port}`;

async function login(userId: string, password: string) {
  const response = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, password }),
  });
  return { response, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}

try {
  // The published default password must not be accepted any more.
  const legacy = await login("admin", "fresh1652");
  assert.equal(legacy.response.status, 401, "legacy default credentials must be rejected");

  const anonymous = await fetch(`${base}/api/console/overview`);
  assert.equal(anonymous.status, 401, "unauthenticated reads must be refused");

  const admin = await login("ops", "test-admin-password");
  assert.equal(admin.response.status, 200, "admin login must succeed");

  const centerName = store.ALL_CENTERS[0];
  const otherCenter = store.ALL_CENTERS[1];
  const center = await login(centerName, "test-center-password");
  assert.equal(center.response.status, 200, "center login must succeed");

  const adminOverview = await fetch(`${base}/api/console/overview?date=${BUSINESS_DATE}`, {
    headers: { cookie: admin.cookie },
  }).then((response) => response.json());
  assert.equal(adminOverview.centers.length, store.ALL_CENTERS.length, "admin must see every center");

  const centerOverview = await fetch(`${base}/api/console/overview?date=${BUSINESS_DATE}`, {
    headers: { cookie: center.cookie },
  }).then((response) => response.json());
  assert.deepEqual(
    centerOverview.centers.map((row: { center: string }) => row.center),
    [centerName],
    "center user must see only their own center",
  );

  // A center user must not be able to widen scope through the URL.
  const centerInspections = await fetch(`${base}/api/console/inspections?date=${BUSINESS_DATE}`, {
    headers: { cookie: center.cookie },
  }).then((response) => response.json());
  assert.ok(
    centerInspections.records.every((row: { center: string }) => row.center === centerName),
    "center user must not receive another center's records",
  );

  /* ----------------------------------------------------------- HTTP: decide */

  const adminQueue = await fetch(`${base}/api/console/exceptions?state=pending&date=${BUSINESS_DATE}`, {
    headers: { cookie: admin.cookie },
  }).then((response) => response.json());
  assert.ok(adminQueue.items.length > 0, "pending queue must not be empty for the seed");

  const foreign = adminQueue.items.find((item: { center: string }) => item.center === otherCenter);
  assert.ok(foreign, "seed must contain an exception outside the center user's scope");

  // Deciding out of scope must 404, not succeed and not 500.
  const crossScope = await fetch(`${base}/api/console/exceptions/${encodeURIComponent(foreign.id)}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: center.cookie },
    body: JSON.stringify({ action: "approve", date: BUSINESS_DATE }),
  });
  assert.equal(crossScope.status, 404, "center user must not decide another center's exception");

  const badAction = await fetch(`${base}/api/console/exceptions/${encodeURIComponent(foreign.id)}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: admin.cookie },
    body: JSON.stringify({ action: "obliterate", date: BUSINESS_DATE }),
  });
  assert.equal(badAction.status, 400, "unknown decision action must be rejected");

  const decided = await fetch(`${base}/api/console/exceptions/${encodeURIComponent(foreign.id)}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: admin.cookie },
    body: JSON.stringify({ action: "approve", note: "검수 확인", date: BUSINESS_DATE }),
  });
  assert.equal(decided.status, 200, "admin decision must succeed");

  // The decision must survive a re-read: that is the whole point of persisting it.
  const afterQueue = await fetch(`${base}/api/console/exceptions?state=all&date=${BUSINESS_DATE}`, {
    headers: { cookie: admin.cookie },
  }).then((response) => response.json());
  const persisted = afterQueue.items.find((item: { id: string }) => item.id === foreign.id);
  assert.equal(persisted.state, "resolved", "decided exception must read back as resolved");
  assert.equal(persisted.decision.note, "검수 확인");

  const pendingAfter = await fetch(`${base}/api/console/exceptions?state=pending&date=${BUSINESS_DATE}`, {
    headers: { cookie: admin.cookie },
  }).then((response) => response.json());
  assert.ok(
    !pendingAfter.items.some((item: { id: string }) => item.id === foreign.id),
    "a resolved exception must leave the pending queue",
  );

  console.log(
    `OK  records=${records.length} exceptions=${exceptions.length} centers=${store.ALL_CENTERS.length}`,
  );
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
