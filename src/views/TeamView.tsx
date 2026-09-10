import { useMemo } from "react";
import type { AggregateMetric, CampaignListItem, DashboardDataset } from "../domain/types";
import { Badge, DataTable, Delta, EmptyState, KpiCard, KpiRow, PageHeader, SectionCard, Select, StatusBadge, TextCell } from "../ui";
import type { Column } from "../ui";
import { IconOfc, IconTeam } from "../ui/icons";
import { formatNumber, formatPercent, formatSignedPercent, formatWonThousand } from "../view-models/format";
import type { ComparisonIndex, ScopeLevel, StoreRow } from "../view-models/dashboard";
import { buildStoreRows, previousDeltaFor, previousTotalFor, teamsForBusinessUnit } from "../view-models/dashboard";
import { CampaignMeta, ScopeBar, moneyHeader } from "./shared";

function ofcColumns(index: ComparisonIndex, attentionByOfc: Map<string, number>): Column<AggregateMetric>[] {
  return [
    {
      key: "ofc",
      header: "OFC",
      align: "left",
      sticky: true,
      width: 130,
      sortValue: (row) => row.label,
      render: (row) => <span className="cell-strong">{row.label}</span>,
    },
    {
      key: "stores",
      header: "담당 점포",
      align: "right",
      width: 86,
      sortValue: (row) => row.storeCount,
      render: (row) => formatNumber(row.storeCount),
    },
    {
      key: "attention",
      header: "우선 코칭",
      headerTitle: "중점 미달·직전전단 급감 등으로 먼저 확인이 필요한 담당 점포 수",
      align: "right",
      width: 88,
      sortValue: (row) => attentionByOfc.get(row.label) ?? 0,
      render: (row) => {
        const count = attentionByOfc.get(row.label) ?? 0;
        if (!count) return <span className="muted">-</span>;
        return (
          <span className="row" data-nowrap="true" style={{ justifyContent: "flex-end" }}>
            <Badge tone="warning" size="sm">
              {formatNumber(count)}
            </Badge>
            <span className="muted num">/ {formatNumber(row.storeCount)}</span>
          </span>
        );
      },
    },
    {
      key: "sales",
      header: moneyHeader("행사 총매출"),
      align: "right",
      sortValue: (row) => row.eventSalesTotal,
      render: (row) => formatWonThousand(row.eventSalesTotal),
    },
    {
      key: "daily",
      header: moneyHeader("행사 일매출"),
      align: "right",
      sortValue: (row) => row.eventDailySales,
      render: (row) => formatWonThousand(row.eventDailySales, 1),
    },
    {
      key: "prev",
      header: "직전전단 대비",
      align: "right",
      sortValue: (row) => previousDeltaFor(index, row),
      render: (row) => <Delta value={previousDeltaFor(index, row)} />,
    },
    {
      key: "focus",
      header: "중점상품 취급률",
      align: "right",
      sortValue: (row) => row.focusHandlingRate,
      render: (row) => formatPercent(row.focusHandlingRate),
    },
    {
      key: "focusStores",
      header: "중점 달성점",
      align: "right",
      width: 92,
      sortValue: (row) => row.focusAchievedStores,
      render: (row) => (
        <>
          {formatNumber(row.focusAchievedStores)}
          <span className="muted"> / {formatNumber(row.storeCount)}</span>
        </>
      ),
    },
    {
      key: "fresh",
      header: moneyHeader("신선 전체 일매출"),
      align: "right",
      sortValue: (row) => row.freshDailySales,
      render: (row) => formatWonThousand(row.freshDailySales, 1),
    },
    {
      key: "mix",
      header: "행사 신선 구성비",
      align: "right",
      sortValue: (row) => row.eventFreshComposition,
      render: (row) => formatPercent(row.eventFreshComposition),
    },
    {
      key: "days",
      header: "영업일수",
      align: "right",
      width: 78,
      sortValue: (row) => row.operatingDays,
      render: (row) => formatNumber(row.operatingDays),
    },
  ];
}

