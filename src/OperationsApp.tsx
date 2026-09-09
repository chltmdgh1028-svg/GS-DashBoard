import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  History,
  LogOut,
  PackageCheck,
  Search,
  Settings,
  Store as StoreIcon,
  Upload,
  Users,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./App.css";
import { defaultCampaignConfig } from "./config/defaultConfig";
import type { AggregateMetric, AuthenticatedUser, CampaignConfig, CampaignListItem, DashboardDataset, FileRole } from "./domain/types";
import { formatNumber, formatPercent, formatWonThousand, safeDiv } from "./utils/format";

type View = "upload" | "national" | "team" | "ofc" | "store" | "focus" | "quality" | "config" | "history";

const roleLabels: Record<FileRole, string> = {
  storeMaster: "신선강화 점포 Master",
  organizationMaster: "조직 Master",
  operatingDays: "1. 영업일수",
  currentDaily: "2. 일자별매출/매입원가",
  previousDaily: "3. 직전전단매출",
  categoryMetrics: "4. 대분류매출/매출이익",
  wasteCost: "5. 폐기원가",
  productMetrics: "6. 점별 상품실적",
  focusProducts: "7. 중점취급상품",
  freshSales: "8. 신선매출",
  target: "전단행사 목표",
  reference: "기존 작업용 Reference",
  unknown: "미분류",
};

const requiredRoles: FileRole[] = [
  "storeMaster",
  "organizationMaster",
  "operatingDays",
  "currentDaily",
  "previousDaily",
  "categoryMetrics",
  "wasteCost",
  "productMetrics",
  "focusProducts",
  "freshSales",
];

const pasteRoles: FileRole[] = [...requiredRoles, "target"];

const qualityCategoryLabels = {
  actualData: "실제 데이터 오류",
  masterOrganization: "Master/조직 불일치",
  coverage: "Coverage 차이",
  configuration: "Configuration 누락",
  displayAlias: "단순 표기 Alias",
} as const;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...init });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

function cloneConfig(config: CampaignConfig) {
  return structuredClone(config);
}

function metricFor(dataset: DashboardDataset | undefined, storeId: string) {
  return dataset?.storeMetrics.find((metric) => metric.storeId === storeId);
}

function storeById(dataset: DashboardDataset | undefined, storeId: string | undefined) {
  return dataset?.stores.find((store) => store.storeId === storeId);
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function DataTable<T>({
  rows,
  columns,
  onRowClick,
  compact,
}: {
  rows: T[];
  columns: { key: string; header: string; render: (row: T) => React.ReactNode; align?: "left" | "right" }[];
  onRowClick?: (row: T) => void;
  compact?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className={compact ? "compact" : undefined}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.align === "right" ? "right" : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} onClick={() => onRowClick?.(row)} className={onRowClick ? "clickable" : undefined}>
              {columns.map((column) => (
                <td key={column.key} className={column.align === "right" ? "right" : undefined}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LoginView({ onLogin }: { onLogin: (user: AuthenticatedUser) => void }) {
  const [userId, setUserId] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [message, setMessage] = useState("");
  return (
    <div className="login-screen">
      <form
        className="login-panel"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            const result = await api<{ user: AuthenticatedUser }>("/api/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId, password }),
            });
            onLogin(result.user);
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "로그인 실패");
          }
        }}
      >
        <BarChart3 size={38} />
        <h1>전단행사 운영 대시보드</h1>
        <p>본사 ADMIN이 Campaign을 생성하고, OFC는 로그인 후 담당 권역만 조회합니다.</p>
        <label>
          아이디
          <input value={userId} onChange={(event) => setUserId(event.target.value)} />
        </label>
        <label>
          비밀번호
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button className="primary-action button">로그인</button>
        {message && <p className="message error-text">{message}</p>}
      </form>
    </div>
  );
}

