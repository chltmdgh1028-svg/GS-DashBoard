import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CenterStatus } from "../domain/types";
import { fetchOverview } from "../api";
import { useResource } from "../useResource";
import {
  Button,
  DefinitionList,
  ErrorState,
  HealthBadge,
  LoadingState,
  MetaItem,
  PageHeader,
  SectionCard,
} from "../ui";
import { IconCenter } from "../ui/icons";
import { formatNumber, formatPercent, formatRelativeTime, formatSignedPoint } from "../view-models/format";

export function CentersView({ date }: { date: string }) {
  const { data, error, loading, reload } = useResource(() => fetchOverview(date), `overview:${date}`);
  const [selected, setSelected] = useState<string>();

  if (loading && !data) return <LoadingState label="센터 현황을 불러오는 중" />;
  if (error) {
    return (
      <ErrorState
        title="센터 현황을 불러올 수 없습니다"
        description={error}
        actions={<Button onClick={reload}>다시 시도</Button>}
      />
    );
  }
  if (!data) return null;

  const centers = data.centers;
  const active = centers.find((row) => row.center === selected) ?? centers[0];

  function toneFor(row: CenterStatus) {
    if (row.inspectionRate >= row.inspectionTarget) return "var(--pos)";
    if (row.inspectionRate >= row.inspectionTarget - 0.1) return "var(--warn)";
    return "var(--neg)";
  }

  return (
    <div className="page">
      <PageHeader
        icon={<IconCenter size={20} aria-hidden />}
        title="센터"
        description="센터별 검품률을 목표와 비교하고, 선택한 센터의 상세 지표를 확인합니다."
        meta={
          <>
            <MetaItem label="운영일">{data.businessDate}</MetaItem>
            <MetaItem label="센터">{formatNumber(centers.length)}개</MetaItem>
            <MetaItem label="목표 검품률">{formatPercent(data.totals.inspectionTarget, 0)}</MetaItem>
          </>
        }
        actions={
          <Button onClick={reload} loading={loading}>
            새로 고침
          </Button>
        }
      />

      <div className="grid-2" data-ratio="wide-left">
        <SectionCard title="센터별 검품률" subtitle="막대를 클릭하면 상세가 바뀝니다">
          <div className="chart-wrap" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={centers} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="center" tickLine={false} axisLine={false} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  domain={[0, 1]}
                  tickFormatter={(value: number) => formatPercent(value, 0)}
                />
                <Tooltip
                  formatter={(value) => [formatPercent(Number(value)), "검품률"] as [string, string]}
                  labelFormatter={(label) => String(label)}
                />
                <Bar
                  dataKey="inspectionRate"
                  name="검품률"
                  radius={[2, 2, 0, 0]}
                  onClick={(entry: unknown) => {
                    const center = (entry as { payload?: { center?: string } })?.payload?.center;
                    if (center) setSelected(center);
                  }}
                >
                  {centers.map((row) => (
                    <Cell key={row.center} fill={toneFor(row)} cursor="pointer" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard
          title={active ? active.center : "센터"}
          subtitle="상세 지표"
          actions={active ? <HealthBadge health={active.health} /> : undefined}
        >
          {active ? (
            <DefinitionList
              items={[
                { term: "검품률", value: `${formatPercent(active.inspectionRate)} (목표 대비 ${formatSignedPoint(active.inspectionRate - active.inspectionTarget)})` },
                { term: "입고 수량", value: `${formatNumber(active.inboundQty)}개` },
                { term: "검품 수량", value: `${formatNumber(active.inspectionQty)}개` },
                { term: "불량 수량", value: `${formatNumber(active.defectQty)}개` },
                { term: "불량률", value: formatPercent(active.defectRate) },
                { term: "미처리 예외", value: `${formatNumber(active.openExceptions)}건` },
                { term: "기한 초과", value: `${formatNumber(active.overdueExceptions)}건` },
                { term: "검품 담당", value: `${formatNumber(active.inspectorCount)}명` },
                { term: "최근 검품", value: formatRelativeTime(active.lastActivityAt) },
              ]}
            />
          ) : (
            <p className="muted">표시할 센터가 없습니다.</p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
