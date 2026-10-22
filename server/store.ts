/**
 * Console data layer.
 *
 * Two separate concerns on purpose:
 *
 *  - The inspection feed (records -> exceptions) is *derived*. Today it comes
 *    from a deterministic seed keyed by the business date, so the console is
 *    demonstrable and every reader sees the same numbers. Point `loadRecords`
 *    at the real inspection report API to go live; nothing above this file
 *    changes, because it already receives finished `InspectionRecord`s.
 *
 *  - Operator decisions are the only thing that is *written*. They are kept in
 *    one JSON file and overlaid onto the derived exceptions on read, so a
 *    decision survives a feed refresh.
 *
 * ponytail: decisions live in a JSON file under DATA_DIR, which on Vercel is
 * the function's tmpdir and therefore resets when the instance recycles. That
 * is fine for a console under evaluation; move `readDecisions`/`writeDecision`
 * to Postgres or Vercel KV when a decision has to outlive the instance.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  CenterStatus,
  ConsoleOverview,
  ConsoleScope,
  ConsoleTotals,
  ExceptionDecision,
  ExceptionItem,
  ExceptionKind,
  ExceptionState,
  HourlyBucket,
  InspectionRecord,
  InspectorLoad,
  Severity,
} from "../src/domain/types.js";

const defaultDataDir = process.env.VERCEL
  ? path.join(os.tmpdir(), "inspection-console-data")
  : path.join(process.cwd(), "data");

const dataDir = process.env.DATA_DIR || defaultDataDir;
const decisionsPath = path.join(dataDir, "decisions.json");

/** Operating target for the inspection rate. One knob, one place. */
export const INSPECTION_TARGET = Number(process.env.INSPECTION_TARGET || 0.9);

/** Defect rate at or above which an inspection is escalated immediately. */
const CRITICAL_DEFECT_RATE = Number(process.env.CRITICAL_DEFECT_RATE || 0.15);

/* ---------------------------------------------------------------- Decisions */

type DecisionMap = Record<string, ExceptionDecision>;

