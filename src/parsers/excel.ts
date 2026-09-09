import * as XLSX from "xlsx";
import { defaultCampaignConfig } from "../config/defaultConfig";
import { aggregateAll, calculateStoreMetrics } from "../aggregations/aggregation";
import type {
  CampaignConfig,
  CampaignDataset,
  CategoryMetric,
  DailyMetric,
  FileRole,
  FocusStoreMetric,
  FocusUnitConfig,
  ProductCatalogItem,
  ProductMetric,
  QualityIssue,
  Store,
} from "../domain/types";

type Row = string[];

interface SimpleMetricRecord {
  value: number;
  rawValue: string;
  sourceCurrentCode: string;
  sourceInitialCode: string;
  sourceStoreName: string;
}

interface LoadedWorkbook {
  fileName: string;
  role: FileRole;
  workbook: XLSX.WorkBook;
}

export interface CampaignInputFile {
  name: string;
  forcedRole?: FileRole;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

const empty = "";

function normalizeCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function cleanType(value: string) {
  return value.replace(/^가맹/, "").trim();
}

function normalizeStoreType(value: string | undefined, config: CampaignConfig) {
  const type = cleanType(value ?? "");
  return config.storeTypeAliases[type] ?? type;
}

function numberValue(value: unknown) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/,/g, "").replace(/[()]/g, "-").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function excelDate(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = text(value);
  if (!s) return "";
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split(/[-/.]/).map(Number);
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 80000) {
    const parsed = XLSX.SSF.parse_date_code(Number(s));
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  return s;
}

function rowsFromSheet(workbook: XLSX.WorkBook, sheetName?: string): Row[] {
  const name = sheetName ?? workbook.SheetNames[0];
  const ws = workbook.Sheets[name];
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, defval: empty, raw: false });
}

function fillForward(row: Row) {
  let last = "";
  return row.map((cell) => {
    const value = text(cell);
    if (value) last = value;
    return value || last;
  });
}

function findRow(rows: Row[], required: string[]) {
  return rows.findIndex((row) => required.every((keyword) => row.some((cell) => text(cell).includes(keyword))));
}

function classifyWorkbook(fileName: string, workbook: XLSX.WorkBook): FileRole {
  const lower = fileName.toLowerCase();
  const allSheetText = workbook.SheetNames.join(" ");
  const firstRows = workbook.SheetNames.flatMap((sheet) => rowsFromSheet(workbook, sheet).slice(0, 8));
  const signature = `${lower} ${allSheetText} ${firstRows.flat().join(" ")}`;

  if (signature.includes("전단행사_") || workbook.SheetNames.includes("원시")) return "reference";
  if (signature.includes("신선강화") && signature.includes("최초코드") && signature.includes("현재코드")) return "storeMaster";
  if (signature.includes("운영형태명") && signature.includes("파트명") && signature.includes("조직도")) return "organizationMaster";
  if (signature.includes("영업일수") && lower.includes("영업일수")) return "operatingDays";
  if (signature.includes("직전") || lower.includes("직전전단")) return "previousDaily";
  if (signature.includes("일자별") && signature.includes("매입원가")) return "currentDaily";
  if (signature.includes("대분류") && signature.includes("매출이익")) return "categoryMetrics";
  if (signature.includes("폐기원가")) return "wasteCost";
  if (signature.includes("입고수량") && signature.includes("판매수량")) return "productMetrics";
  if (signature.includes("중점") || signature.includes("발주수량")) return "focusProducts";
  if (signature.includes("신선매출")) return "freshSales";
  if (signature.includes("목표")) return "target";
  return "unknown";
}

async function loadWorkbook(file: CampaignInputFile): Promise<LoadedWorkbook> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { cellDates: true, cellFormula: true });
  return { fileName: file.name, workbook, role: file.forcedRole ?? classifyWorkbook(file.name, workbook) };
}

function addAlias(store: Store, value: unknown) {
  const code = normalizeCode(value);
  if (code && !store.aliases.includes(code)) store.aliases.push(code);
}

