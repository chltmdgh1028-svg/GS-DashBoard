/**
 * Self-check for the row model: 가나다 ordering, supplier grouping, filters and
 * summaries. Synthetic rows only, so it needs no network and no real data.
 *
 * What would be silently wrong rather than loudly broken: a supplier filed
 * under the wrong initial because of "(주)", filters that do not compose,
 * group totals that disagree with the rows, and a sort that reshuffles equal
 * values between renders.
 */
import assert from "node:assert/strict";
import type { InspectionRow } from "../src/domain/types.js";
import { compareSupplier, sortName } from "../src/lib/korean.js";
import {
  activeFilterCount,
  applyFilters,
  EMPTY_FILTERS,
  facet,
  groupBySupplier,
  initialOf,
  sortRows,
  summarize,
} from "../src/lib/rowsModel.js";

const PHOTO = "r2_0f8c2b1a-1111-4222-8333-444455556666_a1b2c3d4e5f60718";

const row = (over: Partial<InspectionRow>): InspectionRow => ({
  작업기준일또는CSV식별값: "csv_2026-10-22_aaaa",
  상품코드: "1",
  상품명: "상품",
  협력사명: "가나",
  "DPT명": "과일",
  발주수량: 10,
  검품수량: 0,
  회송수량: 0,
  교환수량: 0,
  불량사유: "",
  ...over,
});

/* ------------------------------------------------------------ sort names */

assert.equal(sortName("(주)엘제이농산"), "엘제이농산", "(주) prefix is not part of the sort key");
assert.equal(sortName("㈜엘제이농산"), "엘제이농산", "㈜ folds to (주) and is removed");
assert.equal(sortName("신우유통(주)"), "신우유통", "suffix legal form is removed");
assert.equal(sortName("영농조합법인신우유통"), "신우유통", "영농조합법인 is removed");
assert.equal(sortName("농업회사법인 가온 주식회사"), "가온", "several forms, spaces removed");
assert.equal(sortName("(주)"), "(주)", "a name that is only a legal form still has a key");

// the case the whole feature exists for: (주)엘제이농산 files under ㅇ, between 아 and 장
const names = ["(주)엘제이농산", "가온프레시", "한결농산", "영농조합법인신우유통", "대림수산", "청해물산", "CJ프레시웨이"];
const sorted = [...names].sort((a, b) => compareSupplier(a, b));
assert.deepEqual(
  sorted,
  ["가온프레시", "대림수산", "영농조합법인신우유통", "(주)엘제이농산", "청해물산", "한결농산", "CJ프레시웨이"],
  "ordered by the name without its legal form (신우유통 ㅅ before 엘제이농산 ㅇ), Hangul before Latin",
);
assert.deepEqual(
  sorted.map((name) => initialOf(name)),
  ["ㄱ", "ㄷ", "ㅅ", "ㅇ", "ㅊ", "ㅎ", "A-Z"],
  "initials follow ㄱ→ㅎ, Latin last",
);
assert.equal(compareSupplier("", "가나"), 1, "blank suppliers sort last");
assert.equal(compareSupplier("가나", ""), -1);
assert.equal(compareSupplier("", ""), 0);
assert.ok(compareSupplier("가나", "다라", "desc") > 0, "desc reverses the order");
assert.equal(compareSupplier("", "가나", "desc"), 1, "blank is last even when descending");

/* -------------------------------------------------------------- grouping */

const rows: InspectionRow[] = [
  row({ 상품코드: "1", 상품명: "사과", 협력사명: "(주)엘제이농산", 발주수량: 100, 검품수량: 90, 회송수량: 2, photoFileIds: [PHOTO] }),
  row({ 상품코드: "2", 상품명: "배", 협력사명: "(주)엘제이농산", 발주수량: 50, 검품수량: 0 }),
  row({ 상품코드: "3", 상품명: "귤", 협력사명: "가온프레시", 발주수량: 40, 검품수량: 40, 교환수량: 1, 불량사유: "무름" }),
  row({ 상품코드: "4", 상품명: "수박", 협력사명: "", "DPT명": "", 발주수량: 10, 검품수량: 5 }),
  row({ 상품코드: "5", 상품명: "토마토", 협력사명: "한결농산", "DPT명": "채소", 발주수량: 30, 검품수량: 0, 불량사유: "압상" }),
];

const groups = groupBySupplier(rows);
assert.deepEqual(
  groups.map((g) => g.key),
  ["가온프레시", "(주)엘제이농산", "한결농산", ""],
  "groups are 가나다 by stripped name, blank last",
);
assert.equal(groups.at(-1)?.label, "(협력사 미지정)");
assert.equal(
  groups.reduce((n, g) => n + g.rows.length, 0),
  rows.length,
  "grouping must neither drop nor duplicate a row",
);
assert.deepEqual(groupBySupplier(rows, "desc").map((g) => g.key), ["한결농산", "(주)엘제이농산", "가온프레시", ""], "desc reverses groups, blank still last");

