import { useMemo, useState } from "react";
import type { AggregateMetric, CampaignListItem, DashboardDataset } from "../domain/types";
import { DataTable, Delta, KpiCard, KpiRow, PageHeader, SectionCard, Segmented } from "../ui";
import { IconBusinessUnit, IconNational, IconTeam } from "../ui/icons";
import { formatNumber, formatPercent, formatSignedPercent, formatWonThousand } from "../view-models/format";
import type { ComparisonIndex, Scope, ScopeLevel } from "../view-models/dashboard";
import { previousDeltaFor, previousTotalFor, teamsForBusinessUnit } from "../view-models/dashboard";
import { CampaignMeta, ScopeBar, aggregateColumns } from "./shared";

type RankMetric = "daily" | "previous" | "focus";

const rankMetrics: { value: RankMetric; label: string }[] = [
  { value: "daily", label: "행사 일매출" },
  { value: "previous", label: "직전전단 대비" },
  { value: "focus", label: "중점 취급률" },
];

function rankValue(row: AggregateMetric, metric: RankMetric, index: ComparisonIndex) {
  if (metric === "daily") return row.eventDailySales;
  if (metric === "focus") return row.focusHandlingRate;
  return previousDeltaFor(index, row);
}

function rankText(value: number | undefined, metric: RankMetric) {
  if (value == null) return "-";
  if (metric === "daily") return `${formatWonThousand(value, 1)}천원`;
  if (metric === "focus") return formatPercent(value);
  return formatSignedPercent(value);
}

/**
 * Ranking strip. Bars are normalised to the largest absolute value in the list,
 * so the eye can order the group without reading every number first.
 */
