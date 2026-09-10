import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CampaignListItem, DashboardDataset } from "../domain/types";
import {
  Badge,
  DataTable,
  DefinitionList,
  Delta,
  EmptyState,
  KpiCard,
  KpiRow,
  MeterCell,
  Notice,
  PageHeader,
  SectionCard,
  Select,
  StatusBadge,
  TextCell,
} from "../ui";
import { IconFocus, IconInfo, IconStore } from "../ui/icons";
import { formatNumber, formatPercent, formatSignedPercent, formatWonThousand, safeDiv } from "../view-models/format";
import type { ScopeLevel } from "../view-models/dashboard";
import { buildStoreRows, categoryRowsFor, storeScopeLabel } from "../view-models/dashboard";
import { CampaignMeta, ScopeBar, moneyHeader } from "./shared";

interface TooltipPayloadItem {
  name?: string;
  value?: number;
  color?: string;
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="t-title">{label}</div>
      {payload.map((item) => (
        <div className="t-row" key={item.name}>
          <span style={{ color: item.color }}>{item.name}</span>
          <span>{formatNumber(item.value)}천원</span>
        </div>
      ))}
    </div>
  );
}

export function StoreView({
  dataset,
  campaign,
  selectedStoreId,
  onSelectStore,
  onNavigate,
}: {
  dataset: DashboardDataset;
  campaign?: CampaignListItem;
  selectedStoreId?: string;
  onSelectStore: (storeId: string) => void;
  onNavigate: (level: ScopeLevel, value?: string) => void;
}) {
  const rows = useMemo(() => buildStoreRows(dataset), [dataset]);
  const row = rows.find((item) => item.store.storeId === selectedStoreId) ?? rows[0];

  const siblings = useMemo(
    () => (row ? rows.filter((item) => item.store.ofc === row.store.ofc && item.store.team === row.store.team) : []),
    [rows, row],
  );

  const chartData = useMemo(() => {
    if (!row) return [];
    return (dataset.dailySeriesByStore[row.store.storeId] ?? []).map((point) => ({
      day: point.day,
      현재전단: point.currentSales == null ? undefined : Math.round(point.currentSales / 1000),
      직전전단: point.previousSales == null ? undefined : Math.round(point.previousSales / 1000),
      매입원가: point.purchaseCost == null ? undefined : Math.round(point.purchaseCost / 1000),
    }));
  }, [dataset, row]);

  const ofcAggregate = dataset.aggregates.ofcs.find(
    (item) => item.label === row?.store.ofc && (!item.team || item.team === row?.store.team),
  );
  // The aggregate's eventDailySales is already 총매출 ÷ 영업일수, i.e. the same
  // shape as a store's daily sales - so it compares directly, no extra division.
  const ofcAverageDaily = ofcAggregate?.eventDailySales;
  const vsOfcAverage =
    ofcAverageDaily && row?.metric.eventDailySales != null
      ? row.metric.eventDailySales / ofcAverageDaily - 1
      : undefined;

  if (!row) {
    return (
      <div className="page">
        <PageHeader icon={<IconStore size={20} aria-hidden />} title="점포 현황" />
        <SectionCard>
          <EmptyState title="조회할 점포가 없습니다" description="Campaign이 반영되면 담당 점포 상세를 볼 수 있습니다." inline />
        </SectionCard>
      </div>
    );
  }

  const { store, metric } = row;
  const categoryRows = categoryRowsFor(metric);

  return (
    <div className="page">
      <PageHeader
        icon={<IconStore size={20} aria-hidden />}
        title={store.storeName}
        description="점주 코칭용 상세 화면입니다. 기본정보 → 실적 → 직전 비교 → 상품 순으로 확인하세요."
        meta={
          <>
            <CampaignMeta dataset={dataset} campaign={campaign} />
            <span className="meta-item">
              소속
              <b>{storeScopeLabel(store)}</b>
            </span>
            <span className="meta-item">
              상태
              <StatusBadge status={row.status} title={row.reasons.join(" · ")} />
            </span>
          </>
        }
        actions={
          <>
            <ScopeBar
              level="store"
              businessUnit={store.businessUnit}
              team={store.team}
              ofc={store.ofc}
              store={store.storeName}
              showBusinessUnit={dataset.aggregates.businessUnits.length > 0}
              onNavigate={onNavigate}
            />
            {siblings.length > 1 && (
            <label className="row" data-nowrap="true">
              <span className="muted">점포</span>
              <Select
                value={store.storeId}
                onChange={(event) => onSelectStore(event.target.value)}
                style={{ width: 210 }}
              >
                {siblings.map((item) => (
                  <option key={item.store.storeId} value={item.store.storeId}>
                    {item.store.storeName}
                  </option>
                ))}
              </Select>
            </label>
            )}
          </>
        }
      />

      {row.reasons.length > 0 && (
        <Notice
          tone={row.status === "action" ? "warning" : "info"}
          icon={<IconInfo size={15} aria-hidden />}
          title="코칭 포인트"
        >
          <span>
            {row.reasons.join(" · ")}
            {vsOfcAverage != null && ` · OFC 평균 일매출 대비 ${formatSignedPercent(vsOfcAverage)}`}
          </span>
        </Notice>
      )}

      {/* 1. 기본정보 + 2. 핵심 KPI */}
      <div className="grid-2" data-ratio="wide-right">
        <SectionCard title="점포 기본정보">
          <DefinitionList
            items={[
              { term: "점포코드", value: <span className="mono">{store.currentCode}</span> },
              { term: "최초코드", value: <span className="mono">{store.initialCode ?? "-"}</span> },
              { term: "부문 / 팀", value: `${store.businessUnit ?? "-"} · ${store.team ?? "-"}` },
              { term: "담당 OFC", value: store.ofc ?? "-" },
              { term: "점포타입", value: store.storeType ?? "-" },
              { term: "컨셉", value: [store.concept, store.conceptType].filter(Boolean).join(" · ") || "-" },
              { term: "영업일수", value: `${formatNumber(metric.operatingDays)}일` },
              {
                term: "손익 배분율",
                value:
                  metric.profitShare == null ? (
                    <Badge tone="warning" size="sm">
                      미등록
                    </Badge>
                  ) : (
                    formatPercent(metric.profitShare, 0)
                  ),
              },
            ]}
          />
        </SectionCard>

        <div className="stack">
          <KpiRow cols={4}>
            <KpiCard label="행사 총매출" value={formatWonThousand(metric.eventSalesTotal)} unit="천원" emphasis />
            <KpiCard
              label="행사 일매출"
              value={formatWonThousand(metric.eventDailySales, 1)}
              unit="천원"
              emphasis
              delta={vsOfcAverage}
              deltaLabel="OFC 평균 일매출 대비"
              note="OFC 평균 대비"
            />
            <KpiCard
              label="직전전단 대비"
              value={formatSignedPercent(row.previousDelta)}
              valueChange={row.previousDelta}
              note={metric.previousSalesTotal ? `직전 ${formatWonThousand(metric.previousSalesTotal)}천원` : "직전 자료 없음"}
            />
            <KpiCard label="신선 일매출" value={formatWonThousand(metric.freshDailySales, 1)} unit="천원" />
            <KpiCard label="행사 신선 구성비" value={formatPercent(metric.eventFreshComposition)} />
            <KpiCard
              label="중점상품 취급률"
              value={formatPercent(metric.focusHandlingRate)}
              note={`${formatNumber(metric.focusHandledUnits)} / ${formatNumber(metric.focusTotalUnits)} 취급`}
            />
            <KpiCard label="전체 상품 취급률" value={formatPercent(metric.productHandlingRate.all)} />
            <KpiCard
              label="폐기원가"
              value={formatWonThousand(metric.wasteCost)}
              unit="천원"
              hint="폐기원가 자료 기준 금액입니다."
            />
          </KpiRow>
        </div>
      </div>

      {/* 3. 현재전단 vs 직전전단 + 4. 일자별 추이 */}
      <SectionCard
        title="현재전단 vs 직전전단"
        subtitle="단위: 천원"
        actions={
          <div className="chart-legend">
            <span>
              <i style={{ background: "var(--series-current)" }} />
              현재전단
            </span>
            <span>
              <i style={{ background: "var(--series-previous)" }} />
              직전전단
            </span>
            <span>
              <i style={{ background: "var(--series-cost)" }} />
              매입원가
            </span>
          </div>
        }
      >
        <div className="grid-2" data-ratio="wide-right">
          <DataTable
            rows={[
              {
                key: "total",
                label: "총매출",
                current: metric.eventSalesTotal,
                previous: metric.previousSalesTotal,
              },
              {
                key: "daily",
                label: "일매출",
                current: metric.eventDailySales,
                previous: safeDiv(metric.previousSalesTotal, metric.operatingDays),
              },
              {
                key: "cost",
                label: "매입원가",
                current: metric.purchaseCostTotal,
                previous: undefined,
              },
            ]}
            rowKey={(item) => item.key}
            density="compact"
            autoHeight
            columns={[
              { key: "label", header: "구분", align: "left", render: (item) => item.label },
              {
                key: "current",
                header: moneyHeader("현재전단"),
                align: "right",
                render: (item) => formatWonThousand(item.current, item.key === "daily" ? 1 : 0),
              },
              {
                key: "previous",
                header: moneyHeader("직전전단"),
                align: "right",
                render: (item) =>
                  item.previous == null ? (
                    <span className="muted">-</span>
                  ) : (
                    formatWonThousand(item.previous, item.key === "daily" ? 1 : 0)
                  ),
              },
              {
                key: "delta",
                header: "증감",
                align: "right",
                render: (item) =>
                  item.previous == null || item.current == null || item.previous === 0 ? (
                    <span className="muted">-</span>
                  ) : (
                    <Delta value={item.current / item.previous - 1} />
                  ),
              },
            ]}
          />
          <div className="chart-wrap">
            {chartData.length === 0 ? (
              <EmptyState title="일자별 자료가 없습니다" inline />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke="var(--series-grid)" vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                  <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(value) => formatNumber(Number(value))} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="직전전단" stroke="var(--series-previous)" strokeWidth={1.6} dot={false} connectNulls />
                  <Line type="monotone" dataKey="현재전단" stroke="var(--series-current)" strokeWidth={2.2} dot={false} connectNulls />
                  <Line
                    type="monotone"
                    dataKey="매입원가"
                    stroke="var(--series-cost)"
                    strokeWidth={1.4}
                    strokeDasharray="4 3"
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </SectionCard>

      {/* 5. 카테고리 실적 + 6. 중점상품 */}
      <div className="grid-2">
        <SectionCard title="카테고리 실적" subtitle="매출 · 매익률 · 취급률" flush>
          <DataTable
            rows={categoryRows}
            rowKey={(item) => item.id}
            density="compact"
            autoHeight
            columns={[
              { key: "label", header: "구분", align: "left", render: (item) => item.label },
              {
                key: "sales",
                header: moneyHeader("총매출"),
                align: "right",
                render: (item) => formatWonThousand(item.sales),
              },
              {
                key: "daily",
                header: moneyHeader("일매출"),
                align: "right",
                render: (item) => formatWonThousand(item.daily, 1),
              },
              { key: "profit", header: "매익률", align: "right", render: (item) => formatPercent(item.profitRate) },
              {
                key: "handling",
                header: "취급률",
                align: "right",
                width: 130,
                render: (item) => <MeterCell value={item.handlingRate} />,
              },
            ]}
            caption="카테고리별 매출과 취급률"
          />
        </SectionCard>

        <SectionCard
          title="중점상품"
          icon={<IconFocus size={15} aria-hidden />}
          subtitle={`${formatNumber(metric.focusHandledUnits)} / ${formatNumber(metric.focusTotalUnits)} 취급`}
          flush
          footer="점포별 SKU 단위 취급 여부는 현재 대시보드 응답에 포함되지 않아 Focus Unit 단위로 표시합니다."
        >
          <DataTable
            rows={dataset.focusSummaries}
            rowKey={(item) => item.focusUnitId}
            density="compact"
            autoHeight
            columns={[
              {
                key: "name",
                header: "Focus Unit",
                align: "left",
                render: (item) => <TextCell value={item.focusUnitName} width={150} strong />,
              },
              {
                key: "sku",
                header: "SKU",
                align: "right",
                width: 60,
                render: (item) => formatNumber(item.productCodes.length),
              },
              {
                key: "national",
                header: "전국 취급률",
                align: "right",
                width: 130,
                render: (item) => <MeterCell value={item.nationalRate} />,
              },
              {
                key: "ofc",
                header: "내 OFC",
                align: "right",
                width: 110,
                render: (item) =>
                  item.ofcRate == null ? <span className="muted">-</span> : formatPercent(item.ofcRate),
              },
            ]}
            emptyTitle="중점상품 정보가 없습니다"
          />
        </SectionCard>
      </div>

      {/* 7. 행사상품 TOP N */}
      <SectionCard title={`행사상품 실적 TOP ${formatNumber(dataset.config.topN)}`} subtitle="매출액 기준" flush>
        <DataTable
          rows={metric.topProducts.map((product, position) => ({ ...product, rank: position + 1 }))}
          rowKey={(item) => `${item.productCode}-${item.rank}`}
          density="compact"
          defaultSort={{ key: "sales", direction: "desc" }}
          columns={[
            { key: "rank", header: "순위", align: "right", width: 56, render: (item) => item.rank },
            {
              key: "name",
              header: "상품명",
              align: "left",
              sticky: true,
              width: 260,
              sortValue: (item) => item.productName,
              render: (item) => <TextCell value={item.productName} width={240} />,
            },
            {
              key: "category",
              header: "카테고리",
              align: "left",
              width: 110,
              sortValue: (item) => item.categoryName,
              render: (item) => <TextCell value={item.categoryName} width={100} />,
            },
            { key: "in", header: "입고", align: "right", width: 80, sortValue: (item) => item.inboundQty, render: (item) => formatNumber(item.inboundQty) },
            { key: "qty", header: "판매", align: "right", width: 80, sortValue: (item) => item.salesQty, render: (item) => formatNumber(item.salesQty) },
            {
              key: "rate",
              header: "판매율",
              align: "right",
              width: 120,
              sortValue: (item) => safeDiv(item.salesQty, item.inboundQty),
              render: (item) => <MeterCell value={safeDiv(item.salesQty, item.inboundQty)} />,
            },
            {
              key: "sales",
              header: moneyHeader("매출액"),
              align: "right",
              width: 110,
              sortValue: (item) => item.salesAmount,
              render: (item) => formatWonThousand(item.salesAmount),
            },
          ]}
          emptyTitle="행사상품 실적이 없습니다"
          emptyDescription="입고·판매 자료가 반영되면 상품별 실적이 표시됩니다."
          caption="행사상품 상위 실적"
        />
      </SectionCard>
    </div>
  );
}
