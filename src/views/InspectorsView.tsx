import type { InspectorLoad } from "../domain/types";
import { fetchInspectors } from "../api";
import { useResource } from "../useResource";
import type { Column } from "../ui";
import {
  Button,
  DataTable,
  ErrorState,
  LoadingState,
  MetaItem,
  PageHeader,
  SectionCard,
} from "../ui";
import { IconInspector } from "../ui/icons";
import { formatNumber, formatPercent, formatRelativeTime } from "../view-models/format";

export function InspectorsView({ date }: { date: string }) {
  const { data, error, loading, reload } = useResource(() => fetchInspectors(date), `inspectors:${date}`);

  if (loading && !data) return <LoadingState label="담당별 현황을 불러오는 중" />;
  if (error) {
    return (
      <ErrorState
        title="담당별 현황을 불러올 수 없습니다"
        description={error}
        actions={<Button onClick={reload}>다시 시도</Button>}
      />
    );
  }

  const rows = data?.inspectors ?? [];

  const columns: Column<InspectorLoad>[] = [
    {
      key: "inspector",
      header: "담당",
      sticky: true,
      width: 110,
      render: (row) => <strong>{row.inspector}</strong>,
      sortValue: (row) => row.inspector,
    },
    {
      key: "center",
      header: "센터",
      width: 120,
      render: (row) => row.center,
      sortValue: (row) => row.center,
    },
    {
      key: "inspections",
      header: "검품 건수",
      align: "right",
      width: 100,
      render: (row) => <span className="num">{formatNumber(row.inspections)}</span>,
      sortValue: (row) => row.inspections,
    },
    {
      key: "inspectionQty",
      header: "검품 수량",
      headerTitle: "검품 수량 (개)",
      align: "right",
      width: 110,
      render: (row) => <span className="num">{formatNumber(row.inspectionQty)}</span>,
      sortValue: (row) => row.inspectionQty,
    },
    {
      key: "defectQty",
      header: "불량 수량",
      align: "right",
      width: 100,
      render: (row) => <span className="num">{formatNumber(row.defectQty)}</span>,
      sortValue: (row) => row.defectQty,
    },
    {
      key: "defectRate",
      header: "불량률",
      align: "right",
      width: 90,
      render: (row) => <span className="num">{formatPercent(row.defectRate)}</span>,
      sortValue: (row) => row.defectRate,
    },
    {
      key: "openExceptions",
      header: "미처리 예외",
      align: "right",
      width: 110,
      render: (row) => <span className="num">{formatNumber(row.openExceptions)}</span>,
      sortValue: (row) => row.openExceptions,
    },
    {
      key: "lastActivityAt",
      header: "최근 검품",
      align: "right",
      width: 110,
      render: (row) => <span className="muted">{formatRelativeTime(row.lastActivityAt)}</span>,
      sortValue: (row) => row.lastActivityAt,
    },
  ];

  return (
    <div className="page">
      <PageHeader
        icon={<IconInspector size={20} aria-hidden />}
        title="검품 담당"
        description="담당별 검품 처리량과 불량률입니다. 불량률만으로 평가하지 않도록 처리량과 함께 봅니다."
        meta={
          <>
            <MetaItem label="운영일">{data?.businessDate ?? date}</MetaItem>
            <MetaItem label="범위">{data?.scope.label ?? "-"}</MetaItem>
            <MetaItem label="담당">{formatNumber(rows.length)}명</MetaItem>
          </>
        }
        actions={
          <Button onClick={reload} loading={loading}>
            새로 고침
          </Button>
        }
      />

      <SectionCard flush>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => `${row.center}:${row.inspector}`}
          defaultSort={{ key: "inspectionQty", direction: "desc" }}
          density="compact"
          autoHeight
          emptyTitle="해당 운영일의 검품 기록이 없습니다"
        />
      </SectionCard>
    </div>
  );
}