function readDecisions(): DecisionMap {
  try {
    if (!fs.existsSync(decisionsPath)) return {};
    const parsed = JSON.parse(fs.readFileSync(decisionsPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as DecisionMap;
  } catch {
    // A corrupt or unreadable file must not take the console down: an empty
    // decision set degrades to "nothing decided yet", which is safe to show.
    return {};
  }
}

export function writeDecision(exceptionId: string, decision: ExceptionDecision) {
  const all = readDecisions();
  all[exceptionId] = decision;
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = `${decisionsPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, decisionsPath);
}

/* ------------------------------------------------------------ Seeded feed */

const CENTERS = ["수도권센터", "중부센터", "영남센터", "호남센터"] as const;

const PRODUCTS: { name: string; category: string }[] = [
  { name: "사과 부사 5kg", category: "농산" },
  { name: "방울토마토 500g", category: "농산" },
  { name: "깐마늘 1kg", category: "농산" },
  { name: "애호박 1입", category: "농산" },
  { name: "손질오징어 300g", category: "수산" },
  { name: "고등어 자반 2미", category: "수산" },
  { name: "생연어 필렛 400g", category: "수산" },
  { name: "한돈 삼겹살 500g", category: "축산" },
  { name: "한우 불고기 300g", category: "축산" },
  { name: "닭가슴살 1kg", category: "축산" },
  { name: "두부 부침용 300g", category: "가공" },
  { name: "콩나물 300g", category: "가공" },
];

const SUPPLIERS = [
  "가온프레시",
  "대림수산",
  "미드웨이푸드",
  "한결농산",
  "청해물산",
  "새벽유통",
];

const INSPECTORS = ["김민재", "이서연", "박준호", "정하늘", "최유진", "한지우", "오세훈", "윤가은"];

const DEFECT_REASONS = [
  "외관 불량",
  "중량 미달",
  "당도 미달",
  "포장 파손",
  "이물 혼입",
  "선도 저하",
  "규격 이탈",
];

/**
 * Deterministic PRNG (xorshift32). The feed must be stable for a given
 * business date: two operators comparing screens, or the same operator after a
 * reload, have to see identical numbers.
 */
function makeRandom(seed: string) {
  let state = 2166136261;
  for (const char of seed) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  state >>>= 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

function intBetween(random: () => number, min: number, max: number) {
  return min + Math.floor(random() * (max - min + 1));
}

function safeRate(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function resultOf(defectQty: number, returnQty: number, exchangeQty: number): InspectionRecord["result"] {
  if (returnQty > 0) return "return";
  if (exchangeQty > 0) return "exchange";
  if (defectQty > 0) return "defect";
  return "normal";
}

/**
 * Build the inspection feed for one business date.
 *
 * Replace the body with a call to the real inspection report API when going
 * live. Everything downstream consumes `InspectionRecord[]` only.
 */
export function loadRecords(businessDate: string): { records: InspectionRecord[]; seeded: boolean } {
  const random = makeRandom(businessDate);
  const records: InspectionRecord[] = [];

  for (const center of CENTERS) {
    const perCenter = intBetween(random, 14, 22);
    for (let index = 0; index < perCenter; index += 1) {
      const product = pick(random, PRODUCTS);
      const inboundQty = intBetween(random, 60, 900);

      // Most inspections clear the target; a minority fall short, which is
      // exactly what the console exists to surface.
      const shortfall = random() < 0.18;
      const rate = shortfall ? 0.55 + random() * 0.3 : 0.9 + random() * 0.1;
      const inspectionQty = Math.max(1, Math.min(inboundQty, Math.round(inboundQty * rate)));

      // Defects are rare but heavy-tailed: a few inspections are genuinely bad.
      const bad = random() < 0.12;
      const defectShare = bad ? 0.15 + random() * 0.22 : random() * 0.05;
      const defectQty = Math.min(inspectionQty, Math.round(inspectionQty * defectShare));

      const returnQty = defectQty > 0 && random() < 0.35 ? intBetween(random, 1, defectQty) : 0;
      const exchangeQty =
        defectQty - returnQty > 0 && random() < 0.3 ? intBetween(random, 1, defectQty - returnQty) : 0;

      const reasonCount = defectQty > 0 ? intBetween(random, 1, 2) : 0;
      const defectReasons: string[] = [];
      for (let r = 0; r < reasonCount; r += 1) {
        const reason = pick(random, DEFECT_REASONS);
        if (!defectReasons.includes(reason)) defectReasons.push(reason);
      }

      const hour = intBetween(random, 6, 19);
      const minute = intBetween(random, 0, 59);

      records.push({
        id: `insp-${businessDate}-${center}-${index}`,
        date: businessDate,
        time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        center,
        sku: String(8800000 + Math.floor(random() * 99999)),
        productName: product.name,
        category: product.category,
        supplier: pick(random, SUPPLIERS),
        inspector: pick(random, INSPECTORS),
        inboundQty,
        inspectionQty,
        defectQty,
        returnQty,
        exchangeQty,
        inspectionRate: safeRate(inspectionQty, inboundQty),
        defectRate: safeRate(defectQty, inspectionQty),
        result: resultOf(defectQty, returnQty, exchangeQty),
        defectReasons,
        photoCount: defectQty > 0 && random() < 0.12 ? 0 : intBetween(random, 1, 6),
      });
    }
  }

  records.sort((a, b) => a.time.localeCompare(b.time));
  return { records, seeded: true };
}

/* ----------------------------------------------------------- Exceptions */

const SLA_HOURS: Record<ExceptionKind, number> = {
  defect_critical: 2,
  return_pending: 8,
  exchange_pending: 8,
  inspection_shortfall: 4,
  photo_missing: 6,
};

function raisedAtFor(record: InspectionRecord) {
  return new Date(`${record.date}T${record.time}:00+09:00`).toISOString();
}

function dueAtFor(record: InspectionRecord, kind: ExceptionKind) {
  const raised = new Date(raisedAtFor(record)).getTime();
  return new Date(raised + SLA_HOURS[kind] * 3600_000).toISOString();
}

function exceptionFor(
  record: InspectionRecord,
  kind: ExceptionKind,
  severity: Severity,
  summary: string,
  qty?: number,
): ExceptionItem {
  return {
    id: `${record.id}:${kind}`,
    inspectionId: record.id,
    kind,
    severity,
    state: "open",
    center: record.center,
    sku: record.sku,
    productName: record.productName,
    supplier: record.supplier,
    inspector: record.inspector,
    raisedAt: raisedAtFor(record),
    dueAt: dueAtFor(record, kind),
    summary,
    defectRate: record.defectRate,
    qty,
  };
}

/**
 * Derive the operator queue from the feed.
 *
 * One inspection can raise more than one exception - a critical defect that
 * also has no photo is two different jobs for two different people - so these
 * are independent items rather than one row with flags.
 */
export function deriveExceptions(records: InspectionRecord[]): ExceptionItem[] {
  const items: ExceptionItem[] = [];

  for (const record of records) {
    if (record.defectRate >= CRITICAL_DEFECT_RATE) {
      items.push(
        exceptionFor(
          record,
          "defect_critical",
          "error",
          `불량률 ${(record.defectRate * 100).toFixed(1)}% · ${record.defectReasons.join(", ") || "사유 미기재"}`,
          record.defectQty,
        ),
      );
    }

    if (record.returnQty > 0) {
      items.push(
        exceptionFor(record, "return_pending", "warning", `반품 ${record.returnQty}개 승인 대기`, record.returnQty),
      );
    }

    if (record.exchangeQty > 0) {
      items.push(
        exceptionFor(record, "exchange_pending", "info", `교환 ${record.exchangeQty}개 승인 대기`, record.exchangeQty),
      );
    }

    if (record.inspectionRate < INSPECTION_TARGET) {
      items.push(
        exceptionFor(
          record,
          "inspection_shortfall",
          "warning",
          `검품률 ${(record.inspectionRate * 100).toFixed(1)}% · 목표 ${(INSPECTION_TARGET * 100).toFixed(0)}% 미달`,
          record.inboundQty - record.inspectionQty,
        ),
      );
    }

    if (record.defectQty > 0 && record.photoCount === 0) {
      items.push(
        exceptionFor(record, "photo_missing", "warning", "불량 판정 건에 증빙 사진 없음", record.defectQty),
      );
    }
  }

  // Most urgent first: overdue before due, severe before mild.
  const severityOrder: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  items.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.dueAt.localeCompare(b.dueAt),
  );
  return items;
}

/** Overlay stored operator decisions onto the derived queue. */
export function applyDecisions(items: ExceptionItem[]): ExceptionItem[] {
  const decisions = readDecisions();
  return items.map((item) => {
    const decision = decisions[item.id];
    if (!decision) return item;
    return { ...item, state: stateForAction(decision.action), decision };
  });
}

export function stateForAction(action: ExceptionDecision["action"]): ExceptionState {
  if (action === "hold") return "held";
  if (action === "dismiss") return "dismissed";
  return "resolved";
}

export function isOverdue(item: ExceptionItem, now = Date.now()) {
  if (item.state === "resolved" || item.state === "dismissed") return false;
  return new Date(item.dueAt).getTime() < now;
}

function isPending(item: ExceptionItem) {
  return item.state === "open" || item.state === "held";
}

/* ------------------------------------------------------------- Aggregation */

export function totalsFor(records: InspectionRecord[]): ConsoleTotals {
  const inboundQty = records.reduce((sum, record) => sum + record.inboundQty, 0);
  const inspectionQty = records.reduce((sum, record) => sum + record.inspectionQty, 0);
  const defectQty = records.reduce((sum, record) => sum + record.defectQty, 0);

  return {
    inboundQty,
    inspectionQty,
    inspectionRate: safeRate(inspectionQty, inboundQty),
    inspectionTarget: INSPECTION_TARGET,
    defectQty,
    defectRate: safeRate(defectQty, inspectionQty),
    returnQty: records.reduce((sum, record) => sum + record.returnQty, 0),
    exchangeQty: records.reduce((sum, record) => sum + record.exchangeQty, 0),
    inspectedSkus: new Set(records.map((record) => record.sku)).size,
    photoCount: records.reduce((sum, record) => sum + record.photoCount, 0),
  };
}

function healthFor(inspectionRate: number, overdue: number, defectRate: number): CenterStatus["health"] {
  if (overdue > 0 || defectRate >= CRITICAL_DEFECT_RATE) return "error";
  if (inspectionRate < INSPECTION_TARGET) return "warning";
  return "normal";
}

export function centerStatusesFor(
  records: InspectionRecord[],
  exceptions: ExceptionItem[],
  now = Date.now(),
): CenterStatus[] {
  const centers = [...new Set(records.map((record) => record.center))].sort((a, b) => a.localeCompare(b, "ko"));

  return centers.map((center) => {
    const centerRecords = records.filter((record) => record.center === center);
    const centerExceptions = exceptions.filter((item) => item.center === center);
    const totals = totalsFor(centerRecords);
    const pending = centerExceptions.filter(isPending);
    const overdue = pending.filter((item) => isOverdue(item, now));
    const lastActivity = centerRecords.reduce<string | undefined>((latest, record) => {
      const at = raisedAtFor(record);
      return !latest || at > latest ? at : latest;
    }, undefined);

    return {
      center,
      health: healthFor(totals.inspectionRate, overdue.length, totals.defectRate),
      inboundQty: totals.inboundQty,
      inspectionQty: totals.inspectionQty,
      inspectionRate: totals.inspectionRate,
      inspectionTarget: INSPECTION_TARGET,
      defectQty: totals.defectQty,
      defectRate: totals.defectRate,
      openExceptions: pending.length,
      overdueExceptions: overdue.length,
      inspectorCount: new Set(centerRecords.map((record) => record.inspector)).size,
      lastActivityAt: lastActivity,
    };
  });
}

export function hourlyFor(records: InspectionRecord[]): HourlyBucket[] {
  const buckets = new Map<string, HourlyBucket>();
  for (const record of records) {
    const hour = `${record.time.slice(0, 2)}:00`;
    const bucket = buckets.get(hour) ?? { hour, inspectionQty: 0, defectQty: 0 };
    bucket.inspectionQty += record.inspectionQty;
    bucket.defectQty += record.defectQty;
    buckets.set(hour, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.hour.localeCompare(b.hour));
}

export function inspectorLoadFor(records: InspectionRecord[], exceptions: ExceptionItem[]): InspectorLoad[] {
  const names = [...new Set(records.map((record) => record.inspector))];

  return names
    .map((inspector) => {
      const own = records.filter((record) => record.inspector === inspector);
      const inspectionQty = own.reduce((sum, record) => sum + record.inspectionQty, 0);
      const defectQty = own.reduce((sum, record) => sum + record.defectQty, 0);
      const lastActivity = own.reduce<string | undefined>((latest, record) => {
        const at = raisedAtFor(record);
        return !latest || at > latest ? at : latest;
      }, undefined);

      return {
        inspector,
        center: own[0]?.center ?? "-",
        inspections: own.length,
        inspectionQty,
        defectQty,
        defectRate: safeRate(defectQty, inspectionQty),
        openExceptions: exceptions.filter((item) => item.inspector === inspector && isPending(item)).length,
        lastActivityAt: lastActivity,
      };
    })
    .sort((a, b) => b.inspectionQty - a.inspectionQty);
}

export function overviewFor(
  records: InspectionRecord[],
  exceptions: ExceptionItem[],
  scope: ConsoleScope,
  businessDate: string,
  seeded: boolean,
  now = Date.now(),
): ConsoleOverview {
  const pending = exceptions.filter(isPending);

  return {
    asOf: new Date(now).toISOString(),
    businessDate,
    scope,
    totals: totalsFor(records),
    openExceptions: pending.length,
    overdueExceptions: pending.filter((item) => isOverdue(item, now)).length,
    criticalExceptions: pending.filter((item) => item.severity === "error").length,
    centers: centerStatusesFor(records, exceptions, now),
    hourly: hourlyFor(records),
    seeded,
  };
}

/** Business date in Asia/Seoul, which is the date the centers operate on. */
export function currentBusinessDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export const ALL_CENTERS = CENTERS;