function RankList({
  rows,
  metric,
  index,
  onSelect,
}: {
  rows: AggregateMetric[];
  metric: RankMetric;
  index: ComparisonIndex;
  onSelect?: (row: AggregateMetric) => void;
}) {
  const ranked = useMemo(() => {
    const withValue = rows
      .map((row) => ({ row, value: rankValue(row, metric, index) }))
      .filter((item) => item.value != null) as { row: AggregateMetric; value: number }[];
    return withValue.sort((a, b) => b.value - a.value);
  }, [rows, metric, index]);

  const scale = Math.max(...ranked.map((item) => Math.abs(item.value)), 0.0001);

  if (!ranked.length) return <p className="muted">비교할 데이터가 없습니다.</p>;

  return (
    <ol className="stack" data-gap="sm" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {ranked.map((item, position) => (
        <li key={item.row.key}>
          <button
            type="button"
            onClick={onSelect ? () => onSelect(item.row) : undefined}
            disabled={!onSelect}
            style={{
              display: "grid",
              gridTemplateColumns: "18px minmax(0, 1fr) 92px",
              alignItems: "center",
              gap: "var(--s-2)",
              width: "100%",
              border: 0,
              background: "transparent",
              padding: "2px 0",
              font: "inherit",
              textAlign: "left",
              cursor: onSelect ? "pointer" : "default",
            }}
          >
            <span className="muted num">{position + 1}</span>
            <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
              <span className="trunc" style={{ ["--trunc-w" as string]: "100%" }} title={item.row.label}>
                {item.row.label}
              </span>
              <span className="meter-track">
                <span
                  className="meter-fill"
                  data-tone={item.value < 0 ? "danger" : undefined}
                  style={{ width: `${(Math.abs(item.value) / scale) * 100}%` }}
                />
              </span>
            </span>
            <span className="num" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {metric === "previous" ? <Delta value={item.value} /> : rankText(item.value, metric)}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * The top two levels of the drill-down: 전국 and 부문.
 *
 * The rule is the same at both levels - the KPI row describes the level you
 * are standing on, and the table underneath compares the level directly below
 * it (전국 → 부문, 부문 → 영업팀). Selecting a row goes one level deeper.
 */
export function OverviewView({
  dataset,
  campaign,
  index,
  scope,
  onNavigate,
  onSelectBusinessUnit,
  onSelectTeam,
}: {
  dataset: DashboardDataset;
  campaign?: CampaignListItem;
  index: ComparisonIndex;
  scope: Scope;
  onNavigate: (level: ScopeLevel, value?: string) => void;
  onSelectBusinessUnit: (businessUnit: string) => void;
  onSelectTeam: (team: string) => void;
}) {
  const [rankMetric, setRankMetric] = useState<RankMetric>("daily");
  const canDrill = dataset.permissions.canViewAllStores;
  const hasBusinessUnits = dataset.aggregates.businessUnits.length > 0;

  const businessUnit = hasBusinessUnits
    ? dataset.aggregates.businessUnits.find((row) => row.label === scope.businessUnit)
    : undefined;
  const level: "national" | "businessUnit" = businessUnit ? "businessUnit" : "national";
  const summary = businessUnit ?? dataset.aggregates.national;

  // 전국 compares 부문; 부문 compares its own teams. An OFC has no business
  // unit rollup, so their 전국 summary compares at team level instead.
  const compareTeams = level === "businessUnit" || !hasBusinessUnits;
  const children = compareTeams
    ? teamsForBusinessUnit(dataset, businessUnit?.label)
    : dataset.aggregates.businessUnits;
  const childHeader = compareTeams ? "영업팀" : "부문";
  const childIcon = compareTeams ? <IconTeam size={15} aria-hidden /> : <IconBusinessUnit size={15} aria-hidden />;
  const onChildSelect = compareTeams ? onSelectTeam : onSelectBusinessUnit;

  const delta = previousDeltaFor(index, summary);
  const previous = previousTotalFor(index, summary);

  return (
    <div className="page">
      <PageHeader
        icon={
          level === "businessUnit" ? <IconBusinessUnit size={20} aria-hidden /> : <IconNational size={20} aria-hidden />
        }
        title={level === "businessUnit" ? `${summary.label} 현황` : "전국 현황"}
        description={
          canDrill
            ? `${childHeader}별로 비교하고, 행을 선택하면 해당 ${childHeader} 현황으로 들어갑니다.`
            : "전사 요약 지표입니다. 담당 점포 상세는 OFC 현황에서 확인하세요."
        }
        meta={
          <>
            <CampaignMeta dataset={dataset} campaign={campaign} />
            <span className="meta-item">
              범위
              <b>
                점포 {formatNumber(summary.storeCount)} · OFC {formatNumber(summary.ofcCount)} · 영업일수{" "}
                {formatNumber(summary.operatingDays)}일
              </b>
            </span>
          </>
        }
        actions={
          <ScopeBar
            level={level}
            businessUnit={businessUnit?.label}
            showBusinessUnit={hasBusinessUnits}
            onNavigate={onNavigate}
          />
        }
      />

      <KpiRow cols={6}>
        <KpiCard
          label="행사 총매출"
          value={formatWonThousand(summary.eventSalesTotal)}
          unit="천원"
          emphasis
          note={`대상 ${formatNumber(summary.storeCount)}점`}
        />
        <KpiCard
          label="행사 일매출"
          value={formatWonThousand(summary.eventDailySales, 1)}
          unit="천원"
          emphasis
          hint="행사 총매출 ÷ 영업일수 합계"
          note={`영업일수 ${formatNumber(summary.operatingDays)}일`}
        />
        <KpiCard
          label="직전전단 대비"
          value={formatSignedPercent(delta)}
          hint="행사 총매출을 직전전단 총매출과 비교한 증감률입니다."
          valueChange={delta}
          note={
            previous != null
              ? `직전 ${formatWonThousand(previous)}천원`
              : canDrill
                ? "직전 자료 없음"
                : "담당 범위 밖 (조회 권한)"
          }
        />
        <KpiCard
          label="신선 전체 일매출"
          value={formatWonThousand(summary.freshDailySales, 1)}
          unit="천원"
          hint="신선매출 자료 기준 일매출입니다."
        />
        <KpiCard
          label="행사 신선 구성비"
          value={formatPercent(summary.eventFreshComposition)}
          hint="신선 행사 일매출 ÷ 신선 전체 일매출"
        />
        <KpiCard
          label="중점상품 취급률"
          value={formatPercent(summary.focusHandlingRate)}
          hint="Focus Unit 기준 취급 점포 비율입니다."
          note={`달성 ${formatNumber(summary.focusAchievedStores)} / ${formatNumber(summary.storeCount)}점`}
        />
      </KpiRow>

      {children.length > 0 && (
        <div className={children.length > 1 ? "grid-2" : "stack"} data-ratio="wide-left">
          <SectionCard
            title={`${childHeader}별 비교`}
            icon={childIcon}
            subtitle={
              canDrill
                ? `${formatNumber(children.length)}개 · 행 선택 시 하위 현황`
                : `${formatNumber(children.length)}개`
            }
            flush
          >
            <DataTable
              rows={children}
              rowKey={(row) => row.key}
              columns={aggregateColumns({
                firstHeader: childHeader,
                index,
                showOfcCount: true,
                variant: children.length > 1 ? "slim" : "full",
              })}
              density="compact"
              autoHeight
              defaultSort={{ key: "sales", direction: "desc" }}
              onRowClick={canDrill ? (row) => onChildSelect(row.label) : undefined}
              caption={`${childHeader}별 전단행사 실적 비교`}
            />
          </SectionCard>

          {children.length > 1 && (
            <SectionCard
              title={`${childHeader} 순위`}
              actions={
                <Segmented label="순위 기준 지표" value={rankMetric} options={rankMetrics} onChange={setRankMetric} />
              }
            >
              <RankList
                rows={children}
                metric={rankMetric}
                index={index}
                onSelect={canDrill ? (row) => onChildSelect(row.label) : undefined}
              />
            </SectionCard>
          )}
        </div>
      )}
    </div>
  );
}
