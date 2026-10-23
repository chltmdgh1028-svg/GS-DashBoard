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

const PHOTO_A = "r2_0f8c2b1a-1111-4222-8333-444455556666_a1b2c3d4e5f60718";
const PHOTO_B = "r2_9e8d7c6b-aaaa-4bbb-8ccc-ddddeeeeffff_0918273645abcdef";

/** Field names as production returns them: no 센터명, no 불량수량, photos as array + newline string. */
const ROWS = [
  {
    __rowNumber: 2,
    작업기준일또는CSV식별값: "csv_2026-10-22_2c10b50f",
    상품코드: "2345001658347",
    상품명: "FCS)조생밀감(950G/팩)",
    협력사명: "영농조합법인신우유통",
    "DPT명": "과일",
    발주수량: 375,
    검품수량: 90,
    회송수량: 2,
    교환수량: 0,
    불량사유: "무름",
    버전: 3,
    photoFileIds: [PHOTO_A, PHOTO_B],
    사진파일ID목록: `${PHOTO_A}\n${PHOTO_B}`,
  },
];

const MOVEMENTS = [
  {
    작성일시: "2026-10-22 20:41:56",
    작업기준일또는CSV식별값: "csv_2026-10-22_2c10b50f",
    상품코드: "2345001658347",
    센터명: "김해일배센터",
    처리유형: "회송",
    회송수량: 2,
    교환수량: 0,
    불량사유: "무름",
    effectiveActionStatus: "미처리",
  },
];

/**
 * A faithful model of the app's `app_save_qty_batch` for ONE row, so the console
 * is tested against the behaviour that matters rather than against "ok: true":
 * a CAS conflict is answered with `ok: true` and a per-row status, an identical
 * request is an idempotent replay, and lowering a quantity needs an explicit
 * user action (and an explicit zero for 0).
 */
const CORR = { job: "csv_2026-10-15", code: "2800100437083", partner: "의령농산", orderQty: 42 };
const model = { qty: 6, rev: 1792064124303000, requestId: "qty-1792064124303-511481", version: 2 };
/** Test switches: lose the response after applying the write / before applying it. */
const fault = { dropAfterApply: false, dropBeforeApply: false };
const stubCalls = { save: 0 };

const corrRow = () => ({
  __rowNumber: 99,
  작업기준일또는CSV식별값: CORR.job,
  상품코드: CORR.code,
  상품명: "햇생강(1KG/봉)",
  협력사명: CORR.partner,
  "DPT명": "근채",
  발주수량: CORR.orderQty,
  검품수량: model.qty,
  회송수량: 0,
  교환수량: 0,
  불량사유: "",
  버전: model.version,
  수량요청ID: model.requestId,
  수량요청리비전: model.rev,
  수정일시: "2026-10-15T11:35:36.000Z",
  photoFileIds: [],
});

