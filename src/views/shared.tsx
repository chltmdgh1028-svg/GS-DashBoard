import type { ReactNode } from "react";
import type { AggregateMetric, CampaignListItem, DashboardDataset } from "../domain/types";
import { Badge, CampaignBadge, Delta, MetaItem } from "../ui";
import { IconError, IconOk } from "../ui/icons";
import { formatDateTimeFull, formatNumber, formatPercent, formatRelativeTime, formatWonThousand } from "../view-models/format";
import type { ComparisonIndex } from "../view-models/dashboard";
import { previousDeltaFor } from "../view-models/dashboard";
import type { Column } from "../ui";

/**
 * Campaign context strip shown under every dashboard page title:
 * 기준기간 · Revision · 마지막 반영 · 데이터 상태.
 * A number without its campaign and revision is not decision-grade.
 */
export function CampaignMeta({
  dataset,
  campaign,
}: {
  dataset: DashboardDataset;
  campaign?: CampaignListItem;
}) {
  const period = dataset.adminConfig?.startDate
    ? `${dataset.adminConfig.startDate} ~ ${dataset.adminConfig.endDate ?? ""}`.trim()
    : undefined;
  const errors = dataset.issues?.filter((issue) => issue.severity === "error").length;

  return (
    <>
      <MetaItem label="Campaign">{dataset.config.campaignName}</MetaItem>
      {period && <MetaItem label="기준기간">{period}</MetaItem>}
      {campaign?.activeRevisionNumber != null && (
        <span className="meta-item">
          Revision
          <CampaignBadge revisionNumber={campaign.activeRevisionNumber} active />
        </span>
      )}
      <MetaItem label="최종 반영">
        <span title={formatDateTimeFull(campaign?.updatedAt ?? dataset.createdAt)}>
          {formatRelativeTime(campaign?.updatedAt ?? dataset.createdAt)}
        </span>
      </MetaItem>
      {errors != null && (
        <span className="meta-item">
          데이터 상태
          {errors > 0 ? (
            <Badge tone="danger" size="sm" icon={<IconError size={12} aria-hidden />}>
              Error {formatNumber(errors)}건
            </Badge>
          ) : (
            <Badge tone="success" size="sm" icon={<IconOk size={12} aria-hidden />}>
              검증 통과
            </Badge>
          )}
        </span>
      )}
    </>
  );
}

/* --------------------------------------------------------- aggregate table */

export const moneyHeader = (label: string) => `${label} (천원)`;

/**
 * Column set shared by 전국(부문/팀) and 팀(OFC) comparison tables so the same
 * metric always sits in the same place and carries the same unit.
 */
export function aggregateColumns({
  firstHeader,
  index,
  showOfcCount,
  showStoreCount = true,
  variant = "full",
}: {
  firstHeader: string;
  index: ComparisonIndex;
  showOfcCount?: boolean;
  showStoreCount?: boolean;
  /** "slim" keeps only the headline metrics so the table fits a half-width card. */
  variant?: "full" | "slim";
}): Column<AggregateMetric>[] {
  const columns: Column<AggregateMetric>[] = [
    {
      key: "label",
      header: firstHeader,
      align: "left",
      sticky: true,
      width: variant === "slim" ? 148 : 168,
      sortValue: (row) => row.label,
      render: (row) => <span className="cell-strong">{row.label}</span>,
    },
  ];

  if (showStoreCount) {
    columns.push({
      key: "stores",
      header: "점포",
      align: "right",
      width: 70,
      sortValue: (row) => row.storeCount,
      render: (row) => formatNumber(row.storeCount),
    });
  }
  if (showOfcCount) {
    columns.push({
      key: "ofcs",
      header: "OFC",
      align: "right",
      width: 66,
      sortValue: (row) => row.ofcCount,
      render: (row) => formatNumber(row.ofcCount),
    });
  }

  columns.push(
    {
      key: "sales",
      header: variant === "slim" ? moneyHeader("총매출") : moneyHeader("행사 총매출"),
      headerTitle: "행사기간 누계 매출 (단위: 천원)",
      align: "right",
      sortValue: (row) => row.eventSalesTotal,
      render: (row) => formatWonThousand(row.eventSalesTotal),
    },
    {
      key: "daily",
      header: variant === "slim" ? moneyHeader("일매출") : moneyHeader("행사 일매출"),
      headerTitle: "행사 총매출 ÷ 영업일수 (단위: 천원)",
      align: "right",
      sortValue: (row) => row.eventDailySales,
      render: (row) => formatWonThousand(row.eventDailySales, 1),
    },
    {
      key: "prev",
      header: variant === "slim" ? "직전 대비" : "직전전단 대비",
      headerTitle: "행사 총매출을 직전전단 총매출과 비교한 증감률",
      align: "right",
      sortValue: (row) => previousDeltaFor(index, row),
      render: (row) => <Delta value={previousDeltaFor(index, row)} />,
    },
  );

  if (variant === "slim") {
    columns.push({
      key: "focus",
      header: "중점 취급률",
      align: "right",
      sortValue: (row) => row.focusHandlingRate,
      render: (row) => formatPercent(row.focusHandlingRate),
    });
    return columns;
  }

  columns.push(
    {
      key: "freshEvent",
      header: moneyHeader("신선 행사 일매출"),
      align: "right",
      sortValue: (row) => row.freshEventDailySales,
      render: (row) => formatWonThousand(row.freshEventDailySales, 1),
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
      headerTitle: "신선 행사 일매출 ÷ 신선 전체 일매출",
      align: "right",
      sortValue: (row) => row.eventFreshComposition,
      render: (row) => formatPercent(row.eventFreshComposition),
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
      headerTitle: "중점상품 취급률 기준을 넘은 점포 수",
      align: "right",
      width: 90,
      sortValue: (row) => row.focusAchievedStores,
      render: (row) => (
        <>
          {formatNumber(row.focusAchievedStores)}
          <span className="muted"> / {formatNumber(row.storeCount)}</span>
        </>
      ),
    },
    {
      key: "cost",
      header: moneyHeader("총매입원가"),
      align: "right",
      sortValue: (row) => row.purchaseCostTotal,
      render: (row) => formatWonThousand(row.purchaseCostTotal),
    },
    {
      key: "days",
      header: "영업일수",
      align: "right",
      width: 78,
      sortValue: (row) => row.operatingDays,
      render: (row) => formatNumber(row.operatingDays),
    },
  );

  return columns;
}

/* ------------------------------------------------------------ misc helpers */

export function LegendRow({ children }: { children: ReactNode }) {
  return <div className="chart-legend">{children}</div>;
}
