import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const downloads = "C:/Users/Administrator/Downloads";
const required = [
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
  "전단행사_9월 1차(최종)_작업용.xlsx",
];

const targetSheets = new Set(["원시", "파트별", "팀,부문", "수정", "최종", "단품별현황"]);

function text(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function row(ws, rowNumber, startCol = 0, endCol = 30) {
  const values = [];
  for (let c = startCol; c <= endCol; c += 1) {
    const addr = XLSX.utils.encode_cell({ r: rowNumber - 1, c });
    const cell = ws[addr];
    values.push(text(cell?.w ?? cell?.v));
  }
  return values;
}

function formulasIn(ws, max = 80) {
  const ref = ws["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const found = [];
  for (let r = range.s.r; r <= range.e.r && found.length < max; r += 1) {
    for (let c = range.s.c; c <= range.e.c && found.length < max; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell?.f) found.push({ cell: addr, formula: cell.f, value: text(cell.w ?? cell.v) });
    }
  }
  return found;
}

function denseRows(ws, maxRows = 15) {
  const ref = ws["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const candidates = [];
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 80); r += 1) {
    let nonEmpty = 0;
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (text(cell?.w ?? cell?.v)) nonEmpty += 1;
    }
    if (nonEmpty >= 5) {
      candidates.push({ rowNumber: r + 1, nonEmpty, values: row(ws, r + 1, range.s.c, Math.min(range.e.c, range.s.c + 45)) });
    }
  }
  return candidates.slice(0, maxRows);
}

const report = [];
for (const name of required) {
  const filePath = path.join(downloads, name);
  const wb = XLSX.readFile(filePath, { cellDates: true, cellFormula: true });
  const sheets = wb.SheetNames.filter((s) => name.startsWith("전단행사_") ? targetSheets.has(s) : true);
  const entry = { fileName: name, sheets: [] };
  for (const sheetName of sheets) {
    const ws = wb.Sheets[sheetName];
    entry.sheets.push({
      sheetName,
      ref: ws["!ref"] ?? "",
      denseRows: denseRows(ws),
      formulas: formulasIn(ws),
    });
  }
  report.push(entry);
}

fs.writeFileSync(path.join("analysis", "required-sheets-probe.json"), JSON.stringify(report, null, 2), "utf8");

for (const book of report) {
  console.log(`\n# ${book.fileName}`);
  for (const sheet of book.sheets) {
    console.log(`## ${sheet.sheetName} ${sheet.ref}`);
    for (const r of sheet.denseRows.slice(0, 8)) {
      console.log(`R${r.rowNumber}: ${r.values.filter(Boolean).join(" | ").slice(0, 1000)}`);
    }
    if (sheet.formulas.length) {
      console.log("formulas:");
      for (const f of sheet.formulas.slice(0, 12)) console.log(`${f.cell}: =${f.formula} -> ${f.value}`);
    }
  }
}