function parseStoreMaster(book: LoadedWorkbook): Store[] {
  const sheetName = book.workbook.SheetNames.find((name) => name.includes("신선강화")) ?? book.workbook.SheetNames[0];
  const rows = rowsFromSheet(book.workbook, sheetName);
  const headerIndex = findRow(rows, ["최초코드", "현재코드", "점포명"]);
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map(text);

  const idx = (name: string) => header.findIndex((cell) => cell.replace(/\s/g, "").includes(name));
  const stores: Store[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const currentCode = normalizeCode(row[idx("현재코드")]);
    const storeName = text(row[idx("점포명")]);
    if (!currentCode || !storeName) continue;
    const store: Store = {
      storeId: currentCode,
      storeName,
      currentCode,
      initialCode: normalizeCode(row[idx("최초코드")]),
      vStoreCode: normalizeCode(row[idx("V+점포코드")]),
      aliases: [],
      businessUnit: text(row[idx("부문")]),
      region: text(row[idx("지역")]),
      team: text(row[idx("영업팀명")]),
      ofc: text(row[idx("OFC명")]),
      storeType: cleanType(text(row[idx("타입")])),
      concept: text(row[idx("컨셉")]),
      conceptType: text(row[idx("컨셉구분")]),
      conceptStartDate: excelDate(row[idx("최초컨셉적용일")]),
    };
    store.masterBusinessUnit = store.businessUnit;
    store.masterRegion = store.region;
    store.masterTeam = store.team;
    store.masterOfc = store.ofc;
    store.masterStoreType = store.storeType;
    addAlias(store, store.currentCode);
    addAlias(store, store.initialCode);
    addAlias(store, store.vStoreCode);
    stores.push(store);
  }
  return stores;
}

function parseOrganization(book: LoadedWorkbook): Store[] {
  const rows = rowsFromSheet(book.workbook, "조직도");
  const headerIndex = findRow(rows, ["부문명", "현재코드", "운영형태명"]);
  if (headerIndex < 0) return [];
  const stores: Store[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const currentCode = normalizeCode(row[8]);
    const storeName = text(row[9]);
    if (!currentCode || !storeName) continue;
    const store: Store = {
      storeId: currentCode,
      storeName,
      currentCode,
      initialCode: normalizeCode(row[7]),
      vStoreCode: currentCode,
      aliases: [],
      businessUnit: text(row[0]),
      region: text(row[1]),
      team: text(row[2]),
      ofc: text(row[5]),
      storeType: cleanType(text(row[12])),
    };
    addAlias(store, store.currentCode);
    addAlias(store, store.initialCode);
    stores.push(store);
  }
  return stores;
}

function rawStore(row: Row) {
  return {
    businessUnit: text(row[0]),
    region: text(row[1]),
    team: text(row[2]),
    ofc: text(row[3]),
    initialCode: normalizeCode(row[4]),
    currentCode: normalizeCode(row[5]),
    storeName: text(row[6]),
  };
}

function buildStoreIndex(stores: Store[], issues: QualityIssue[]) {
  const byAlias = new Map<string, Store>();
  const byName = new Map<string, Store[]>();
  const currentCodes = new Set<string>();

  for (const store of stores) {
    if (currentCodes.has(store.currentCode)) {
      issues.push({ severity: "error", category: "actualData", title: "동일 Current Code 중복", detail: `${store.currentCode}가 Master에 중복되어 있습니다.`, entityId: store.currentCode });
    }
    currentCodes.add(store.currentCode);
    for (const alias of store.aliases) {
      if (byAlias.has(alias) && byAlias.get(alias)?.storeId !== store.storeId) {
        issues.push({ severity: "warning", category: "actualData", title: "Alias 충돌", detail: `${alias}가 여러 점포에 연결됩니다.`, entityId: alias });
      } else {
        byAlias.set(alias, store);
      }
    }
    const list = byName.get(store.storeName) ?? [];
    list.push(store);
    byName.set(store.storeName, list);
  }

  return { byAlias, byName };
}