const lj = groups.find((g) => g.key === "(주)엘제이농산")!;
assert.equal(lj.summary.rows, 2);
assert.equal(lj.summary.ordered, 150);
assert.equal(lj.summary.inspected, 90);
assert.equal(lj.summary.inspectedRows, 1, "only the row with 검품수량>0 counts as inspected");
assert.ok(Math.abs(lj.summary.rate - 90 / 150) < 1e-12, "rate is Σ검품 / Σ발주, not a mean of row rates");
assert.equal(lj.summary.returns, 2);
assert.equal(lj.summary.photos, 1);

const total = summarize(rows);
assert.equal(total.ordered, groups.reduce((n, g) => n + g.summary.ordered, 0), "group totals add up to the grand total");
assert.equal(total.inspected, groups.reduce((n, g) => n + g.summary.inspected, 0));
assert.equal(summarize([]).rate, 0, "an empty set has rate 0, not NaN");
assert.equal(summarize([row({ 발주수량: 0, 검품수량: 5 })]).rate, 0, "nothing ordered has rate 0, not Infinity");

/* --------------------------------------------------------------- sorting */

const bySupplier = sortRows(rows, { key: "supplier", dir: "asc" }).map((r) => r.상품코드);
// 엘제이 has 사과(1) and 배(2); 배 < 사과 in 가나다, so 배 comes first within the supplier
assert.deepEqual(bySupplier, ["3", "2", "1", "5", "4"], "supplier asc, ties by 상품명 가나다, blank supplier last");
assert.deepEqual(
  sortRows(rows.filter((r) => r.협력사명 === "(주)엘제이농산"), { key: "name", dir: "asc" }).map((r) => r.상품명),
  ["배", "사과"],
  "상품명 sorts 가나다",
);
assert.deepEqual(
  sortRows(rows, { key: "ordered", dir: "desc" }).map((r) => r.상품코드),
  ["1", "2", "3", "5", "4"],
  "numeric desc",
);
const equalA = row({ 상품코드: "9", 협력사명: "가나", 발주수량: 7 });
const equalB = row({ 상품코드: "8", 협력사명: "가나", 발주수량: 7 });
assert.deepEqual(
  sortRows([equalA, equalB], { key: "ordered", dir: "asc" }).map((r) => r.상품코드),
  ["8", "9"],
  "equal values fall back to a stable order",
);

/* --------------------------------------------------------------- filters */

assert.equal(applyFilters(rows, EMPTY_FILTERS).length, 5, "empty filters pass everything");
assert.equal(activeFilterCount(EMPTY_FILTERS), 0);

const f = (over: object) => applyFilters(rows, { ...EMPTY_FILTERS, ...over });
assert.deepEqual(f({ suppliers: ["가온프레시", "한결농산"] }).map((r) => r.상품코드), ["3", "5"], "multi-supplier");
assert.deepEqual(f({ suppliers: [""] }).map((r) => r.상품코드), ["4"], "the blank supplier can be selected");
assert.deepEqual(f({ dpts: ["채소"] }).map((r) => r.상품코드), ["5"]);
assert.deepEqual(f({ status: "done" }).map((r) => r.상품코드), ["1", "3", "4"], "검품 완료 = 검품수량>0");
assert.deepEqual(f({ status: "todo" }).map((r) => r.상품코드), ["2", "5"]);
assert.deepEqual(f({ issue: "return" }).map((r) => r.상품코드), ["1"]);
assert.deepEqual(f({ issue: "exchange" }).map((r) => r.상품코드), ["3"]);
assert.deepEqual(f({ issue: "reason" }).map((r) => r.상품코드), ["3", "5"]);
assert.deepEqual(f({ issue: "any" }).map((r) => r.상품코드), ["1", "3", "5"]);
assert.deepEqual(f({ photo: "with" }).map((r) => r.상품코드), ["1"]);
assert.equal(f({ photo: "without" }).length, 4);
assert.deepEqual(f({ query: "  토마 " }).map((r) => r.상품코드), ["5"], "search is trimmed and substring");
assert.deepEqual(f({ query: "엘제이" }).map((r) => r.상품코드), ["1", "2"], "search covers the supplier name");

// filters compose with AND, never OR
assert.deepEqual(f({ status: "todo", issue: "reason" }).map((r) => r.상품코드), ["5"]);
assert.deepEqual(f({ suppliers: ["(주)엘제이농산"], status: "done" }).map((r) => r.상품코드), ["1"]);
assert.equal(f({ suppliers: ["가온프레시"], dpts: ["채소"] }).length, 0, "contradictory filters give an empty set");
assert.equal(activeFilterCount({ ...EMPTY_FILTERS, suppliers: ["a"], status: "done", query: "x" }), 3);

const jobRows = [...rows, row({ 상품코드: "6", 작업기준일또는CSV식별값: "csv_2026-10-21" })];
assert.equal(applyFilters(jobRows, { ...EMPTY_FILTERS, job: "csv_2026-10-21" }).length, 1, "job filter");

/* ---------------------------------------------------------------- facets */

const suppliers = facet(rows, (r) => String(r.협력사명 ?? ""), "(협력사 미지정)");
assert.deepEqual(suppliers.map((s) => s.value), ["가온프레시", "(주)엘제이농산", "한결농산", ""], "facet is 가나다, blank last");
assert.equal(suppliers.find((s) => s.value === "(주)엘제이농산")?.count, 2);
assert.equal(suppliers.at(-1)?.label, "(협력사 미지정)");

console.log("OK  model");
