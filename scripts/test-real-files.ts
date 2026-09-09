import fs from "node:fs/promises";
import path from "node:path";
import { File } from "node:buffer";
import { createRequire } from "node:module";
import { defaultCampaignConfig } from "../src/config/defaultConfig";
import { parseCampaignFiles } from "../src/parsers/excel";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
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

async function fileFromDisk(name: string) {
  const data = await fs.readFile(path.join(downloads, name));
  return new File([data], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function readReferenceBusinessUnits() {
  const workbook = XLSX.readFile(path.join(downloads, "전단행사_9월 1차(최종)_작업용.xlsx"));
  const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets["팀,부문"], { header: 1, defval: "", raw: false });
  return rows.slice(2, 9).map((row) => ({
    label: row[0],
    stores: Number(String(row[1]).replace(/,/g, "")),
    eventSalesThousand: Number(String(row[3]).replace(/,/g, "")),
    days: Number(String(row[14]).replace(/,/g, "")),
  }));
}

const files = await Promise.all(sourceNames.map(fileFromDisk));
const dataset = await parseCampaignFiles(files, defaultCampaignConfig);
const reference = readReferenceBusinessUnits();

const businessUnits = dataset.aggregates.businessUnits.map((row) => ({
  label: row.label,
  stores: row.storeCount,
  eventSalesThousand: Math.round(row.eventSalesTotal / 1000),
  days: row.operatingDays,
}));

console.log(JSON.stringify({
  roles: dataset.fileRoles,
  storeCount: dataset.stores.length,
  productCount: dataset.productCatalog.length,
  focusUnitCount: dataset.focusUnits.length,
  issueCounts: {
    error: dataset.issues.filter((issue) => issue.severity === "error").length,
    warning: dataset.issues.filter((issue) => issue.severity === "warning").length,
    info: dataset.issues.filter((issue) => issue.severity === "info").length,
  },
  national: {
    stores: dataset.aggregates.national.storeCount,
    eventSalesThousand: Math.round(dataset.aggregates.national.eventSalesTotal / 1000),
    days: dataset.aggregates.national.operatingDays,
    dailySalesThousand: Math.round((dataset.aggregates.national.eventDailySales ?? 0) / 100) / 10,
  },
  factCounts: {
    daily: dataset.dailyMetrics.length,
    category: dataset.categoryMetrics.length,
    product: dataset.productMetrics.length,
    focus: dataset.focusMetrics.length,
  },
  businessUnits,
  reference,
}, null, 2));

if (dataset.productCatalog.length !== 59) throw new Error(`Expected 59 campaign products, got ${dataset.productCatalog.length}`);
if (dataset.focusUnits.length !== 6) throw new Error(`Expected 6 focus units, got ${dataset.focusUnits.length}`);
if (!dataset.aggregates.national.storeCount) throw new Error("National aggregate did not calculate stores");
for (const ref of reference) {
  const actual = businessUnits.find((row) => row.label === ref.label);
  if (!actual) throw new Error(`Missing business unit ${ref.label}`);
  if (actual.eventSalesThousand !== ref.eventSalesThousand) {
    throw new Error(`${ref.label} event sales mismatch: expected ${ref.eventSalesThousand}, got ${actual.eventSalesThousand}`);
  }
  if (actual.days !== ref.days) {
    throw new Error(`${ref.label} days mismatch: expected ${ref.days}, got ${actual.days}`);
  }
}
