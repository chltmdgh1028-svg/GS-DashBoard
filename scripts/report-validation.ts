import fs from "node:fs/promises";
import path from "node:path";
import { File } from "node:buffer";
import { defaultCampaignConfig } from "../src/config/defaultConfig";
import { parseCampaignFiles } from "../src/parsers/excel";

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

const categoryLabels = {
  actualData: "실제 데이터 오류",
  masterOrganization: "Master/조직 불일치",
  coverage: "Coverage 차이",
  configuration: "Configuration 누락",
  displayAlias: "단순 표기 Alias",
};

const dataset = await parseCampaignFiles(await Promise.all(sourceNames.map(fileFromDisk)), defaultCampaignConfig);
const byCategory = Object.entries(categoryLabels).map(([category, label]) => {
  const rows = dataset.issues.filter((issue) => issue.category === category);
  return {
    category,
    label,
    total: rows.length,
    error: rows.filter((issue) => issue.severity === "error").length,
    warning: rows.filter((issue) => issue.severity === "warning").length,
    info: rows.filter((issue) => issue.severity === "info").length,
    samples: rows.slice(0, 6).map((issue) => `${issue.severity} | ${issue.title} | ${issue.detail}`),
  };
});

console.log(JSON.stringify({
  severity: {
    error: dataset.issues.filter((issue) => issue.severity === "error").length,
    warning: dataset.issues.filter((issue) => issue.severity === "warning").length,
    info: dataset.issues.filter((issue) => issue.severity === "info").length,
  },
  byCategory,
  vkn39: dataset.issues.filter((issue) => issue.entityId === "VKN39"),
  focusUnits: dataset.focusUnits,
  storeTypeConfig: dataset.config.storeTypeAliases,
}, null, 2));