function resolveStore(
  row: Row,
  stores: Store[],
  index: ReturnType<typeof buildStoreIndex>,
  issues: QualityIssue[],
): Store {
  const source = rawStore(row);
  const aliasMatch = index.byAlias.get(source.currentCode) ?? index.byAlias.get(source.initialCode);
  if (aliasMatch) return aliasMatch;

  const nameMatches = index.byName.get(source.storeName) ?? [];
  if (nameMatches.length === 1) {
    issues.push({ severity: "warning", category: "actualData", title: "점포명 fallback 매칭", detail: `${source.storeName}은 코드로 매칭되지 않아 점포명으로 연결했습니다.`, entityId: source.currentCode });
    return nameMatches[0];
  }
  if (nameMatches.length > 1) {
    issues.push({ severity: "warning", category: "actualData", title: "동명이점 자동 병합 보류", detail: `${source.storeName}은 같은 이름의 점포가 여러 개 있어 자동 병합하지 않았습니다.`, entityId: source.currentCode });
  } else {
    issues.push({ severity: "warning", category: "actualData", title: "Raw에는 있으나 Master에 없음", detail: `${source.currentCode || source.initialCode} ${source.storeName}은 Master에서 찾지 못했습니다.`, entityId: source.currentCode });
  }

  const provisional: Store = {
    storeId: `UNMATCHED:${source.currentCode || source.initialCode || source.storeName}`,
    storeName: source.storeName || "(점포명 없음)",
    currentCode: source.currentCode || source.initialCode,
    initialCode: source.initialCode,
    aliases: [source.currentCode, source.initialCode].filter(Boolean),
    businessUnit: source.businessUnit,
    region: source.region,
    team: source.team,
    ofc: source.ofc,
  };
  stores.push(provisional);
  index.byAlias.set(provisional.currentCode, provisional);
  return provisional;
}

function parseSimpleMetric(book: LoadedWorkbook, metricName: "영업일수" | "폐기원가" | "신선매출", stores: Store[], index: ReturnType<typeof buildStoreIndex>, issues: QualityIssue[]) {
  const rows = rowsFromSheet(book.workbook);
  const headerIndex = findRow(rows, [metricName === "신선매출" ? "매출액" : metricName]);
  const values = new Map<string, SimpleMetricRecord>();
  if (headerIndex < 0) return values;
  for (const row of rows.slice(headerIndex + 1)) {
    const source = rawStore(row);
    if (!source.currentCode && !source.storeName) continue;
    const store = resolveStore(row, stores, index, issues);
    values.set(store.storeId, {
      value: numberValue(row[7]),
      rawValue: text(row[7]),
      sourceCurrentCode: source.currentCode,
      sourceInitialCode: source.initialCode,
      sourceStoreName: source.storeName,
    });
  }
  return values;
}

function parseDaily(book: LoadedWorkbook, periodType: "current" | "previous", stores: Store[], index: ReturnType<typeof buildStoreIndex>, issues: QualityIssue[], config: CampaignConfig): DailyMetric[] {
  const rows = rowsFromSheet(book.workbook);
  const metricRowIndex = findRow(rows, ["메트릭", "매출액"]);
  if (metricRowIndex < 0) return [];
  const metricRow = fillForward(rows[metricRowIndex]);
  const dateRow = rows[metricRowIndex + 1] ?? [];
  const metrics: DailyMetric[] = [];

  for (const row of rows.slice(metricRowIndex + 2)) {
    const source = rawStore(row);
    if (!source.currentCode && !source.storeName) continue;
    const store = resolveStore(row, stores, index, issues);
    const byDate = new Map<string, DailyMetric>();
    for (let c = 7; c < row.length; c += 1) {
      const metricLabel = text(metricRow[c]);
      const date = excelDate(dateRow[c]);
      if (!date || !metricLabel) continue;
      const current = byDate.get(date) ?? {
        campaignId: config.campaignId,
        storeId: store.storeId,
        date,
        dayIndex: byDate.size,
        periodType,
      };
      if (metricLabel.includes("매출액")) current.salesAmount = numberValue(row[c]);
      if (metricLabel.includes("매입원가")) current.purchaseCost = numberValue(row[c]);
      byDate.set(date, current);
    }
    metrics.push(...byDate.values());
  }
  return metrics;
}

