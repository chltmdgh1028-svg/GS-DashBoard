import { useMemo, useState } from "react";
import type { InspectionRecord, InspectionResult } from "../domain/types";
import { fetchInspections } from "../api";
import { useResource } from "../useResource";
import type { Column, Tone } from "../ui";
import {
  Badge,
  Button,
  DataTable,
  ErrorState,
  LoadingState,
  MetaItem,
  MeterCell,
  PageHeader,
  SearchInput,
  SectionCard,
  Segmented,
} from "../ui";
import { IconInspection, IconPhoto } from "../ui/icons";
import { formatNumber, formatPercent } from "../view-models/format";

const RESULT_META: Record<InspectionResult, { label: string; tone: Tone }> = {
  normal: { label: "정상", tone: "success" },
  defect: { label: "불량", tone: "warning" },
  return: { label: "반품", tone: "danger" },
  exchange: { label: "교환", tone: "info" },
};

type ResultFilter = "all" | InspectionResult;

const RESULT_OPTIONS: { value: ResultFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "normal", label: "정상" },
  { value: "defect", label: "불량" },
  { value: "return", label: "반품" },
  { value: "exchange", label: "교환" },
];

export function InspectionsView({ date }: { date: string }) {
  const [result, setResult] = useState<ResultFilter>("all");
  const [query, setQuery] = useState("");
  const { data, error, loading, reload } = useResource(() => fetchInspections(date), `inspections:${date}`);

  const rows = useMemo(() => {
    let records = data?.records ?? [];
    if (result !== "all") records = records.filter((record) => record.result === result);
    const needle = query.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((record) =>
      [record.productName, record.sku, record.supplier, record.inspector, record.center, record.category]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [data, result, query]);

  if (loading && !data) return <LoadingState label="검품 내역을 불러오는 중" />;
  if (error) {
    return (
      <ErrorState
        title="검품 내역을 불러올 수 없습니다"
        description={error}
        actions={<Button onClick={reload}>다시 시도</Button>}
      />
    );
  }

  const columns: Column<InspectionRecord>[] = [
    {
      key: "time",
      header: "시각",
      sticky: true,
      width: 70,
      render: (row) => <span className="num">{row.time}</span>,
      sortValue: (row) => row.time,
    },
    {
      key: "center",
      header: "센터",
      width: 110,
      render: (row) => row.center,
      sortValue: (row) => row.center,
    },
    {
      key: "product",
      header: "상품",
      width: 200,
      render: (row) => (
        <div>
          <div className="trunc" style={{ ["--trunc-w" as string]: "190px" }} title={row.productName}>
            {row.productName}
          </div>
          <span className="muted mono">
            {row.sku} · {row.category}
          </span>
        </div>
      ),
      sortValue: (row) => row.productName,
    },
    {
      key: "supplier",
      header: "협력사",
      width: 120,
      render: (row) => (
        <span className="trunc" style={{ ["--trunc-w" as string]: "110px" }} title={row.supplier}>
          {row.supplier}
        </span>
      ),
      sortValue: (row) => row.supplier,
    },
    {
      key: "inspector",
      header: "담당",
      width: 90,
      render: (row) => row.inspector,
      sortValue: (row) => row.inspector,
    },
    {
      key: "inboundQty",
      header: "입고",
      align: "right",
      width: 80,
      render: (row) => <span className="num">{formatNumber(row.inboundQty)}</span>,
      sortValue: (row) => row.inboundQty,
    },
    {
      key: "inspectionRate",
      header: "검품률",
      width: 140,
      render: (row) => (
        <MeterCell
          value={row.inspectionRate}
          tone={row.inspectionRate >= 0.9 ? "success" : row.inspectionRate >= 0.8 ? "warning" : "danger"}
        />
      ),
      sortValue: (row) => row.inspectionRate,
    },
    {
      key: "defectQty",
      header: "불량",
      align: "right",
      width: 80,
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
      key: "result",
      header: "판정",
      width: 80,
      render: (row) => (
        <Badge tone={RESULT_META[row.result].tone} size="sm">
          {RESULT_META[row.result].label}
        </Badge>
      ),
      sortValue: (row) => RESULT_META[row.result].label,
    },
    {
      key: "defectReasons",
      header: "불량 사유",
      width: 180,
      render: (row) =>
        row.defectReasons.length ? (
          <span className="trunc" style={{ ["--trunc-w" as string]: "170px" }} title={row.defectReasons.join(", ")}>
            {row.defectReasons.join(", ")}
          </span>
        ) : (
          <span className="muted">-</span>
        ),
      sortValue: (row) => row.defectReasons.join(", "),
    },
    {
      key: "photoCount",
      header: "사진",
      align: "right",
      width: 80,
      render: (row) =>
        row.photoCount === 0 && row.defectQty > 0 ? (
          <Badge tone="warning" size="sm" icon={<IconPhoto size={12} aria-hidden />} title="불량 판정 건에 증빙 사진이 없습니다">
            없음
          </Badge>
        ) : (
          <span className="num">{formatNumber(row.photoCount)}</span>
        ),
      sortValue: (row) => row.photoCount,
    },
  ];

  return (
    <div className="page">
      <PageHeader
        icon={<IconInspection size={20} aria-hidden />}
        title="검품 내역"
        description="운영일에 기록된 검품 건 전체입니다."
        meta={
          <>
            <MetaItem label="운영일">{data?.businessDate ?? date}</MetaItem>
            <MetaItem label="범위">{data?.scope.label ?? "-"}</MetaItem>
            <MetaItem label="표시">{formatNumber(rows.length)}건</MetaItem>
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
          rowKey={(row) => row.id}
          rowTone={(row) => (row.defectRate >= 0.15 ? "attention" : undefined)}
          density="compact"
          autoHeight
          emptyTitle="조건에 맞는 검품 건이 없습니다"
          toolbar={
            <div className="table-toolbar">
              <div className="table-toolbar-group">
                <Segmented label="판정 필터" value={result} options={RESULT_OPTIONS} onChange={setResult} />
              </div>
              <div className="spacer" />
              <div className="table-toolbar-group">
                <SearchInput
                  label="검품 검색"
                  value={query}
                  onChange={setQuery}
                  placeholder="상품, SKU, 협력사, 담당"
                  width={260}
                />
              </div>
            </div>
          }
        />
      </SectionCard>
    </div>
  );
}
