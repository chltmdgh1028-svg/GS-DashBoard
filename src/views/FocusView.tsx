import { useMemo, useState } from "react";
import type { CampaignListItem, DashboardDataset, FocusSummary } from "../domain/types";
import {
  Badge,
  DataTable,
  KpiCard,
  KpiRow,
  MeterCell,
  PageHeader,
  SearchInput,
  SectionCard,
  Segmented,
  TextCell,
} from "../ui";
import { IconFocus, IconOfc } from "../ui/icons";
import { formatNumber, formatPercent } from "../view-models/format";
import { buildFocusStoreRows } from "../view-models/dashboard";
import { CampaignMeta } from "./shared";

type CoverageFilter = "all" | "missing";

export function FocusView({
  dataset,
  campaign,
  onOpenStore,
}: {
  dataset: DashboardDataset;
  campaign?: CampaignListItem;
  onOpenStore: (storeId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [coverage, setCoverage] = useState<CoverageFilter>("all");
  const [storeQuery, setStoreQuery] = useState("");

  const units = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return dataset.focusSummaries;
    return dataset.focusSummaries.filter((unit) =>
      `${unit.focusUnitName} ${unit.categoryName ?? ""} ${unit.productCodes.join(" ")}`.toLowerCase().includes(keyword),
    );
  }, [dataset.focusSummaries, query]);

  const storeRows = useMemo(() => buildFocusStoreRows(dataset), [dataset]);

  const visibleStores = useMemo(() => {
    const keyword = storeQuery.trim().toLowerCase();
    return storeRows.filter((row) => {
      if (coverage === "missing" && row.missing === 0) return false;
      if (!keyword) return true;
      return `${row.store.storeName} ${row.store.currentCode} ${row.store.ofc ?? ""}`.toLowerCase().includes(keyword);
    });
  }, [storeRows, coverage, storeQuery]);

  const skuCount = new Set(dataset.focusUnits.flatMap((unit) => unit.productCodes)).size;
  const achievedStores = storeRows.filter((row) => row.achieved).length;
  const missingStores = storeRows.filter((row) => row.missing > 0).length;
  const national = dataset.aggregates.national;
  const canDrill = dataset.permissions.canViewAllStores;

  const ofcRanking = useMemo(
    () =>
      [...dataset.aggregates.ofcs]
        .filter((row) => row.focusHandlingRate != null)
        .sort((a, b) => (a.focusHandlingRate ?? 0) - (b.focusHandlingRate ?? 0))
        .slice(0, 12),
    [dataset.aggregates.ofcs],
  );

  return (
    <div className="page">
      <PageHeader
        icon={<IconFocus size={20} aria-hidden />}
        title="중점상품"
        description="Focus Unit별 취급 현황과 아직 취급하지 않은 점포를 확인하는 화면입니다."
        meta={<CampaignMeta dataset={dataset} campaign={campaign} />}
      />

      <KpiRow cols={5}>
        <KpiCard label="Focus Unit" value={formatNumber(dataset.focusUnits.length)} unit="개" />
        <KpiCard label="대상 SKU" value={formatNumber(skuCount)} unit="개" />
        <KpiCard
          label="전국 취급률"
          value={formatPercent(national.focusHandlingRate)}
          emphasis
          hint="Focus Unit 기준 취급 점포 비율입니다."
        />
        <KpiCard
          label="기준 달성 점포"
          value={formatNumber(achievedStores)}
          unit="점"
          note={`조회 범위 ${formatNumber(storeRows.length)}점`}
        />
        <KpiCard
          label="미취급 있는 점포"
          value={formatNumber(missingStores)}
          unit="점"
          hint="Focus Unit 중 하나 이상을 취급하지 않은 점포 수입니다."
        />
      </KpiRow>

      <div className="grid-2" data-ratio="wide-left">
        <SectionCard
          title="Focus Unit 현황"
          subtitle={`${formatNumber(units.length)} / ${formatNumber(dataset.focusSummaries.length)}개`}
          flush
          actions={<SearchInput label="중점상품 검색" value={query} onChange={setQuery} placeholder="상품 · 코드" width={150} />}
        >
          <DataTable
            rows={units}
            rowKey={(row) => row.focusUnitId}
            density="compact"
            defaultSort={{ key: "national", direction: "asc" }}
            columns={[
              {
                key: "name",
                header: "Focus Unit",
                align: "left",
                sticky: true,
                width: 168,
                sortValue: (row) => row.focusUnitName,
                render: (row) => <TextCell value={row.focusUnitName} width={150} strong />,
              },
              {
                key: "category",
                header: "카테고리",
                align: "left",
                width: 84,
                sortValue: (row) => row.categoryName,
                render: (row) => <TextCell value={row.categoryName} width={76} />,
              },
              {
                key: "sku",
                header: "SKU",
                align: "right",
                width: 62,
                sortValue: (row) => row.productCodes.length,
                render: (row) => formatNumber(row.productCodes.length),
              },
              {
                key: "codes",
                header: "포함 상품코드",
                align: "left",
                width: 152,
                render: (row) => <TextCell value={row.productCodes.join(", ")} width={142} />,
              },
              {
                key: "national",
                header: "전국 취급률",
                align: "right",
                width: 140,
                sortValue: (row) => row.nationalRate,
                render: (row) => <MeterCell value={row.nationalRate} />,
              },
              ...(canDrill
                ? []
                : [
                    {
                      key: "team",
                      header: "소속팀",
                      align: "right" as const,
                      width: 92,
                      sortValue: (row: FocusSummary) => row.teamRate,
                      render: (row: FocusSummary) =>
                        row.teamRate == null ? <span className="muted">-</span> : formatPercent(row.teamRate),
                    },
                    {
                      key: "ofc",
                      header: "내 OFC",
                      align: "right" as const,
                      width: 92,
                      sortValue: (row: FocusSummary) => row.ofcRate,
                      render: (row: FocusSummary) =>
                        row.ofcRate == null ? <span className="muted">-</span> : formatPercent(row.ofcRate),
                    },
                  ]),
            ]}
            emptyTitle="중점상품 정보가 없습니다"
            emptyDescription="중점취급상품 자료가 반영되면 Focus Unit이 표시됩니다."
            caption="Focus Unit별 취급률"
          />
        </SectionCard>

        <SectionCard
          title={canDrill ? "취급률 낮은 OFC" : "OFC 취급률"}
          icon={<IconOfc size={15} aria-hidden />}
          subtitle={canDrill ? "하위 12명" : undefined}
          flush
        >
          <DataTable
            rows={ofcRanking}
            rowKey={(row) => row.key}
            density="compact"
            autoHeight
            columns={[
              {
                key: "ofc",
                header: "OFC",
                align: "left",
                width: 110,
                render: (row) => <TextCell value={row.label} width={100} strong />,
              },
              {
                key: "team",
                header: "팀",
                align: "left",
                width: 118,
                render: (row) => <TextCell value={row.team} width={108} />,
              },
              {
                key: "stores",
                header: "점포",
                align: "right",
                width: 60,
                render: (row) => formatNumber(row.storeCount),
              },
              {
                key: "rate",
                header: "취급률",
                align: "right",
                width: 130,
                render: (row) => <MeterCell value={row.focusHandlingRate} />,
              },
            ]}
            emptyTitle="표시할 OFC가 없습니다"
          />
        </SectionCard>
      </div>

      <SectionCard
        title="점포별 취급 현황"
        subtitle={`${formatNumber(visibleStores.length)} / ${formatNumber(storeRows.length)}점`}
        flush
      >
        <DataTable
          rows={visibleStores}
          rowKey={(row) => row.key}
          density="compact"
          defaultSort={{ key: "missing", direction: "desc" }}
          onRowClick={(row) => onOpenStore(row.store.storeId)}
          rowTone={(row) => (row.achieved ? undefined : "attention")}
          toolbar={
            <>
              <div className="table-toolbar-group">
                <Segmented
                  label="취급 상태 필터"
                  value={coverage}
                  onChange={setCoverage}
                  options={[
                    { value: "all", label: "전체", count: storeRows.length },
                    { value: "missing", label: "미취급 있음", count: missingStores },
                  ]}
                />
              </div>
              <div className="table-toolbar-group">
                <SearchInput
                  label="점포 검색"
                  value={storeQuery}
                  onChange={setStoreQuery}
                  placeholder="점포명 · 코드 · OFC"
                  width={180}
                />
              </div>
            </>
          }
          columns={[
            {
              key: "store",
              header: "점포",
              align: "left",
              sticky: true,
              width: 190,
              sortValue: (row) => row.store.storeName,
              render: (row) => (
                <span style={{ display: "grid", gap: 1 }}>
                  <TextCell value={row.store.storeName} width={170} strong />
                  <span className="mono">{row.store.currentCode}</span>
                </span>
              ),
            },
            {
              key: "ofc",
              header: "OFC",
              align: "left",
              width: 100,
              sortValue: (row) => row.store.ofc,
              render: (row) => <TextCell value={row.store.ofc} width={92} />,
            },
            {
              key: "team",
              header: "팀",
              align: "left",
              width: 140,
              sortValue: (row) => row.store.team,
              render: (row) => <TextCell value={row.store.team} width={130} />,
            },
            {
              key: "handled",
              header: "취급",
              align: "right",
              width: 80,
              sortValue: (row) => row.handled,
              render: (row) => `${formatNumber(row.handled)} / ${formatNumber(row.total)}`,
            },
            {
              key: "missing",
              header: "미취급",
              align: "right",
              width: 84,
              sortValue: (row) => row.missing,
              render: (row) =>
                row.missing === 0 ? (
                  <span className="muted">0</span>
                ) : (
                  <Badge tone="warning" size="sm">
                    {formatNumber(row.missing)}개
                  </Badge>
                ),
            },
            {
              key: "rate",
              header: "취급률",
              align: "right",
              width: 140,
              sortValue: (row) => row.rate,
              render: (row) => <MeterCell value={row.rate} tone={row.achieved ? "success" : "warning"} />,
            },
          ]}
          emptyTitle="조건에 맞는 점포가 없습니다"
          caption="점포별 중점상품 취급 현황"
        />
      </SectionCard>
    </div>
  );
}