function groupForCategory(categoryCode: string, config: CampaignConfig) {
  return config.categoryGroups.find((group) => group.id !== "other" && group.codes.includes(categoryCode))?.id ?? "other";
}

function parseCategoryMetrics(book: LoadedWorkbook, stores: Store[], index: ReturnType<typeof buildStoreIndex>, issues: QualityIssue[], config: CampaignConfig): CategoryMetric[] {
  const rows = rowsFromSheet(book.workbook);
  const metricRowIndex = findRow(rows, ["메트릭", "매출이익"]);
  if (metricRowIndex < 0) return [];
  const metricRow = fillForward(rows[metricRowIndex]);
  const codeRow = fillForward(rows[metricRowIndex + 1] ?? []);
  const nameRow = fillForward(rows[metricRowIndex + 2] ?? []);
  const byStoreCategory = new Map<string, CategoryMetric>();

  for (const row of rows.slice(metricRowIndex + 3)) {
    const source = rawStore(row);
    if (!source.currentCode && !source.storeName) continue;
    const store = resolveStore(row, stores, index, issues);
    for (let c = 7; c < row.length; c += 1) {
      const categoryCode = text(codeRow[c]).padStart(2, "0");
      const categoryName = text(nameRow[c]);
      const metricLabel = text(metricRow[c]);
      if (!categoryCode || !metricLabel) continue;
      const key = `${store.storeId}|${categoryCode}`;
      const current = byStoreCategory.get(key) ?? {
        campaignId: config.campaignId,
        storeId: store.storeId,
        categoryCode,
        categoryName,
        salesAmount: 0,
        grossProfit: 0,
      };
      if (metricLabel.includes("매출액")) current.salesAmount += numberValue(row[c]);
      if (metricLabel.includes("매출이익")) current.grossProfit += numberValue(row[c]);
      byStoreCategory.set(key, current);
    }
  }
  return [...byStoreCategory.values()];
}

function parseProductMetrics(book: LoadedWorkbook, stores: Store[], index: ReturnType<typeof buildStoreIndex>, issues: QualityIssue[], config: CampaignConfig) {
  const rows = rowsFromSheet(book.workbook);
  const metricRowIndex = findRow(rows, ["메트릭", "입고수량", "판매수량"]);
  if (metricRowIndex < 0) return { metrics: [] as ProductMetric[], catalog: [] as ProductCatalogItem[] };
  const metricRow = fillForward(rows[metricRowIndex]);
  const categoryCodeRow = fillForward(rows[metricRowIndex + 1] ?? []);
  const categoryNameRow = fillForward(rows[metricRowIndex + 2] ?? []);
  const productCodeRow = rows[metricRowIndex + 3] ?? [];
  const productNameRow = rows[metricRowIndex + 4] ?? [];
  const catalogMap = new Map<string, ProductCatalogItem>();
  const metrics: ProductMetric[] = [];

  for (const row of rows.slice(metricRowIndex + 5)) {
    const source = rawStore(row);
    if (!source.currentCode && !source.storeName) continue;
    const store = resolveStore(row, stores, index, issues);
    const byProduct = new Map<string, ProductMetric>();
    for (let c = 7; c < row.length; c += 1) {
      const productCode = text(productCodeRow[c]);
      const productName = text(productNameRow[c]);
      const metricLabel = text(metricRow[c]);
      if (!productCode || !productName || !metricLabel) continue;
      const item = catalogMap.get(productCode);
      if (item && item.productName !== productName) {
        issues.push({ severity: "warning", category: "actualData", title: "동일 Product Code의 Product Name 충돌", detail: `${productCode}: ${item.productName} / ${productName}`, entityId: productCode });
      }
      catalogMap.set(productCode, {
        productCode,
        productName,
        categoryCode: text(categoryCodeRow[c]).padStart(2, "0"),
        categoryName: text(categoryNameRow[c]),
      });
      const current = byProduct.get(productCode) ?? {
        campaignId: config.campaignId,
        storeId: store.storeId,
        productCode,
        productName,
        categoryCode: text(categoryCodeRow[c]).padStart(2, "0"),
        categoryName: text(categoryNameRow[c]),
        inboundQty: 0,
        salesQty: 0,
        salesAmount: 0,
      };
      if (metricLabel.includes("입고수량")) current.inboundQty += numberValue(row[c]);
      if (metricLabel.includes("판매수량")) current.salesQty += numberValue(row[c]);
      if (metricLabel.includes("매출액")) current.salesAmount += numberValue(row[c]);
      byProduct.set(productCode, current);
    }
    metrics.push(...byProduct.values());
  }
  return { metrics, catalog: [...catalogMap.values()] };
}