export function TeamView({
  dataset,
  campaign,
  index,
  selectedTeam,
  onTeamChange,
  onNavigate,
  onOpenOfc,
  onOpenStore,
}: {
  dataset: DashboardDataset;
  campaign?: CampaignListItem;
  index: ComparisonIndex;
  selectedTeam?: string;
  onTeamChange: (team: string) => void;
  onNavigate: (level: ScopeLevel, value?: string) => void;
  onOpenOfc: (team: string, ofc: string) => void;
  onOpenStore: (storeId: string) => void;
}) {
  const teams = dataset.aggregates.teams;
  const canDrill = dataset.permissions.canViewAllStores;
  const summary = teams.find((row) => row.label === selectedTeam) ?? teams[0];
  const ofcs = useMemo(
    () => dataset.aggregates.ofcs.filter((row) => !canDrill || row.team === summary?.label),
    [dataset.aggregates.ofcs, summary?.label, canDrill],
  );

  const storeRows = useMemo(
    () => buildStoreRows(dataset, (store) => !summary || store.team === summary.label),
    [dataset, summary],
  );

  const attentionByOfc = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of storeRows) {
      if (row.status !== "action" && row.status !== "nodata") continue;
      const key = row.store.ofc ?? "-";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [storeRows]);

  const attentionStores = useMemo(
    () => [...storeRows].sort((a, b) => b.priority - a.priority || (a.metric.eventDailySales ?? 0) - (b.metric.eventDailySales ?? 0)).slice(0, 8),
    [storeRows],
  );

  if (!summary) {
    return (
      <div className="page">
        <PageHeader icon={<IconTeam size={20} aria-hidden />} title="팀 현황" />
        <SectionCard>
          <EmptyState title="조회할 팀이 없습니다" description="Campaign에 조직 정보가 반영되면 팀 현황을 볼 수 있습니다." inline />
        </SectionCard>
      </div>
    );
  }

  const delta = previousDeltaFor(index, summary);
  const previous = previousTotalFor(index, summary);
  // Sibling teams = the other teams inside the same 부문, matching the level
  // above this one in the drill-down.
  const siblingTeams = summary.businessUnit
    ? teamsForBusinessUnit(dataset, summary.businessUnit)
    : teams;

  return (
    <div className="page">
      <PageHeader
        icon={<IconTeam size={20} aria-hidden />}
        title={canDrill ? `${summary.label} 현황` : "소속팀 현황"}
        description={
          canDrill
            ? "팀 회의용 화면입니다. OFC 행을 선택하면 담당 점포 목록으로 이동합니다."
            : "로그인한 OFC가 속한 팀의 요약입니다."
        }
        meta={
          <>
            <CampaignMeta dataset={dataset} campaign={campaign} />
            <span className="meta-item">
              범위
              <b>
                {summary.businessUnit ? `${summary.businessUnit} · ` : ""}
                {summary.label} · 점포 {formatNumber(summary.storeCount)} · OFC {formatNumber(summary.ofcCount)}
              </b>
            </span>
          </>
        }
        actions={
          <>
            <ScopeBar
              level="team"
              businessUnit={summary.businessUnit}
              team={summary.label}
              showBusinessUnit={dataset.aggregates.businessUnits.length > 0}
              onNavigate={onNavigate}
            />
            {canDrill && (
              <label className="row" data-nowrap="true">
                <span className="muted">영업팀</span>
                <Select
                  value={summary.label}
                  onChange={(event) => onTeamChange(event.target.value)}
                  style={{ width: 210 }}
                >
                  {siblingTeams.map((row) => (
                    <option key={row.key} value={row.label}>
                      {row.label}
                    </option>
                  ))}
                </Select>
              </label>
            )}
          </>
        }
      />

      <KpiRow cols={6}>
        <KpiCard label="행사 총매출" value={formatWonThousand(summary.eventSalesTotal)} unit="천원" emphasis />
        <KpiCard
          label="행사 일매출"
          value={formatWonThousand(summary.eventDailySales, 1)}
          unit="천원"
          emphasis
          hint="행사 총매출 ÷ 영업일수 합계"
        />
        <KpiCard
          label="직전전단 대비"
          value={formatSignedPercent(delta)}
          valueChange={delta}
          note={
            previous != null
              ? `직전 ${formatWonThousand(previous)}천원`
              : canDrill
                ? "직전 자료 없음"
                : "담당 범위 밖 (조회 권한)"
          }
        />
        <KpiCard label="신선 전체 일매출" value={formatWonThousand(summary.freshDailySales, 1)} unit="천원" />
        <KpiCard label="행사 신선 구성비" value={formatPercent(summary.eventFreshComposition)} />
        <KpiCard
          label="중점상품 취급률"
          value={formatPercent(summary.focusHandlingRate)}
          note={`달성 ${formatNumber(summary.focusAchievedStores)} / ${formatNumber(summary.storeCount)}점`}
        />
      </KpiRow>

      <div className="grid-2" data-ratio="wide-left">
        <SectionCard
          title={canDrill ? "OFC별 비교" : "내 OFC"}
          icon={<IconOfc size={15} aria-hidden />}
          subtitle={`${formatNumber(ofcs.length)}명`}
          flush
        >
          <DataTable
            rows={ofcs}
            rowKey={(row) => row.key}
            columns={ofcColumns(index, attentionByOfc)}
            density="compact"
            defaultSort={{ key: "daily", direction: "desc" }}
            onRowClick={canDrill ? (row) => onOpenOfc(row.team ?? summary.label, row.label) : undefined}
            caption="OFC별 실적 비교"
            emptyTitle="표시할 OFC가 없습니다"
          />
        </SectionCard>

        <SectionCard title="우선 확인 점포" subtitle={`${formatNumber(storeRows.length)}점 중 상위 ${formatNumber(attentionStores.length)}`}>
          {attentionStores.length === 0 ? (
            <p className="muted">확인이 필요한 점포가 없습니다.</p>
          ) : (
            <ul className="stack" data-gap="sm" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {attentionStores.map((row: StoreRow) => (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => onOpenStore(row.store.storeId)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                      alignItems: "center",
                      gap: "var(--s-2)",
                      width: "100%",
                      border: 0,
                      background: "transparent",
                      padding: "3px 0",
                      font: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                      <TextCell value={row.store.storeName} width={200} strong />
                      <span className="muted trunc" style={{ ["--trunc-w" as string]: "220px" }} title={row.reasons.join(" · ")}>
                        {row.store.ofc} · {row.reasons.join(" · ") || "정상"}
                      </span>
                    </span>
                    <StatusBadge status={row.status} title={row.reasons.join(" · ")} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