function saveQty(body: Record<string, unknown>) {
  const r = (body.rows as Record<string, unknown>[])[0];
  const item = (status: string, extra: Record<string, unknown> = {}) => ({
    jobKey: r["작업기준일또는CSV식별값"], productCode: r["상품코드"], requestId: r.requestId, requestedQty: r["검품수량"], status, ...extra,
  });
  const envelope = (items: Record<string, unknown>[], saved: number, cas: number, row?: Record<string, unknown>) => ({
    ok: items.length - cas === saved,
    data: { inspectionRows: row ? [row] : [], inspectionItemResults: items, conflicts: [] },
    requestedCount: 1, savedCount: saved, casConflictCount: cas,
  });

  const known = r["작업기준일또는CSV식별값"] === CORR.job && r["상품코드"] === CORR.code && r["협력사명"] === CORR.partner;
  if (!known) return { ok: false, error: "INSPECTION_QTY_PARTIAL_SAVE", data: { inspectionItemResults: [item("append_blocked_no_name")] } };

  const qty = Number(r["검품수량"]);
  if (r.requestId === model.requestId && qty === model.qty) {
    return envelope([item("idempotent_replay", { savedQty: model.qty })], 1, 0);
  }

  const hasBaseQty = r.baseQty !== undefined;
  const hasBaseRev = r.baseRevision !== undefined;
  const decrease = model.qty > 0 && qty < model.qty;
  let reason = "";
  if (hasBaseQty) {
    if (Number(r.baseQty) !== model.qty) reason = "cas_base_qty_mismatch";
    else if (hasBaseRev && Number(r.baseRevision) !== model.rev) reason = "cas_base_revision_mismatch";
  } else if (decrease) reason = "cas_base_missing_for_decrease";
  if (!reason && decrease) {
    if (r.isUserAction !== true) reason = "decrease_requires_explicit_user_input";
    else if (qty === 0 && r.explicitZero !== true) reason = "zero_requires_explicit_user_input";
  }
  if (reason) {
    return envelope([item("conflict", { reason, savedQty: model.qty, currentQty: model.qty, currentRevision: model.rev })], 0, 1);
  }

  model.qty = qty;
  model.requestId = String(r.requestId);
  model.version += 1;
  return envelope([item("updated", { savedQty: qty })], 1, 0, { 버전: model.version, 수정일시: "2026-10-23 17:00:00" });
}

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
      return send({
        ok: true,
        rows: [...ROWS, corrRow()],
        rowIdentityNamespace: "supabase:inspection_records",
        sourceVersion: { version: "510", lastAction: "saveInspectionQtyFastBatch" },
      });
    }
    if (body.action === "getReturnExchangeRecords") return send({ ok: true, records: MOVEMENTS });
    if (body.action === "getHistoryData") return send({ ok: true, data: [] });
    if (body.action === "saveInspectionQtyFastBatch") {
      stubCalls.save += 1;
      if (fault.dropBeforeApply) {
        fault.dropBeforeApply = false;
        return res.socket?.destroy();
      }
      const result = saveQty(body);
      if (fault.dropAfterApply) {
        fault.dropAfterApply = false;
        return res.socket?.destroy();
      }
      return send(result);
    }
    if (body.action === "confirmInspectionQty") {
      const same = (body.payload as Record<string, unknown>)?.requestId === model.requestId;
      return send({ ok: true, matches: same, requestIdMatched: same });
    }
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
const { photoIdsOf } = await import("../src/photos.js");

/* --------------------------------------------- photo ids (real field names) */

assert.deepEqual(photoIdsOf({ photoFileIds: [PHOTO_A, PHOTO_B] }), [PHOTO_A, PHOTO_B], "array form");
assert.deepEqual(
  photoIdsOf({ photoFileIds: [], 사진파일ID목록: `${PHOTO_A}\n${PHOTO_B}` }),
  [PHOTO_A, PHOTO_B],
  "newline-string fallback when the array is empty",
);
assert.deepEqual(photoIdsOf({ photoFileIds: [PHOTO_A, PHOTO_A] }), [PHOTO_A], "duplicates collapse");
assert.deepEqual(photoIdsOf({ photoFileIds: [PHOTO_A, "short", "bad id!", ""] }), [PHOTO_A], "ids /api/photo rejects are dropped");
assert.deepEqual(photoIdsOf({}), [], "a row with no photo field has no photos");
assert.deepEqual(photoIdsOf({ photoFileIds: [], 사진파일ID목록: "" }), [], "empty fields have no photos");
// The names the first version guessed must not be what we rely on.
assert.deepEqual(photoIdsOf({ photoIds: [PHOTO_A], 사진들: [PHOTO_A] }), [], "guessed field names are not read");

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

/** A correction the row actually supports; every field comes from what the row says right now. */
const correction = {
  jobKey: CORR.job,
  productCode: CORR.code,
  partnerName: CORR.partner,
  productName: "햇생강(1KG/봉)",
  qty: 5,
  orderQty: CORR.orderQty,
  baseQty: 6,
  baseRevision: 1792064124303000,
  requestId: `qty-${Date.now()}-abcd1234`,
};
let sequence = 0;
const newRequestId = () => `qty-${Date.now() + (sequence += 1)}-t${String(sequence).padStart(7, "0")}`;