function focusFamilyName(product: ProductCatalogItem) {
  const noOption = product.productName.split("/")[0] ?? product.productName;
  return noOption
    .replace(/\d+(\.\d+)?(G|KG|ML|L|입|팩|봉|구).*/i, "")
    .replace(/(삼겹|목살|청양|갈릭|오리지널|매콤|달콤)/g, "")
    .trim();
}

function inferFocusUnits(products: ProductCatalogItem[], config: CampaignConfig): FocusUnitConfig[] {
  if (config.focusUnits.length) return config.focusUnits;
  const grouped = new Map<string, ProductCatalogItem[]>();
  const result: FocusUnitConfig[] = [];

  for (const product of products) {
    if (!config.focusAutoGroupCategories.includes(product.categoryName)) {
      result.push({
        focusUnitId: product.productCode,
        focusUnitName: product.productName,
        productCodes: [product.productCode],
        categoryCode: product.categoryCode,
        categoryName: product.categoryName,
      });
      continue;
    }
    const key = `${product.categoryName}|${focusFamilyName(product)}`;
    grouped.set(key, [...(grouped.get(key) ?? []), product]);
  }

  for (const [key, group] of grouped.entries()) {
    if (group.length === 1) {
      const product = group[0];
      result.push({
        focusUnitId: product.productCode,
        focusUnitName: product.productName,
        productCodes: [product.productCode],
        categoryCode: product.categoryCode,
        categoryName: product.categoryName,
      });
    } else {
      const [, family] = key.split("|");
      result.push({
        focusUnitId: `focus:${group.map((p) => p.productCode).join("+")}`,
        focusUnitName: family || group.map((p) => p.productName).join(" / "),
        productCodes: group.map((p) => p.productCode),
        categoryCode: group[0].categoryCode,
        categoryName: group[0].categoryName,
      });
    }
  }
  return result;
}

