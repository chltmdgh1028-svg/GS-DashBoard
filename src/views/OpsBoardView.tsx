import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CenterStatus } from "../domain/types";
import { fetchOverview } from "../api";
import { useResource } from "../useResource";
import type { Column } from "../ui";
import {
  Button,
  DataTable,
  ErrorState,
  HealthBadge,
  KpiCard,
  KpiRow,
  LoadingState,
  MetaItem,
  MeterCell,
  Notice,
  PageHeader,
  SectionCard,
} from "../ui";
import { IconDefect, IconExceptionQueue, IconInfo, IconOpsBoard, IconOverdue } from "../ui/icons";
import { formatNumber, formatPercent, formatRelativeTime } from "../view-models/format";

/** Below target is a warning, far below is an error - the same thresholds the server uses. */
function rateTone(status: CenterStatus) {
  if (status.inspectionRate >= status.inspectionTarget) return "success" as const;
  if (status.inspectionRate >= status.inspectionTarget - 0.1) return "warning" as const;
  return "danger" as const;
}

export function OpsBoardView({ date, onOpenQueue }: { date: string; onOpenQueue: () => void }) {
  const { data, error, loading, reload } = useResource(() => fetchOverview(date), `overview:${date}`);

  if (loading && !data) return <LoadingState label="운영 현황을 불러오는 중" />;
  if (error) return <ErrorState title="운영 현황을 불러올 수 없습니다" description={error} actions={<Button onClick={reload}>다시 시도</Button>} />;
  if (!data) return null;

  const { totals } = data;

  const columns: Column<CenterStatus>[] = [
    {
      key: "center",
      header: "센터",
      sticky: true,
      width: 130,
      render: (row) => <strong>{row.center}</strong>,
      sortValue: (row) => row.center,
    },
    {
      key: "health",
      header: "상태",
      width: 110,
      render: (row) => (
        <HealthBadge
          health={row.health}
          title={row.overdueExceptions > 0 ? `기한 초과 ${row.overdueExceptions}건` : undefined}
        />
      ),
      sortValue: (row) => ({ error: 0, warning: 1, normal: 2 })[row.health],
    },
    {
      key: "inspectionRate",
      header: "검품률",
      headerTitle: `목표 ${formatPercent(totals.inspectionTarget, 0)}`,
      width: 150,
      render: (row) => <MeterCell value={row.inspectionRate} tone={rateTone(row)} />,
      sortValue: (row) => row.inspectionRate,
    },
    {
      key: "inboundQty",
      header: "입고",
      headerTitle: "입고 수량 (개)",
      align: "right",
      width: 90,
      render: (row) => <span className="num">{formatNumber(row.inboundQty)}</span>,
      sortValue: (row) => row.inboundQty,
    },
    {
      key: "inspectionQty",
      header: "검품",
      headerTitle: "검품 수량 (개)",
      align: "right",
      width: 90,
      render: (row) => <span className="num">{formatNumber(row.inspectionQty)}</span>,
      sortValue: (row) => row.inspectionQty,
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
      header: "미처리",
      headerTitle: "처리 대기 중인 예외 건수",
      align: "right",
      width: 90,
      render: (row) => <span className="num">{formatNumber(row.openExceptions)}</span>,
      sortValue: (row) => row.openExceptions,
    },
    {
      key: "overdueExceptions",
      header: "기한 초과",
      align: "right",
      width: 100,
      render: (row) =>
        row.overdueExceptions > 0 ? (
          <strong className="num" style={{ color: "var(--neg)" }}>
            {formatNumber(row.overdueExceptions)}
          </strong>
        ) : (
          <span className="muted">0</span>
        ),
      sortValue: (row) => row.overdueExceptions,
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
        icon={<IconOpsBoard size={20} aria-hidden />}
        title="운영 보드"
        description="운영일 기준 검품 진행 상황과 즉시 조치가 필요한 항목입니다."
        meta={
          <>
            <MetaItem label="운영일">{data.businessDate}</MetaItem>
            <MetaItem label="범위">{data.scope.label}</MetaItem>
            <MetaItem label="기준 시각">{formatRelativeTime(data.asOf)}</MetaItem>
          </>
        }
        actions={
          <Button onClick={reload} loading={loading}>
            새로 고침
          </Button>
        }
      />

      {data.seeded && (
        <Notice tone="info" icon={<IconInfo size={16} aria-hidden />} title="시드 데이터">
          운영 검품 피드가 아직 연결되지 않아 내장 시드 데이터를 표시하고 있습니다. 운영일별로 동일한 값이
          재현되므로 화면과 집계 검증에는 사용할 수 있습니다.
        </Notice>
      )}

      {data.overdueExceptions > 0 && (
        <Notice
          tone="danger"
          icon={<IconOverdue size={16} aria-hidden />}
          title={`처리 기한이 지난 예외 ${formatNumber(data.overdueExceptions)}건`}
          actions={
            <Button variant="primary" size="sm" onClick={onOpenQueue}>
              예외 처리로 이동
            </Button>
          }
        >
          기한 초과 건은 센터 상태를 즉시 <b>조치 필요</b>로 바꿉니다.
        </Notice>
      )}

      <KpiRow cols={6}>
        <KpiCard
          label="검품률"
          value={formatPercent(totals.inspectionRate)}
          hint={`입고 ${formatNumber(totals.inboundQty)}개 중 검품 ${formatNumber(totals.inspectionQty)}개`}
          emphasis
          note={`목표 ${formatPercent(totals.inspectionTarget, 0)}`}
        />
        <KpiCard label="입고" value={formatNumber(totals.inboundQty)} unit="개" />
        <KpiCard label="검품" value={formatNumber(totals.inspectionQty)} unit="개" />
        <KpiCard
          label="불량률"
          value={formatPercent(totals.defectRate)}
          hint={`불량 ${formatNumber(totals.defectQty)}개 / 검품 ${formatNumber(totals.inspectionQty)}개`}
        />
        <KpiCard label="반품" value={formatNumber(totals.returnQty)} unit="개" />
        <KpiCard label="교환" value={formatNumber(totals.exchangeQty)} unit="개" />
      </KpiRow>

      <KpiRow cols={4}>
        <KpiCard
          label="미처리 예외"
          value={formatNumber(data.openExceptions)}
          unit="건"
          emphasis={data.openExceptions > 0}
          footer={
            <Button variant="ghost" size="sm" icon={<IconExceptionQueue size={13} aria-hidden />} onClick={onOpenQueue}>
              처리하기
            </Button>
          }
        />
        <KpiCard label="기한 초과" value={formatNumber(data.overdueExceptions)} unit="건" />
        <KpiCard label="긴급" value={formatNumber(data.criticalExceptions)} unit="건" hint="불량률이 임계치를 넘은 건" />
        <KpiCard label="검품 SKU" value={formatNumber(totals.inspectedSkus)} unit="종" />
      </KpiRow>

      <SectionCard
        title="시간대별 검품 추이"
        subtitle="검품 수량과 불량 수량"
        icon={<IconDefect size={16} aria-hidden />}
      >
        <div className="chart-wrap" style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.hourly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="hour" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(value: number) => formatNumber(value)} />
              <Tooltip
                formatter={(value, name) => [formatNumber(Number(value)), String(name)] as [string, string]}
                labelFormatter={(label) => `${String(label)} 기준`}
              />
              <Legend />
              <Bar dataKey="inspectionQty" name="검품 수량" fill="var(--c-primary-500)" radius={[2, 2, 0, 0]} />
              <Bar dataKey="defectQty" name="불량 수량" fill="var(--neg)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard title="센터별 현황" subtitle={`${data.centers.length}개 센터`} flush>
        <DataTable
          rows={data.centers}
          columns={columns}
          rowKey={(row) => row.center}
          rowTone={(row) => (row.health === "error" ? "attention" : undefined)}
          defaultSort={{ key: "health", direction: "asc" }}
          autoHeight
          emptyTitle="해당 운영일의 검품 기록이 없습니다"
        />
      </SectionCard>
    </div>
  );
}