function SummaryTable({ rows, onClick }: { rows: AggregateMetric[]; onClick?: (row: AggregateMetric) => void }) {
  return (
    <DataTable
      rows={rows}
      onRowClick={onClick}
      columns={[
        { key: "label", header: "구분", render: (row) => row.label, align: "left" },
        { key: "store", header: "점포수", render: (row) => formatNumber(row.storeCount), align: "right" },
        { key: "purchase", header: "총매입원가", render: (row) => formatWonThousand(row.purchaseCostTotal), align: "right" },
        { key: "sales", header: "행사 총매출", render: (row) => formatWonThousand(row.eventSalesTotal), align: "right" },
        { key: "daily", header: "행사 일매출", render: (row) => formatWonThousand(row.eventDailySales, 1), align: "right" },
        { key: "cold", header: "냉장/냉동/빵 일매출", render: (row) => formatWonThousand(row.coldDailySales, 1), align: "right" },
        { key: "freshEvent", header: "신선 행사 일매출", render: (row) => formatWonThousand(row.freshEventDailySales, 1), align: "right" },
        { key: "other", header: "기타 일매출", render: (row) => formatWonThousand(row.otherDailySales, 1), align: "right" },
        { key: "target", header: "목표 달성점", render: (row) => formatNumber(row.targetAchievedStores), align: "right" },
        { key: "focus", header: "중점 달성점", render: (row) => formatNumber(row.focusAchievedStores), align: "right" },
        { key: "fresh", header: "신선 일매출", render: (row) => formatWonThousand(row.freshDailySales, 1), align: "right" },
        { key: "mix", header: "행사 신선 구성비", render: (row) => formatPercent(row.eventFreshComposition), align: "right" },
        { key: "days", header: "영업일수", render: (row) => formatNumber(row.operatingDays), align: "right" },
      ]}
    />
  );
}