function parseFocusMetrics(book: LoadedWorkbook, stores: Store[], index: ReturnType<typeof buildStoreIndex>, issues: QualityIssue[], config: CampaignConfig) {
  const rows = rowsFromSheet(book.workbook);
  const metricRowIndex = findRow(rows, ["메트릭", "발주수량"]);
  if (metricRowIndex < 0) return { metrics: [] as FocusStoreMetric[], units: [] as FocusUnitConfig[], products: [] as ProductCatalogItem[] };
  const categoryCodeRow = fillForward(rows[metricRowIndex + 1] ?? []);
  const categoryNameRow = fillForward(rows[metricRowIndex + 2] ?? []);
  const productCodeRow = rows[metricRowIndex + 3] ?? [];
  const productNameRow = rows[metricRowIndex + 4] ?? [];
  const products: ProductCatalogItem[] = [];
  const productColumns = new Map<string, number>();

  for (let c = 7; c < productCodeRow.length; c += 1) {
    const productCode = text(productCodeRow[c]);
    if (!productCode) continue;
    products.push({
      productCode,
      productName: text(productNameRow[c]),
      categoryCode: text(categoryCodeRow[c]).padStart(2, "0"),
      categoryName: text(categoryNameRow[c]),
    });
    productColumns.set(productCode, c);
  }

  const units = inferFocusUnits(products, config);
  if (!units.length) {
    issues.push({ severity: "warning", category: "configuration", title: "중점상품 Focus Unit 설정 없음", detail: "중점상품 원시자료에서 Focus Unit을 만들 수 없습니다." });
  } else if (!config.focusUnits.length) {
    issues.push({ severity: "info", category: "configuration", title: "Focus Unit 자동 구성", detail: "중점상품 Focus Unit이 설정되지 않아 상품명 계열 기준으로 자동 구성했습니다. 설정 화면에서 수정할 수 있습니다." });
  }

  const metrics: FocusStoreMetric[] = [];
  for (const row of rows.slice(metricRowIndex + 5)) {
    const source = rawStore(row);
    if (!source.currentCode && !source.storeName) continue;
    const store = resolveStore(row, stores, index, issues);
    for (const unit of units) {
      const orderQty = unit.productCodes.reduce((sum, productCode) => sum + numberValue(row[productColumns.get(productCode) ?? -1]), 0);
      metrics.push({
        campaignId: config.campaignId,
        storeId: store.storeId,
        focusUnitId: unit.focusUnitId,
        focusUnitName: unit.focusUnitName,
        productCodes: unit.productCodes,
        orderQty,
        handled: orderQty > 0,
      });
    }
  }
  return { metrics, units, products };
}

function parseTargetConfig(book: LoadedWorkbook) {
  const targets: Record<string, number> = {};
  for (const sheetName of book.workbook.SheetNames) {
    const rows = rowsFromSheet(book.workbook, sheetName);
    for (const row of rows) {
      const label = row.map(text).find((cell) => /^\d+부문$|^직영$|^특수$/.test(cell));
      if (!label) continue;
      const numericValues = row.map(numberValue).filter((value) => value > 0);
      if (!numericValues.length) continue;
      const target = numericValues[numericValues.length - 1];
      targets[label] = target < 1000 ? target * 1000 : target;
    }
  }
  return targets;
}

function ofcDisplayBase(value: string | undefined) {
  return text(value).replace(/\d+$/, "");
}

function isSafeOfcDisplayAlias(masterOFC: string | undefined, orgOFC: string | undefined, allStores: Store[]) {
  const a = text(masterOFC);
  const b = text(orgOFC);
  if (!a || !b || a === b) return false;
  const base = ofcDisplayBase(a);
  if (!base || base !== ofcDisplayBase(b)) return false;
  if (!/^\D+\d*$/.test(a) || !/^\D+\d*$/.test(b)) return false;
  if (!(/\d$/.test(a) || /\d$/.test(b))) return false;
  const variants = new Set(allStores.map((store) => store.ofc).filter((ofc): ofc is string => ofcDisplayBase(ofc) === base));
  return variants.size <= 2 && variants.has(a) && variants.has(b);
}

function applyStoreTypeAliases(stores: Store[], config: CampaignConfig) {
  for (const store of stores) {
    store.storeType = normalizeStoreType(store.storeType, config);
  }
}

