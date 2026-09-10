import { useMemo, useState } from "react";
import type { CampaignListItem, DashboardDataset } from "../domain/types";
import {
  Badge,
  DataTable,
  Delta,
  EmptyState,
  KpiCard,
  KpiRow,
  MeterCell,
  PageHeader,
  SearchInput,
  SectionCard,
  Segmented,
  Select,
  StatusBadge,
  TextCell,
} from "../ui";
import type { Column } from "../ui";
import { IconOfc } from "../ui/icons";
import { formatNumber, formatPercent, formatSignedPercent, formatSignedPoint, formatWonThousand } from "../view-models/format";
import type { ComparisonIndex, StoreRow } from "../view-models/dashboard";
import { buildStoreRows, previousDeltaFor, previousTotalFor, storeRowSummary, storeRowsGroupDelta } from "../view-models/dashboard";
import { CampaignMeta, moneyHeader } from "./shared";

type StatusFilter = "all" | "action" | "watch" | "good" | "nodata";

const rateTone = (achieved: boolean) => (achieved ? "success" : "warning");

function storeColumns(): Column<StoreRow>[] {
  return [
    {
      key: "store",
      header: "점포",
      align: "left",
      sticky: true,
      width: 196,
      sortValue: (row) => row.store.storeName,
      render: (row) => (
        <span style={{ display: "grid", gap: 1 }}>
          <TextCell value={row.store.storeName} width={176} strong />
          <span className="mono">{row.store.currentCode}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "상태",
      headerTitle:
        "코칭 우선순위입니다. 중점상품 취급률 기준(서버 계산) 미달, 목표 미달, 그리고 직전전단 대비 증감이 담당 그룹 평균보다 낮은 경우를 합산합니다.",
      align: "left",
      width: 104,
      sortValue: (row) => row.priority,
      render: (row) => <StatusBadge status={row.status} title={row.reasons.join(" · ") || "기준 지표 이상 없음"} />,
    },
    {
      key: "daily",
      header: moneyHeader("행사 일매출"),
      headerTitle: "행사 총매출 ÷ 영업일수 (단위: 천원)",
      align: "right",
      width: 110,
      sortValue: (row) => row.metric.eventDailySales,
      render: (row) => formatWonThousand(row.metric.eventDailySales, 1),
    },
    {
      key: "prev",
      header: "직전전단 대비",
      headerTitle: "행사 총매출 ÷ 직전전단 총매출 - 1. 아래 값은 담당 점포 전체 평균과의 차이(%p)입니다.",
      align: "right",
      width: 118,
      sortValue: (row) => row.relativeGap ?? row.previousDelta,
      render: (row) => (
        <span style={{ display: "grid", gap: 1, justifyItems: "end" }}>
          <Delta value={row.previousDelta} />
          {row.relativeGap != null && (
            <span className="muted num">평균 대비 {formatSignedPoint(row.relativeGap)}</span>
          )}
        </span>
      ),
    },
    {
      key: "focus",
      header: "중점상품 취급률",
      align: "right",
      width: 150,
      sortValue: (row) => row.metric.focusHandlingRate,
      render: (row) => (
        <span className="row" data-nowrap="true" style={{ justifyContent: "flex-end" }}>
          <span className="muted num">
            {formatNumber(row.metric.focusHandledUnits)}/{formatNumber(row.metric.focusTotalUnits)}
          </span>
          <MeterCell value={row.metric.focusHandlingRate} tone={rateTone(row.metric.focusAchieved)} />
        </span>
      ),
    },
    {
      key: "handling",
      header: "전체 상품 취급률",
      headerTitle: "행사상품 중 입고가 있는 상품 비율",
      align: "right",
      width: 132,
      sortValue: (row) => row.metric.productHandlingRate.all,
      render: (row) => <MeterCell value={row.metric.productHandlingRate.all} />,
    },
    {
      key: "fresh",
      header: moneyHeader("신선 일매출"),
      align: "right",
      width: 108,
      sortValue: (row) => row.metric.freshDailySales,
      render: (row) => formatWonThousand(row.metric.freshDailySales, 1),
    },
    {
      key: "mix",
      header: "행사 신선 구성비",
      align: "right",
      width: 118,
      sortValue: (row) => row.metric.eventFreshComposition,
      render: (row) => formatPercent(row.metric.eventFreshComposition),
    },
    {
      key: "sales",
      header: moneyHeader("행사 총매출"),
      align: "right",
      width: 112,
      sortValue: (row) => row.metric.eventSalesTotal,
      render: (row) => formatWonThousand(row.metric.eventSalesTotal),
    },
    {
      key: "days",
      header: "영업일수",
      align: "right",
      width: 80,
      sortValue: (row) => row.metric.operatingDays,
      render: (row) =>
        row.metric.operatingDays ? (
          formatNumber(row.metric.operatingDays)
        ) : (
          <Badge tone="danger" size="sm">
            0
          </Badge>
        ),
    },
    {
      key: "type",
      header: "점포타입",
      align: "left",
      width: 96,
      sortValue: (row) => row.store.storeType,
      render: (row) => <TextCell value={row.store.storeType} width={88} />,
    },
  ];
}

export function OfcView({
  dataset,
  campaign,
  index,
  selectedTeam,
  selectedOFC,
  onScopeChange,
  onOpenStore,
}: {
  dataset: DashboardDataset;
  campaign?: CampaignListItem;
  index: ComparisonIndex;
  selectedTeam?: string;
  selectedOFC?: string;
  onScopeChange: (team: string | undefined, ofc: string) => void;
  onOpenStore: (storeId: string) => void;
}) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  const canDrill = dataset.permissions.canViewAllStores;
  const summary =
    dataset.aggregates.ofcs.find((row) => row.label === selectedOFC && (!canDrill || row.team === selectedTeam)) ??
    dataset.aggregates.ofcs.find((row) => row.label === selectedOFC) ??
    dataset.aggregates.ofcs[0];

  const rows = useMemo(
    () =>
      buildStoreRows(
        dataset,
        (store) => !summary || (store.ofc === summary.label && (!summary.team || store.team === summary.team)),
      ),
    [dataset, summary],
  );

  const counts = useMemo(() => storeRowSummary(rows), [rows]);
  const groupDelta = useMemo(() => storeRowsGroupDelta(rows), [rows]);

  const visibleRows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== "all" && row.status !== status) return false;
      if (!keyword) return true;
      return `${row.store.storeName} ${row.store.currentCode} ${row.store.storeType ?? ""}`.toLowerCase().includes(keyword);
    });
  }, [rows, status, query]);

  if (!summary) {
    return (
      <div className="page">
        <PageHeader icon={<IconOfc size={20} aria-hidden />} title="OFC 현황" />
        <SectionCard>
          <EmptyState title="조회할 OFC가 없습니다" description="Campaign에 조직 정보가 반영되면 담당 점포를 볼 수 있습니다." inline />
        </SectionCard>
      </div>
    );
  }

  const delta = previousDeltaFor(index, summary);
  const previous = previousTotalFor(index, summary);
  const teamOptions = dataset.aggregates.ofcs.filter((row) => !canDrill || row.team === (selectedTeam ?? summary.team));

  return (
    <div className="page">
      <PageHeader
        icon={<IconOfc size={20} aria-hidden />}
        title={canDrill ? "OFC 현황" : "내 담당 현황"}
        description="담당 점포 중 먼저 확인할 곳을 고르는 화면입니다. 상태 필터와 정렬로 우선순위를 좁히세요."
        meta={
          <>
            <CampaignMeta dataset={dataset} campaign={campaign} />
            <span className="meta-item">
              담당
              <b>
                {[summary.businessUnit, summary.team].filter(Boolean).join(" · ")} · {summary.label} · 점포{" "}
                {formatNumber(summary.storeCount)}
              </b>
            </span>
          </>
        }
        actions={
          canDrill && (
            <label className="row" data-nowrap="true">
              <span className="muted">OFC</span>
              <Select
                value={summary.label}
                onChange={(event) => {
                  const next = teamOptions.find((row) => row.label === event.target.value);
                  onScopeChange(next?.team, event.target.value);
                }}
                style={{ width: 180 }}
              >
                {teamOptions.map((row) => (
                  <option key={row.key} value={row.label}>
                    {row.label}
                  </option>
                ))}
              </Select>
            </label>
          )
        }
      />

      <KpiRow cols={6}>
        <KpiCard label="행사 총매출" value={formatWonThousand(summary.eventSalesTotal)} unit="천원" emphasis />
        <KpiCard
          label="행사 일매출"
          value={formatWonThousand(summary.eventDailySales, 1)}
          unit="천원"
          emphasis
          hint="담당 점포 행사 총매출 ÷ 영업일수 합계"
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
        <KpiCard
          label="중점상품 취급률"
          value={formatPercent(summary.focusHandlingRate)}
          note={`달성 ${formatNumber(summary.focusAchievedStores)} / ${formatNumber(summary.storeCount)}점`}
        />
        <KpiCard label="신선 전체 일매출" value={formatWonThousand(summary.freshDailySales, 1)} unit="천원" />
        <KpiCard
          label="우선 코칭 점포"
          value={formatNumber(counts.action)}
          unit="점"
          hint="중점상품 취급률 기준 미달, 또는 직전전단 대비가 담당 점포 평균보다 15%p 이상 낮은 점포입니다."
          note={`관찰 ${formatNumber(counts.watch)}점 · 양호 ${formatNumber(counts.good)}점`}
        />
      </KpiRow>

      <SectionCard
        title="담당 점포"
        subtitle={`${formatNumber(visibleRows.length)} / ${formatNumber(rows.length)}점 · 담당 전체 직전전단 대비 ${formatSignedPercent(groupDelta)}`}
        flush
      >
        <DataTable
          rows={visibleRows}
          rowKey={(row) => row.key}
          columns={storeColumns()}
          density="compact"
          defaultSort={{ key: "status", direction: "desc" }}
          onRowClick={(row) => onOpenStore(row.store.storeId)}
          rowTone={(row) => (row.status === "action" ? "attention" : undefined)}
          caption="담당 점포별 실적과 코칭 우선순위"
          emptyTitle="조건에 맞는 점포가 없습니다"
          emptyDescription="상태 필터를 전체로 되돌리거나 검색어를 지워보세요."
          toolbar={
            <>
              <div className="table-toolbar-group">
                <Segmented
                  label="점포 상태 필터"
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "all", label: "전체", count: counts.total },
                    { value: "action", label: "우선 코칭", count: counts.action },
                    { value: "watch", label: "관찰", count: counts.watch },
                    { value: "good", label: "양호", count: counts.good },
                    { value: "nodata", label: "데이터 없음", count: counts.nodata },
                  ]}
                />
              </div>
              <div className="table-toolbar-group">
                <SearchInput label="점포 검색" value={query} onChange={setQuery} placeholder="점포명 · 코드" width={170} />
              </div>
            </>
          }
        />
      </SectionCard>
    </div>
  );
}