type Outcome = { status: string; currentQty?: number; reason?: string; savedQty?: number; message?: string };
const outcomeOf = async (response: Response) => ((await response.json()) as { outcome: Outcome }).outcome;
const verify = (extra: Record<string, unknown>) =>
  post("/api/ops/verify-qty", { jobKey: CORR.job, productCode: CORR.code, partnerName: CORR.partner, ...extra }).then(
    (response) => response.json() as Promise<{ verification: Record<string, unknown> }>,
  );

try {
  /* -------------------------------------------------------------- auth */

  assert.equal(main.status, 200, "admin login must succeed");
  assert.ok(cookie, "login must set a session cookie");

  const legacy = await post("/api/login", { userId: "admin", password: "fresh1652" }, "");
  assert.equal(legacy.status, 401, "legacy default credentials must be rejected");

  const anonymous = await fetch(`${base}/api/ops/rows`);
  assert.equal(anonymous.status, 401, "unauthenticated reads must be refused");

  /* ------------------------------------------------------------- reads */

  // date / jobKey / center are filters the app ignores (verified on production),
  // so they must never be forwarded as if they narrowed anything.
  const rows = await fetch(
    `${base}/api/ops/rows?filterMode=all&date=2026-01-01&jobKey=JOB-X&center=abc`,
    { headers: { cookie } },
  ).then(json);
  assert.equal((rows.rows as unknown[]).length, 2, "rows must pass through unchanged");
  assert.equal((rows.sourceVersion as { version?: string }).version, "510", "sourceVersion must pass through");

  const rowCall = received.findLast((entry) => entry.action === "getInspectionRows");
  const rowPayload = rowCall?.body.payload as Record<string, unknown>;
  assert.equal(rowPayload.filterMode, "all", "filterMode must reach the app");
  assert.equal(rowPayload.includePhotos, "true", "photos must be requested with the rows");
  for (const ignored of ["date", "jobKey", "selectedCenter", "center"]) {
    assert.ok(!(ignored in rowPayload), `${ignored} is ignored by the app and must not be forwarded`);
  }

  await fetch(`${base}/api/ops/rows?filterMode=bogus`, { headers: { cookie } }).then(json);
  const bogus = received.findLast((entry) => entry.action === "getInspectionRows");
  assert.equal(
    (bogus?.body.payload as Record<string, unknown>).filterMode,
    "current",
    "an unknown filterMode must fall back to current, never reach the app verbatim",
  );

  // Every call must mark itself as a service integration, or the app's
  // minimum-client-version gate answers CLIENT_UPDATE_REQUIRED.
  assert.equal(rowCall?.body.clientPlatform, "service", "calls must declare clientPlatform service");
  assert.equal(rowCall?.body.caller, "inspection-master-console", "calls must declare a caller");
  assert.equal(rowCall?.body.sessionToken, "stub-session-token", "the token must be attached server-side");

  const movements = await fetch(`${base}/api/ops/movements`, { headers: { cookie } }).then(json);
  assert.equal((movements.records as unknown[]).length, 1, "movements must come back under `records`");
  const movementCall = received.findLast((entry) => entry.action === "getReturnExchangeRecords");
  assert.equal(
    (movementCall?.body.payload as Record<string, unknown>).filterMode,
    "all",
    "movements default to all: current is empty on a quiet day",
  );
  await fetch(`${base}/api/ops/history`, { headers: { cookie } }).then(json);

  // The 3.5MB current-job proxy was removed; it must stay gone.
  const gone = await fetch(`${base}/api/ops/current-job`, { headers: { cookie } });
  assert.equal(gone.status, 404, "the current-job proxy must not exist");

  /* -------------------------------------------------- correction guards */

  for (const [label, body] of [
    ["missing baseQty", { ...correction, baseQty: undefined }],
    ["negative qty", { ...correction, qty: -1 }],
    ["fractional qty", { ...correction, qty: 1.5 }],
    ["missing jobKey", { ...correction, jobKey: "" }],
    ["missing partnerName (the row identity needs it)", { ...correction, partnerName: "" }],
    ["bare uuid requestId", { ...correction, requestId: "0f8c2b1a" }],
    ["requestId without timestamp", { ...correction, requestId: "qty-abc-1" }],
    ["fractional baseRevision", { ...correction, baseRevision: 1.5 }],
  ] as const) {
    const before = received.length;
    const response = await post("/api/ops/correct-qty", body);
    assert.equal(response.status, 400, `${label} must be refused`);
    assert.equal(received.length, before, `${label} must never reach the inspection app`);
  }

  // A job allowlist limits the blast radius: other jobs are refused before the app is called.
  process.env.CORRECTIONS_JOB_ALLOWLIST = "csv_2026-10-17_1bccbd10";
  const beforeAllow = received.length;
  const outOfScope = await post("/api/ops/correct-qty", correction);
  assert.equal(outOfScope.status, 403, "a job outside the allowlist must be refused");
  assert.equal(received.length, beforeAllow, "an out-of-scope correction must never reach the app");
  process.env.CORRECTIONS_JOB_ALLOWLIST = CORR.job;
  const inScope = await fetch(`${base}/api/session`, { headers: { cookie } }).then(json);
  assert.deepEqual(inScope.correctionJobs, [CORR.job], "the UI is told which jobs may be corrected");
  delete process.env.CORRECTIONS_JOB_ALLOWLIST;

  /* ------------------------------------------------------ correction ok */

  const first = await post("/api/ops/correct-qty", correction);
  assert.equal(first.status, 200, "a well-formed correction must be accepted");
  const firstOutcome = await outcomeOf(first);
  assert.equal(firstOutcome.status, "updated");
  assert.equal(firstOutcome.savedQty, 5);
  assert.equal(model.qty, 5, "the app's row now holds the new qty");

  const saveCall = received.findLast((entry) => entry.action === "saveInspectionQtyFastBatch");
  const sent = (saveCall?.body.rows as Record<string, unknown>[])[0];
  assert.equal(sent.type, "inspection");
  assert.equal(sent["검품수량"], 5, "the new qty must be sent");
  assert.equal(sent.baseQty, 6, "the CAS base qty must be sent, or a stale correction would overwrite");
  assert.equal(sent.baseRevision, 1792064124303000, "the CAS base revision must be sent too, so a qty that changed and changed back is still caught");
  assert.equal(sent.requestId, correction.requestId, "the requestId must reach the app unchanged");
  assert.equal(sent.isUserAction, true);
  assert.equal(sent.explicitZero, false, "a non-zero correction must not be flagged explicitZero");
  assert.equal(sent["협력사명"], CORR.partner, "the partner is part of the row identity");

  // The save response is not the evidence: the canonical row is read back.
  const afterFirst = (await verify({ expectedQty: 5, requestId: correction.requestId })).verification;
  assert.equal(afterFirst.found, true);
  assert.equal(afterFirst.qty, 5);
  assert.equal(afterFirst.matchesQty, true, "the re-read row must show the new qty");
  assert.equal(afterFirst.matchesRequestId, true, "the re-read row must carry this request's id");
  assert.equal((afterFirst.confirm as { matches?: boolean }).matches, true, "confirmInspectionQty is asked too");

  // The same request again is an idempotent replay, not a second write.
  const replay = await outcomeOf(await post("/api/ops/correct-qty", correction));
  assert.equal(replay.status, "idempotent_replay", "an identical request is recognised as already saved");
  assert.equal(model.version, 3, "a replay must not bump the row's version");

  /* ------------------------------------------------------------ CAS conflict */

  // Someone else changed the row to 5 after we read 6. We are still holding baseQty 6.
  const conflictId = newRequestId();
  const conflictCall = await post("/api/ops/correct-qty", { ...correction, qty: 2, requestId: conflictId });
  assert.equal(conflictCall.status, 200, "a conflict is an outcome, not an HTTP error");
  const conflict = await outcomeOf(conflictCall);
  // This is the line that would have been wrong if the console read `ok`: the app answers ok:true here.
  const conflictEnvelope = saveQty({ rows: [{ ...sent, requestId: newRequestId(), 검품수량: 1, baseQty: 6 }] });
  assert.equal(conflictEnvelope.ok, true, "premise: the app reports a CAS conflict with ok:true");
  assert.equal(conflict.status, "conflict", "a CAS conflict must never be reported as saved");
  assert.equal(conflict.currentQty, 5, "the conflict must carry the value the row holds now");
  assert.equal(model.qty, 5, "a conflicting correction must not overwrite anything");
  assert.ok(!conflict.message?.includes("완료"), "a conflict must not read like a success");

  // Same qty, but the revision moved (changed and changed back): still a conflict.
  const revConflict = await outcomeOf(
    await post("/api/ops/correct-qty", { ...correction, baseQty: 5, baseRevision: 1792064124303001, qty: 4, requestId: newRequestId() }),
  );
  assert.equal(revConflict.status, "conflict", "a stale revision conflicts even when the qty matches");
  assert.equal(model.qty, 5);

  /* ---------------------------------------------------------------- zero */

  // Lowering to 0 is legitimate, and the app insists on an explicit zero for it.
  const zeroId = newRequestId();
  const zero = await outcomeOf(await post("/api/ops/correct-qty", { ...correction, qty: 0, baseQty: 5, requestId: zeroId }));
  assert.equal(zero.status, "updated", "0 is a normal correction value");
  assert.equal(zero.savedQty, 0);
  const zeroSent = (received.findLast((entry) => entry.action === "saveInspectionQtyFastBatch")?.body.rows as Record<string, unknown>[])[0];
  assert.equal(zeroSent["검품수량"], 0);
  assert.equal(zeroSent.explicitZero, true, "a zero correction must set explicitZero");
  assert.equal(model.qty, 0);
  const zeroRead = (await verify({ expectedQty: 0, requestId: zeroId })).verification;
  assert.equal(zeroRead.matchesQty, true, "0 must verify as 0, not as missing");
  assert.equal(zeroRead.qty, 0);

  // Raising from 0 back up needs no explicit flag but still carries its base.
  const restore = await outcomeOf(await post("/api/ops/correct-qty", { ...correction, qty: 6, baseQty: 0, requestId: newRequestId() }));
  assert.equal(restore.status, "updated");
  assert.equal(model.qty, 6);

  /* ------------------------------------------------ lost response (uncertain) */

  // The write lands, but the response never arrives. The console must report an
  // uncertain outcome, must NOT send the write again, and must let the row decide.
  const lostId = newRequestId();
  const savesBefore = stubCalls.save;
  fault.dropAfterApply = true;
  const lost = await post("/api/ops/correct-qty", { ...correction, qty: 4, baseQty: 6, requestId: lostId });
  assert.ok(lost.status >= 500, "a lost response is not reported as success");
  const lostBody = (await lost.json()) as { retryable?: boolean };
  assert.equal(lostBody.retryable, true, "the browser is told the outcome is uncertain");
  assert.equal(stubCalls.save, savesBefore + 1, "a lost response must never be resent automatically");
  assert.equal(model.qty, 4, "premise: the write did land");
  const landed = (await verify({ expectedQty: 4, requestId: lostId })).verification;
  assert.equal(landed.matchesQty, true, "reading the row shows the write landed");
  assert.equal(landed.matchesRequestId, true);

  // The other uncertain case: the request never reached the app.
  const neverId = newRequestId();
  fault.dropBeforeApply = true;
  const never = await post("/api/ops/correct-qty", { ...correction, qty: 3, baseQty: 4, requestId: neverId });
  assert.ok(never.status >= 500);
  assert.equal(model.qty, 4, "premise: nothing was written");
  const notLanded = (await verify({ expectedQty: 3, requestId: neverId })).verification;
  assert.equal(notLanded.matchesQty, false, "reading the row shows it did not land");
  assert.equal(notLanded.matchesRequestId, false);
  assert.equal(notLanded.qty, 4, "and reports what the row holds");

  /* ------------------------------------------------------------ PENDING */

  // PENDING is returned as an outcome, never retried, and resolved by reading.
  const pendingId = newRequestId();
  nextResponse = { ok: false, pendingWrite: true, error: "NATIVE_WRITE_PENDING", message: "확인 중" };
  const saveRequests = () => received.filter((entry) => entry.action === "saveInspectionQtyFastBatch").length;
  const savesAtPending = saveRequests();
  const pendingOutcome = await outcomeOf(await post("/api/ops/correct-qty", { ...correction, qty: 3, baseQty: 4, requestId: pendingId }));
  assert.equal(pendingOutcome.status, "pending", "a pending write must come back as pending, not as an error or a success");
  assert.equal(saveRequests(), savesAtPending + 1, "a pending answer must be followed by no further write: exactly one request was made");

  /* ------------------------------------------ refuse to interpret odd answers */

  for (const [label, answer, status] of [
    ["no per-row result", { ok: true, data: { inspectionItemResults: [] } }, "unknown"],
    ["a different qty than asked", { ok: true, data: { inspectionItemResults: [{ status: "updated", savedQty: 99 }] } }, "unknown"],
    ["a row that was inserted", { ok: true, data: { inspectionItemResults: [{ status: "inserted", savedQty: 3 }] } }, "unknown"],
    ["a stale-ignored write", { ok: true, data: { inspectionItemResults: [{ status: "stale_ignored", savedQty: 4 }] } }, "stale_ignored"],
    ["a blocked append", { ok: true, data: { inspectionItemResults: [{ status: "append_blocked_no_name" }] } }, "blocked"],
  ] as const) {
    nextResponse = answer as Record<string, unknown>;
    const got = await outcomeOf(await post("/api/ops/correct-qty", { ...correction, qty: 3, baseQty: 4, requestId: newRequestId() }));
    assert.equal(got.status, status, `${label} must be reported as ${status}`);
  }
  assert.equal(model.qty, 4, "none of those answers wrote anything");

  // The old confirm route is gone; verification is the re-read.
  const oldConfirm = await post("/api/ops/confirm-qty", {});
  assert.equal(oldConfirm.status, 404, "the old confirm-qty route must not exist");

  /* ------------------------------------------------- receipts / recovery */

  const receipt = await post("/api/ops/write-status", {
    operationId: "op-1",
    kind: "action_status",
    payloadHash: "a".repeat(64),
  }).then(json);
  assert.equal((receipt.nativeAck as Record<string, unknown>).state, "COMMITTED");

  for (const [label, body] of [
    ["no operationId", { kind: "action_status", payloadHash: "a".repeat(64) }],
    ["no payloadHash", { kind: "action_status", operationId: "op-1" }],
  ] as const) {
    const before = received.length;
    const response = await post("/api/ops/write-status", body);
    assert.equal(response.status, 400, `a receipt lookup with ${label} must be refused`);
    assert.equal(received.length, before, `${label} must not reach the app (it answers NATIVE_WRITE_INVALID)`);
  }

  const recoverNoHash = await post("/api/ops/recover-write", { kind: "action_status", operationId: "op-1" });
  assert.equal(recoverNoHash.status, 400, "recovery also needs the payloadHash");

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
    body: JSON.stringify({ operationId: "op-1", kind: "action_status", payloadHash: "a".repeat(64) }),
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
  assert.ok(!("inspectionBase" in health) && !("adminGridUrl" in health), "health must not expose the inspection origin");

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