function mergeStores(masterStores: Store[], orgStores: Store[], issues: QualityIssue[], config: CampaignConfig) {
  applyStoreTypeAliases(masterStores, config);
  applyStoreTypeAliases(orgStores, config);
  const stores = [...masterStores];
  const index = buildStoreIndex(stores, issues);
  const allStores = [...masterStores, ...orgStores];

  for (const orgStore of orgStores) {
    const matched = index.byAlias.get(orgStore.currentCode) ?? index.byAlias.get(orgStore.initialCode ?? "");
    if (!matched) continue;
    const conflicts = [
      ["부문", matched.businessUnit, orgStore.businessUnit],
      ["지역", matched.region, orgStore.region],
      ["영업팀", matched.team, orgStore.team],
      ["OFC", matched.ofc, orgStore.ofc],
      ["점포타입", matched.storeType, orgStore.storeType],
    ].filter(([, a, b]) => a && b && a !== b);
    for (const [field, a, b] of conflicts) {
      if (field === "OFC" && isSafeOfcDisplayAlias(a, b, allStores)) {
        issues.push({ severity: "info", category: "displayAlias", title: "OFC 표기 Alias 적용", detail: `${matched.storeName} OFC: Master=${a}, 조직도=${b}`, entityId: matched.currentCode });
        continue;
      }
      issues.push({ severity: "warning", category: "masterOrganization", title: "Master와 조직도 불일치", detail: `${matched.storeName} ${field}: Master=${a}, 조직도=${b}`, entityId: matched.currentCode });
    }
    matched.masterBusinessUnit = matched.businessUnit;
    matched.masterRegion = matched.region;
    matched.masterTeam = matched.team;
    matched.masterOfc = matched.ofc;
    matched.masterStoreType = matched.storeType;
    matched.businessUnit = orgStore.businessUnit;
    matched.region = orgStore.region;
    matched.team = orgStore.team;
    matched.ofc = orgStore.ofc;
    matched.storeType = orgStore.storeType;
  }
  return stores;
}

function validateRequiredRoles(fileRoles: Record<string, FileRole>, issues: QualityIssue[]) {
  const required: FileRole[] = ["storeMaster", "organizationMaster", "operatingDays", "currentDaily", "previousDaily", "categoryMetrics", "wasteCost", "productMetrics", "focusProducts", "freshSales"];
  for (const role of required) {
    if (!Object.values(fileRoles).includes(role)) {
      issues.push({ severity: "error", category: "actualData", title: "필수 파일 누락", detail: `${role} 역할의 파일을 찾지 못했습니다.` });
    }
  }
}