function UploadView({
  dataset,
  config,
  busy,
  message,
  onUpload,
  onPaste,
}: {
  dataset?: DashboardDataset;
  config: CampaignConfig;
  busy: boolean;
  message: string;
  onUpload: (files: FileList | null) => void;
  onPaste: (entries: { role: FileRole; name: string; tsv: string }[]) => void;
}) {
  const [pasteEntries, setPasteEntries] = useState<{ role: FileRole; name: string; tsv: string }[]>([]);
  const [pasteRole, setPasteRole] = useState<FileRole>("storeMaster");
  const [pasteName, setPasteName] = useState("");
  const [pasteTsv, setPasteTsv] = useState("");
  const found = new Set(Object.values(dataset?.fileRoles ?? {}));

  return (
    <section className="view-stack">
      <div className="page-title">
        <div>
          <h1>ADMIN Campaign 생성</h1>
          <p>원시 Excel은 본사 ADMIN만 입력합니다. 서버가 분석/가공 후 중앙 Snapshot으로 저장합니다.</p>
        </div>
        <label className="primary-action">
          <Upload size={18} />
          Excel 업로드
          <input type="file" accept=".xlsx,.xls" multiple onChange={(event) => onUpload(event.target.files)} />
        </label>
      </div>

      <div className="upload-panel">
        <FileSpreadsheet size={42} />
        <strong>{busy ? "서버에서 자료 생성 중" : "Excel 파일 업로드 또는 범위 붙여넣기"}</strong>
        <span>OFC 브라우저에서는 업로드/파싱이 실행되지 않습니다.</span>
      </div>

      <div className="role-grid">
        {[...requiredRoles, "target"].map((role) => (
          <div className={`role-item ${found.has(role as FileRole) ? "ok" : role === "target" ? "optional" : ""}`} key={role}>
            <CheckCircle2 size={17} />
            <span>{roleLabels[role as FileRole]}</span>
            <small>{found.has(role as FileRole) ? "저장됨" : role === "target" ? "선택" : "필수"}</small>
          </div>
        ))}
      </div>

      <div className="two-col">
        <div className="panel">
          <h2>Excel 범위 붙여넣기</h2>
          <div className="form-grid">
            <select value={pasteRole} onChange={(event) => setPasteRole(event.target.value as FileRole)}>
              {pasteRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
            </select>
            <input value={pasteName} onChange={(event) => setPasteName(event.target.value)} placeholder="붙여넣기 이름" />
            <textarea value={pasteTsv} onChange={(event) => setPasteTsv(event.target.value)} placeholder="Excel에서 필요한 범위를 복사한 뒤 여기에 붙여넣기" />
            <button
              className="primary-action button"
              onClick={() => {
                if (!pasteTsv.trim()) return;
                setPasteEntries((prev) => [...prev, { role: pasteRole, name: pasteName || roleLabels[pasteRole], tsv: pasteTsv }]);
                setPasteName("");
                setPasteTsv("");
              }}
            >
              붙여넣기 항목 추가
            </button>
            <button className="primary-action button secondary" onClick={() => onPaste(pasteEntries)} disabled={!pasteEntries.length || busy}>
              붙여넣기 데이터로 Snapshot 생성
            </button>
          </div>
          <p>추가된 항목 {formatNumber(pasteEntries.length)}개 · 현재 설정 {config.campaignName}</p>
        </div>
        <div className="panel">
          <h2>처리 결과</h2>
          {message && <p className="message">{message}</p>}
          {dataset?.fileRoles && (
            <DataTable
              compact
              rows={Object.entries(dataset.fileRoles)}
              columns={[
                { key: "file", header: "입력", render: ([file]) => file, align: "left" },
                { key: "role", header: "역할", render: ([, role]) => roleLabels[role] ?? role },
              ]}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function NationalView({ dataset, goTeam }: { dataset: DashboardDataset; goTeam: (team: string) => void }) {
  return (
    <section className="view-stack">
      <div className="page-title">
        <div>
          <h1>전국 현황</h1>
          <p>{dataset.config.campaignName} · 상품 {formatNumber(dataset.productCatalog.length)}개 · Focus Unit {formatNumber(dataset.focusUnits.length)}개</p>
        </div>
      </div>
      <div className="kpi-grid">
        <KpiCard label="전국 점포 수" value={formatNumber(dataset.aggregates.national.storeCount)} />
        <KpiCard label="행사 총매출" value={formatWonThousand(dataset.aggregates.national.eventSalesTotal)} sub="천원" />
        <KpiCard label="행사 일매출" value={formatWonThousand(dataset.aggregates.national.eventDailySales, 1)} sub="천원 / 영업일" />
        <KpiCard label="중점상품 취급률" value={formatPercent(dataset.aggregates.national.focusHandlingRate)} />
      </div>
      {dataset.aggregates.businessUnits.length > 0 && (
        <div className="panel">
          <h2>부문별 Summary</h2>
          <SummaryTable rows={dataset.aggregates.businessUnits} />
        </div>
      )}
      {dataset.aggregates.teams.length > 0 && (
        <div className="panel">
          <h2>{dataset.permissions.canViewAllStores ? "영업팀별 Summary" : "내 소속팀 Summary"}</h2>
          <SummaryTable rows={dataset.aggregates.teams} onClick={dataset.permissions.canViewAllStores ? (row) => goTeam(row.label) : undefined} />
        </div>
      )}
    </section>
  );
}

function TeamView({ dataset, selectedTeam, onTeamChange, goOfc }: { dataset: DashboardDataset; selectedTeam?: string; onTeamChange: (team: string) => void; goOfc: (team: string, ofc: string) => void }) {
  const teams = dataset.aggregates.teams;
  const summary = teams.find((row) => row.label === selectedTeam) ?? teams[0];
  const ofcs = dataset.aggregates.ofcs.filter((row) => row.team === summary?.label || !dataset.permissions.canViewAllStores);
  return (
    <section className="view-stack">
      <div className="page-title">
        <div>
          <h1>팀별 보기</h1>
          <p>{dataset.permissions.canViewAllStores ? "팀회의용 OFC별 비교 화면입니다." : "로그인된 OFC의 소속팀 Summary입니다."}</p>
        </div>
        {dataset.permissions.canViewAllStores && (
          <select value={summary?.label ?? ""} onChange={(event) => onTeamChange(event.target.value)}>
            {teams.map((row) => <option key={row.key}>{row.label}</option>)}
          </select>
        )}
      </div>
      {summary && (
        <>
          <div className="kpi-grid wide">
            <KpiCard label="점포 수" value={formatNumber(summary.storeCount)} />
            <KpiCard label="OFC 수" value={formatNumber(summary.ofcCount)} />
            <KpiCard label="총매입원가" value={formatWonThousand(summary.purchaseCostTotal)} sub="천원" />
            <KpiCard label="행사 총매출" value={formatWonThousand(summary.eventSalesTotal)} sub="천원" />
            <KpiCard label="행사 일매출" value={formatWonThousand(summary.eventDailySales, 1)} sub="천원" />
            <KpiCard label="신선 행사 일매출" value={formatWonThousand(summary.freshEventDailySales, 1)} sub="천원" />
            <KpiCard label="신선 전체 일매출" value={formatWonThousand(summary.freshDailySales, 1)} sub="천원" />
            <KpiCard label="중점 평균 취급률" value={formatPercent(summary.focusHandlingRate)} />
          </div>
          <div className="panel">
            <h2>{dataset.permissions.canViewAllStores ? "OFC별 비교" : "내 OFC"}</h2>
            <DataTable
              rows={ofcs}
              onRowClick={dataset.permissions.canViewAllStores ? (row) => row.team && goOfc(row.team, row.label) : undefined}
              columns={[
                { key: "ofc", header: "OFC", render: (row) => row.label, align: "left" },
                { key: "stores", header: "담당점포", render: (row) => formatNumber(row.storeCount), align: "right" },
                { key: "sales", header: "행사매출", render: (row) => formatWonThousand(row.eventSalesTotal), align: "right" },
                { key: "daily", header: "행사 일매출", render: (row) => formatWonThousand(row.eventDailySales, 1), align: "right" },
                { key: "focus", header: "중점 취급률", render: (row) => formatPercent(row.focusHandlingRate), align: "right" },
                { key: "fresh", header: "신선 일매출", render: (row) => formatWonThousand(row.freshDailySales, 1), align: "right" },
              ]}
            />
          </div>
        </>
      )}
    </section>
  );
}

function OfcView({ dataset, selectedTeam, selectedOFC, onStore }: { dataset: DashboardDataset; selectedTeam?: string; selectedOFC?: string; onStore: (storeId: string) => void }) {
  const ofcSummary = dataset.aggregates.ofcs.find((row) => row.team === selectedTeam && row.label === selectedOFC) ?? dataset.aggregates.ofcs[0];
  const rows = dataset.stores
    .filter((store) => !ofcSummary || (store.team === ofcSummary.team && store.ofc === ofcSummary.label))
    .map((store) => ({ store, metric: metricFor(dataset, store.storeId) }))
    .filter((row) => row.metric);
  return (
    <section className="view-stack">
      <div className="page-title">
        <div>
          <h1>OFC Dashboard</h1>
          <p>{ofcSummary?.businessUnit} · {ofcSummary?.team} · {ofcSummary?.label} · 담당 {formatNumber(ofcSummary?.storeCount)}점</p>
        </div>
      </div>
      {ofcSummary && (
        <div className="kpi-grid">
          <KpiCard label="행사 총매출" value={formatWonThousand(ofcSummary.eventSalesTotal)} sub="천원" />
          <KpiCard label="행사 일매출" value={formatWonThousand(ofcSummary.eventDailySales, 1)} sub="천원" />
          <KpiCard label="목표 달성점포" value={formatNumber(ofcSummary.targetAchievedStores)} />
          <KpiCard label="중점상품 취급률" value={formatPercent(ofcSummary.focusHandlingRate)} />
        </div>
      )}
      <div className="panel">
        <h2>담당점포</h2>
        <DataTable
          rows={rows}
          onRowClick={(row) => onStore(row.store.storeId)}
          columns={[
            { key: "code", header: "점포코드", render: (row) => row.store.currentCode, align: "left" },
            { key: "name", header: "점포명", render: (row) => row.store.storeName, align: "left" },
            { key: "type", header: "타입", render: (row) => row.store.storeType ?? "-" },
            { key: "days", header: "영업일수", render: (row) => formatNumber(row.metric?.operatingDays), align: "right" },
            { key: "sales", header: "행사 총매출", render: (row) => formatWonThousand(row.metric?.eventSalesTotal), align: "right" },
            { key: "daily", header: "행사 일매출", render: (row) => formatWonThousand(row.metric?.eventDailySales, 1), align: "right" },
            { key: "target", header: "목표 달성률", render: (row) => formatPercent(row.metric?.targetAchievementRate), align: "right" },
            { key: "focus", header: "중점 취급률", render: (row) => formatPercent(row.metric?.focusHandlingRate), align: "right" },
            { key: "fresh", header: "신선 일매출", render: (row) => formatWonThousand(row.metric?.freshDailySales, 1), align: "right" },
            { key: "mix", header: "행사 신선 구성비", render: (row) => formatPercent(row.metric?.eventFreshComposition), align: "right" },
          ]}
        />
      </div>
    </section>
  );
}

function StoreView({ dataset, selectedStoreId }: { dataset: DashboardDataset; selectedStoreId?: string }) {
  const store = storeById(dataset, selectedStoreId ?? dataset.stores[0]?.storeId);
  const metric = store ? metricFor(dataset, store.storeId) : undefined;
  const chartData = useMemo(() => {
    if (!store) return [];
    return (dataset.dailySeriesByStore[store.storeId] ?? []).map((row) => ({
      day: row.day,
      현재: row.currentSales == null ? undefined : Math.round(row.currentSales / 1000),
      직전: row.previousSales == null ? undefined : Math.round(row.previousSales / 1000),
      매입원가: row.purchaseCost == null ? undefined : Math.round(row.purchaseCost / 1000),
    }));
  }, [dataset, store]);

  if (!store || !metric) return <EmptyState />;

  return (
    <section className="view-stack">
      <div className="page-title">
        <div>
          <h1>점포 Coaching</h1>
          <p>{store.storeName} · {store.currentCode} · {store.businessUnit} · {store.team} · {store.ofc}</p>
        </div>
      </div>
      <div className="kpi-grid wide">
        <KpiCard label="영업일수" value={formatNumber(metric.operatingDays)} />
        <KpiCard label="행사 총매출" value={formatWonThousand(metric.eventSalesTotal)} sub="천원" />
        <KpiCard label="행사 일매출" value={formatWonThousand(metric.eventDailySales, 1)} sub="천원" />
        <KpiCard label="신선 일매출" value={formatWonThousand(metric.freshDailySales, 1)} sub="천원" />
        <KpiCard label="신선 구성비" value={formatPercent(metric.eventFreshComposition)} />
        <KpiCard label="중점 취급률" value={formatPercent(metric.focusHandlingRate)} />
        <KpiCard label="전체 취급률" value={formatPercent(metric.productHandlingRate.all)} />
        <KpiCard label="손익 기준" value={metric.profitShare == null ? "미등록" : formatPercent(metric.profitShare, 0)} />
      </div>
      <div className="panel chart-panel">
        <h2>일자별 전단 매출 추이</h2>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" />
            <YAxis />
            <Tooltip formatter={(value) => `${formatNumber(Number(value))}천원`} />
            <Legend />
            <Line type="monotone" dataKey="직전" stroke="#64748b" strokeWidth={2} connectNulls />
            <Line type="monotone" dataKey="현재" stroke="#0f5ea8" strokeWidth={2.5} connectNulls />
            <Line type="monotone" dataKey="매입원가" stroke="#0f9f8f" strokeWidth={2} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="two-col">
        <div className="panel">
          <h2>매출현황</h2>
          <DataTable
            compact
            rows={[
              ["전체", metric.eventSalesTotal, metric.eventDailySales, metric.categoryProfitRate.all],
              ["냉장/냉동/빵", metric.categorySales.cold, metric.categoryDailySales.cold, metric.categoryProfitRate.cold],
              ["신선", metric.categorySales.fresh, metric.categoryDailySales.fresh, metric.categoryProfitRate.fresh],
              ["기타", metric.categorySales.other, metric.categoryDailySales.other, metric.categoryProfitRate.other],
            ]}
            columns={[
              { key: "name", header: "구분", render: (row) => row[0], align: "left" },
              { key: "total", header: "총매출", render: (row) => formatWonThousand(row[1] as number), align: "right" },
              { key: "daily", header: "일매출", render: (row) => formatWonThousand(row[2] as number, 1), align: "right" },
              { key: "profit", header: "매익률", render: (row) => formatPercent(row[3] as number | undefined), align: "right" },
            ]}
          />
        </div>
        <div className="panel">
          <h2>단품별 실적 TOP {dataset.config.topN}</h2>
          <DataTable
            compact
            rows={metric.topProducts.map((product, index) => ({ ...product, rank: index + 1 }))}
            columns={[
              { key: "rank", header: "순위", render: (row) => row.rank, align: "right" },
              { key: "name", header: "상품명", render: (row) => row.productName, align: "left" },
              { key: "in", header: "입고", render: (row) => formatNumber(row.inboundQty), align: "right" },
              { key: "salesQty", header: "판매", render: (row) => formatNumber(row.salesQty), align: "right" },
              { key: "rate", header: "판매율", render: (row) => formatPercent(safeDiv(row.salesQty, row.inboundQty)), align: "right" },
              { key: "sales", header: "매출액", render: (row) => formatWonThousand(row.salesAmount), align: "right" },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function FocusView({ dataset }: { dataset: DashboardDataset }) {
  const [query, setQuery] = useState("");
  const rows = dataset.focusSummaries.filter((unit) => `${unit.focusUnitName} ${unit.productCodes.join(" ")}`.includes(query));
  return (
    <section className="view-stack">
      <div className="page-title">
        <div>
          <h1>중점상품</h1>
          <p>서버가 권한 범위에 맞춰 계산한 Focus Unit 취급률입니다.</p>
        </div>
        <div className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품 또는 코드 검색" />
        </div>
      </div>
      <div className="panel">
        <h2>Focus Unit 현황</h2>
        <DataTable
          rows={rows}
          columns={[
            { key: "name", header: "상품/그룹", render: (row) => row.focusUnitName, align: "left" },
            { key: "category", header: "카테고리", render: (row) => row.categoryName ?? "-" },
            { key: "sku", header: "포함 SKU", render: (row) => row.productCodes.join(", "), align: "left" },
            { key: "national", header: "전국 취급률", render: (row) => formatPercent(row.nationalRate), align: "right" },
            { key: "team", header: "소속팀 취급률", render: (row) => formatPercent(row.teamRate), align: "right" },
            { key: "ofc", header: "내 OFC 취급률", render: (row) => formatPercent(row.ofcRate), align: "right" },
          ]}
        />
      </div>
    </section>
  );
}

function QualityView({ dataset }: { dataset: DashboardDataset }) {
  const issues = dataset.issues ?? [];
  const categoryRows = Object.entries(qualityCategoryLabels).map(([category, label]) => ({
    category,
    label,
    count: issues.filter((issue) => issue.category === category).length,
    warnings: issues.filter((issue) => issue.category === category && issue.severity === "warning").length,
    errors: issues.filter((issue) => issue.category === category && issue.severity === "error").length,
    infos: issues.filter((issue) => issue.category === category && issue.severity === "info").length,
  }));
  return (
    <section className="view-stack">
      <div className="page-title">
        <div>
          <h1>데이터 검증</h1>
          <p>검증 리포트는 ADMIN 전용입니다.</p>
        </div>
      </div>
      <div className="kpi-grid">
        <KpiCard label="Error" value={formatNumber(issues.filter((issue) => issue.severity === "error").length)} />
        <KpiCard label="Warning" value={formatNumber(issues.filter((issue) => issue.severity === "warning").length)} />
        <KpiCard label="Info" value={formatNumber(issues.filter((issue) => issue.severity === "info").length)} />
        <KpiCard label="파일 수" value={formatNumber(Object.keys(dataset.fileRoles ?? {}).length)} />
      </div>
      <div className="panel">
        <h2>분류별 요약</h2>
        <DataTable
          compact
          rows={categoryRows}
          columns={[
            { key: "label", header: "분류", render: (row) => row.label, align: "left" },
            { key: "count", header: "전체", render: (row) => formatNumber(row.count), align: "right" },
            { key: "error", header: "Error", render: (row) => formatNumber(row.errors), align: "right" },
            { key: "warning", header: "Warning", render: (row) => formatNumber(row.warnings), align: "right" },
            { key: "info", header: "Info", render: (row) => formatNumber(row.infos), align: "right" },
          ]}
        />
      </div>
      <div className="panel">
        <h2>검증 리포트</h2>
        <DataTable
          rows={issues}
          columns={[
            { key: "severity", header: "등급", render: (row) => <span className={`pill ${row.severity}`}>{row.severity}</span> },
            { key: "category", header: "분류", render: (row) => qualityCategoryLabels[row.category], align: "left" },
            { key: "title", header: "항목", render: (row) => row.title, align: "left" },
            { key: "detail", header: "내용", render: (row) => row.detail, align: "left" },
            { key: "id", header: "ID", render: (row) => row.entityId ?? "-", align: "left" },
          ]}
        />
      </div>
    </section>
  );
}

function ConfigView({ config, setConfig }: { config: CampaignConfig; setConfig: (config: CampaignConfig) => void }) {
  const [json, setJson] = useState(JSON.stringify(config, null, 2));
  const [message, setMessage] = useState("");
  useEffect(() => setJson(JSON.stringify(config, null, 2)), [config]);
  return (
    <section className="view-stack">
      <div className="page-title">
        <div>
          <h1>Campaign Configuration</h1>
          <p>ADMIN이 Snapshot 생성 전에 적용할 계산 기준입니다.</p>
        </div>
        <button
          className="primary-action button"
          onClick={() => {
            try {
              setConfig(JSON.parse(json) as CampaignConfig);
              setMessage("설정을 반영했습니다. 다음 업로드/붙여넣기 Snapshot부터 적용됩니다.");
            } catch {
              setMessage("JSON 형식을 확인하세요.");
            }
          }}
        >
          <Settings size={18} />
          설정 반영
        </button>
      </div>
      <div className="panel config-layout">
        <h2>설정 JSON</h2>
        <textarea value={json} onChange={(event) => setJson(event.target.value)} />
        {message && <p className="message">{message}</p>}
      </div>
    </section>
  );
}

function HistoryView({ campaigns, openCampaign }: { campaigns: CampaignListItem[]; openCampaign: (id: string) => void }) {
  return (
    <section className="view-stack">
      <div className="page-title">
        <div>
          <h1>Campaign 관리</h1>
          <p>ADMIN이 생성한 Snapshot 이력입니다. 새 Snapshot은 기존 Campaign을 덮어쓰지 않습니다.</p>
        </div>
      </div>
      <div className="panel">
        <h2>저장된 Campaign Snapshot</h2>
        <DataTable
          rows={campaigns}
          onRowClick={(row) => openCampaign(row.id)}
          columns={[
            { key: "name", header: "행사명", render: (row) => row.campaignName, align: "left" },
            { key: "date", header: "생성일", render: (row) => new Date(row.createdAt).toLocaleString("ko-KR") },
            { key: "stores", header: "점포", render: (row) => formatNumber(row.storeCount), align: "right" },
            { key: "products", header: "상품", render: (row) => formatNumber(row.productCount), align: "right" },
            { key: "issues", header: "검증 이슈", render: (row) => formatNumber(row.issueCount), align: "right" },
          ]}
        />
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="empty-state">
      <Database size={42} />
      <strong>저장된 Campaign이 없습니다</strong>
      <span>본사 ADMIN이 원시 Excel을 업로드하면 OFC 사용자가 조회할 수 있습니다.</span>
    </section>
  );
}

export default function OperationsApp() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [view, setView] = useState<View>("national");
  const [config, setConfig] = useState<CampaignConfig>(() => cloneConfig(defaultCampaignConfig));
  const [dataset, setDataset] = useState<DashboardDataset>();
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedTeam, setSelectedTeam] = useState<string>();
  const [selectedOFC, setSelectedOFC] = useState<string>();
  const [selectedStoreId, setSelectedStoreId] = useState<string>();

  async function loadDashboard() {
    const result = await api<{ dataset: DashboardDataset | null }>("/api/dashboard/latest");
    if (result.dataset) {
      setDataset(result.dataset);
      setSelectedTeam(result.dataset.aggregates.teams[0]?.label);
      setSelectedOFC(result.dataset.aggregates.ofcs[0]?.label);
      setSelectedStoreId(result.dataset.stores[0]?.storeId);
    }
    const list = await api<{ campaigns: CampaignListItem[] }>("/api/campaigns");
    setCampaigns(list.campaigns);
  }

  async function loadCampaign(id: string) {
    const result = await api<{ dataset: DashboardDataset }>(`/api/dashboard/${id}`);
    setDataset(result.dataset);
    setSelectedTeam(result.dataset.aggregates.teams[0]?.label);
    setSelectedOFC(result.dataset.aggregates.ofcs[0]?.label);
    setSelectedStoreId(result.dataset.stores[0]?.storeId);
    setView("national");
  }

  useEffect(() => {
    api<{ user: AuthenticatedUser | null }>("/api/session")
      .then((result) => {
        setUser(result.user);
        if (result.user) void loadDashboard();
      })
      .catch(() => undefined);
  }, []);

  async function handleLogin(nextUser: AuthenticatedUser) {
    setUser(nextUser);
    setView(nextUser.role === "admin" ? "national" : "ofc");
    await loadDashboard();
  }

  async function handleUpload(fileList: FileList | null) {
    if (!fileList?.length) return;
    setBusy(true);
    setMessage("");
    try {
      const formData = new FormData();
      [...fileList].forEach((file) => formData.append("files", file));
      formData.append("config", JSON.stringify(config));
      const result = await api<{ dataset: DashboardDataset; generatedAccounts: unknown[]; accountCount: number }>("/api/admin/campaigns/upload", {
        method: "POST",
        body: formData,
      });
      setDataset(result.dataset);
      if (result.dataset.adminConfig) setConfig(result.dataset.adminConfig);
      setMessage(`Snapshot 저장 완료 · 신규 OFC 계정 ${formatNumber(result.generatedAccounts.length)}개 · 총 계정 ${formatNumber(result.accountCount)}개`);
      await loadDashboard();
      setView(result.dataset.issues?.some((issue) => issue.severity === "error") ? "quality" : "national");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "업로드 실패");
    } finally {
      setBusy(false);
    }
  }

  async function handlePaste(entries: { role: FileRole; name: string; tsv: string }[]) {
    setBusy(true);
    setMessage("");
    try {
      const result = await api<{ dataset: DashboardDataset; generatedAccounts: unknown[]; accountCount: number }>("/api/admin/campaigns/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries, config }),
      });
      setDataset(result.dataset);
      if (result.dataset.adminConfig) setConfig(result.dataset.adminConfig);
      setMessage(`붙여넣기 Snapshot 저장 완료 · 신규 OFC 계정 ${formatNumber(result.generatedAccounts.length)}개 · 총 계정 ${formatNumber(result.accountCount)}개`);
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "붙여넣기 처리 실패");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api("/api/logout", { method: "POST" });
    setUser(null);
    setDataset(undefined);
  }

  if (!user) return <LoginView onLogin={handleLogin} />;
  const isAdmin = user.role === "admin";

  const adminNav = [
    ["national", "전국 현황", BarChart3],
    ["team", "팀별 보기", Users],
    ["ofc", "OFC 보기", Users],
    ["store", "점포 상세", StoreIcon],
    ["focus", "중점상품", PackageCheck],
    ["upload", "데이터 입력", Upload],
    ["quality", "데이터 검증", AlertTriangle],
    ["config", "Campaign 설정", Settings],
    ["history", "Campaign 관리", History],
  ] as const;
  const ofcNav = [
    ["ofc", "내 OFC", Users],
    ["store", "내 점포", StoreIcon],
    ["team", "소속팀 Summary", Users],
    ["national", "전국 Summary", BarChart3],
    ["focus", "중점상품", PackageCheck],
  ] as const;
  const nav = isAdmin ? adminNav : ofcNav;

  return (
    <div className="app-shell">
      <aside>
        <div className="brand">
          <BarChart3 />
          <strong>전단행사 대시보드</strong>
        </div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <span>{isAdmin ? "ADMIN" : "OFC"}</span>
          <strong>{user.displayName}</strong>
          {dataset && <small>{dataset.config.campaignName}</small>}
          <button className="sidebar-logout" onClick={logout}>
            <LogOut size={15} />
            로그아웃
          </button>
        </div>
      </aside>

      <main>
        {view === "upload" && isAdmin && <UploadView dataset={dataset} config={config} busy={busy} message={message} onUpload={handleUpload} onPaste={handlePaste} />}
        {!dataset && view !== "upload" && view !== "config" && <EmptyState />}
        {dataset && view === "national" && <NationalView dataset={dataset} goTeam={(team) => { setSelectedTeam(team); setView("team"); }} />}
        {dataset && view === "team" && <TeamView dataset={dataset} selectedTeam={selectedTeam} onTeamChange={setSelectedTeam} goOfc={(team, ofc) => { setSelectedTeam(team); setSelectedOFC(ofc); setView("ofc"); }} />}
        {dataset && view === "ofc" && <OfcView dataset={dataset} selectedTeam={selectedTeam} selectedOFC={selectedOFC} onStore={(storeId) => { setSelectedStoreId(storeId); setView("store"); }} />}
        {dataset && view === "store" && <StoreView dataset={dataset} selectedStoreId={selectedStoreId} />}
        {dataset && view === "focus" && <FocusView dataset={dataset} />}
        {dataset && view === "quality" && isAdmin && <QualityView dataset={dataset} />}
        {view === "config" && isAdmin && <ConfigView config={config} setConfig={setConfig} />}
        {view === "history" && isAdmin && <HistoryView campaigns={campaigns} openCampaign={loadCampaign} />}
      </main>
    </div>
  );
}
