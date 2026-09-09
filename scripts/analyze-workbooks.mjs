import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const downloads = "C:/Users/Administrator/Downloads";

const files = [
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
].map((name) => path.join(downloads, name));

const outDir = path.join(process.cwd(), "analysis");
fs.mkdirSync(outDir, { recursive: true });

function valueText(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function rowSignature(row) {
  return row.map(valueText).filter(Boolean).join(" | ");
}

function inspectSheet(ws) {
  const ref = ws["!ref"];
  if (!ref) {
    return {
      ref: null,
      rows: 0,
      cols: 0,
      nonEmptyCells: 0,
      merges: ws["!merges"]?.length ?? 0,
      headerCandidates: [],
      preview: [],
      formulaCount: 0,
      formulaSamples: [],
      externalFormulaRefs: [],
    };
  }

  const range = XLSX.utils.decode_range(ref);
  const rows = range.e.r - range.s.r + 1;
  const cols = range.e.c - range.s.c + 1;
  const preview = [];
  const headerCandidates = [];
  const formulaSamples = [];
  const externalFormulaRefs = new Set();
  let formulaCount = 0;
  let nonEmptyCells = 0;

  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row = [];
    let nonEmptyInRow = 0;
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      const text = valueText(cell?.w ?? cell?.v);
      if (text) {
        nonEmptyCells += 1;
        nonEmptyInRow += 1;
      }
      if (r - range.s.r < 25) row.push(text);
      if (cell?.f) {
        formulaCount += 1;
        if (formulaSamples.length < 120) {
          formulaSamples.push({ cell: addr, formula: cell.f, value: text });
        }
        const matches = cell.f.match(/\[[^\]]+\]/g);
        if (matches) matches.forEach((match) => externalFormulaRefs.add(match));
      }
    }
    if (r - range.s.r < 25) preview.push(row);
    if (nonEmptyInRow >= Math.max(2, Math.min(8, Math.floor(cols * 0.25)))) {
      headerCandidates.push({
        rowNumber: r + 1,
        nonEmptyCells: nonEmptyInRow,
        signature: rowSignature(
          Array.from({ length: cols }, (_, i) => {
            const addr = XLSX.utils.encode_cell({ r, c: range.s.c + i });
            const cell = ws[addr];
            return cell?.w ?? cell?.v ?? "";
          }),
        ).slice(0, 500),
      });
    }
  }

  return {
    ref,
    rows,
    cols,
    nonEmptyCells,
    merges: ws["!merges"]?.length ?? 0,
    headerCandidates: headerCandidates.slice(0, 15),
    preview,
    formulaCount,
    formulaSamples,
    externalFormulaRefs: [...externalFormulaRefs],
  };
}

const analysis = files.map((filePath) => {
  const workbook = XLSX.readFile(filePath, {
    cellDates: true,
    cellFormula: true,
    cellNF: true,
    cellStyles: false,
  });

  const sheets = Object.fromEntries(
    workbook.SheetNames.map((name) => [name, inspectSheet(workbook.Sheets[name])]),
  );

  return {
    fileName: path.basename(filePath),
    filePath,
    sheetNames: workbook.SheetNames,
    workbookNames: workbook.Workbook?.Names ?? [],
    sheets,
  };
});

fs.writeFileSync(
  path.join(outDir, "workbook-analysis.json"),
  JSON.stringify(analysis, null, 2),
  "utf8",
);

const md = [];
for (const book of analysis) {
  md.push(`# ${book.fileName}`);
  md.push(`Sheets: ${book.sheetNames.join(", ")}`);
  for (const [sheetName, sheet] of Object.entries(book.sheets)) {
    md.push(`\n## ${sheetName}`);
    md.push(`Range: ${sheet.ref ?? "(empty)"}, rows: ${sheet.rows}, cols: ${sheet.cols}, formulas: ${sheet.formulaCount}`);
    if (sheet.externalFormulaRefs.length) {
      md.push(`External refs: ${sheet.externalFormulaRefs.join(", ")}`);
    }
    if (sheet.headerCandidates.length) {
      md.push("Header candidates:");
      for (const candidate of sheet.headerCandidates.slice(0, 6)) {
        md.push(`- R${candidate.rowNumber}: ${candidate.signature}`);
      }
    }
    if (sheet.formulaSamples.length) {
      md.push("Formula samples:");
      for (const sample of sheet.formulaSamples.slice(0, 12)) {
        md.push(`- ${sample.cell}: =${sample.formula} -> ${sample.value}`);
      }
    }
  }
  md.push("");
}

fs.writeFileSync(path.join(outDir, "workbook-analysis.md"), md.join("\n"), "utf8");

console.log(`Analyzed ${analysis.length} workbooks`);
console.log(path.join(outDir, "workbook-analysis.md"));