export async function parseCampaignFiles(files: CampaignInputFile[], inputConfig: CampaignConfig = defaultCampaignConfig): Promise<CampaignDataset> {
  const loaded = await Promise.all(files.map(loadWorkbook));
  const fileRoles = Object.fromEntries(loaded.map((book) => [book.fileName, book.role]));
  const issues: QualityIssue[] = [];
  validateRequiredRoles(fileRoles, issues);

  const config = structuredClone(inputConfig);
  const masterStores = loaded.filter((b) => b.role === "storeMaster").flatMap(parseStoreMaster);
  const orgStores = loaded.filter((b) => b.role === "organizationMaster").flatMap(parseOrganization);
  const stores = mergeStores(masterStores, orgStores, issues, config);
  const index = buildStoreIndex(stores, issues);

  const operatingDays = new Map<string, number>();
  const operatingDaySources = new Map<string, SimpleMetricRecord>();
  const wasteCosts = new Map<string, number>();
  const freshSales = new Map<string, number>();
  const dailyMetrics: DailyMetric[] = [];
  const categoryMetrics: CategoryMetric[] = [];
  const productMetrics: ProductMetric[] = [];
  const productCatalog = new Map<string, ProductCatalogItem>();
  let focusUnits: FocusUnitConfig[] = [];
  const focusMetrics: FocusStoreMetric[] = [];

  for (const book of loaded) {
    if (book.role === "operatingDays") parseSimpleMetric(book, "영업일수", stores, index, issues).forEach((v, k) => {
      operatingDays.set(k, v.value);
      operatingDaySources.set(k, v);
    });
    if (book.role === "wasteCost") parseSimpleMetric(book, "폐기원가", stores, index, issues).forEach((v, k) => wasteCosts.set(k, v.value));
    if (book.role === "freshSales") parseSimpleMetric(book, "신선매출", stores, index, issues).forEach((v, k) => freshSales.set(k, v.value));
    if (book.role === "currentDaily") dailyMetrics.push(...parseDaily(book, "current", stores, index, issues, config));
    if (book.role === "previousDaily") dailyMetrics.push(...parseDaily(book, "previous", stores, index, issues, config));
    if (book.role === "categoryMetrics") categoryMetrics.push(...parseCategoryMetrics(book, stores, index, issues, config));
    if (book.role === "productMetrics") {
      const parsed = parseProductMetrics(book, stores, index, issues, config);
      productMetrics.push(...parsed.metrics);
      parsed.catalog.forEach((item) => productCatalog.set(item.productCode, item));
    }
    if (book.role === "focusProducts") {
      const parsed = parseFocusMetrics(book, stores, index, issues, config);
      focusUnits = parsed.units;
      parsed.metrics.forEach((metric) => focusMetrics.push(metric));
      parsed.products.forEach((item) => productCatalog.set(item.productCode, item));
    }
    if (book.role === "target") {
      Object.assign(config.targetByBusinessUnit, parseTargetConfig(book));
    }
  }

  config.focusUnits = focusUnits;

  for (const store of stores) {
    const hasPerformanceFact =
      dailyMetrics.some((metric) => metric.storeId === store.storeId) ||
      categoryMetrics.some((metric) => metric.storeId === store.storeId) ||
      productMetrics.some((metric) => metric.storeId === store.storeId) ||
      focusMetrics.some((metric) => metric.storeId === store.storeId) ||
      freshSales.has(store.storeId);
    if (!hasPerformanceFact) {
      issues.push({
        severity: "warning",
        category: "coverage",
        title: "Master에는 있으나 실적 데이터 없음",
        detail: `${store.currentCode} ${store.storeName} · 신규/기존=${store.conceptType || "-"} · 타입=${store.storeType || "-"} · 확인 필요: 신규점/미영업/행사 비대상 여부`,
        entityId: store.currentCode,
      });
    }
    const daySource = operatingDaySources.get(store.storeId);
    if (daySource && daySource.value === 0) {
      const reason = daySource.rawValue ? `영업일수 파일 원본 값=${daySource.rawValue}` : "영업일수 파일에 점포 행은 매칭됐지만 값이 비어 있습니다.";
      issues.push({
        severity: "error",
        category: "actualData",
        title: "영업일수 0",
        detail: `${store.currentCode} ${store.storeName} · ${reason} · 매칭 소스 현재코드=${daySource.sourceCurrentCode || "-"}, 최초코드=${daySource.sourceInitialCode || "-"}, 점포명=${daySource.sourceStoreName || "-"}`,
        entityId: store.currentCode,
      });
    } else if (!daySource && hasPerformanceFact) {
      issues.push({
        severity: "error",
        category: "actualData",
        title: "영업일수 누락",
        detail: `${store.currentCode} ${store.storeName}은 실적 데이터가 있으나 영업일수 파일에서 Alias/점포명 매칭 행을 찾지 못했습니다.`,
        entityId: store.currentCode,
      });
    }
  }
  if (!Object.keys(config.targetByBusinessUnit).length) {
    issues.push({ severity: "info", category: "configuration", title: "목표 데이터 미등록", detail: "전단행사 목표 파일 또는 목표 Configuration이 없어 목표달성 KPI를 비활성화합니다." });
  }

  const storeMetrics = calculateStoreMetrics({
    config,
    stores,
    operatingDays,
    dailyMetrics,
    categoryMetrics,
    productMetrics,
    focusMetrics,
    wasteCosts,
    freshSales,
    groupForCategory: (code) => groupForCategory(code, config),
    issues,
  });

  return {
    config,
    fileRoles,
    stores,
    dailyMetrics,
    categoryMetrics,
    productMetrics,
    focusMetrics,
    storeMetrics,
    productCatalog: [...productCatalog.values()],
    focusUnits,
    aggregates: aggregateAll(stores, storeMetrics),
    issues,
    createdAt: new Date().toISOString(),
  };
}
