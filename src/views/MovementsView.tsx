import { useMemo, useState } from "react";
import type { MovementRecord } from "../domain/types";
import type { RowFilters } from "../api";
import { fetchMovements } from "../api";
import { useResource } from "../useResource";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  MetaItem,
  PageHeader,
  SearchInput,
  SectionCard,
} from "../ui";
import { IconMovement } from "../ui/icons";
import { formatNumber } from "../view-models/format";

const text = (value: unknown) => (value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));

/** 구분 is 회송 or 교환; colour them differently so a list of both stays readable. */
function kindTone(kind: string) {
  if (kind.includes("회송")) return "danger" as const;
  if (kind.includes("교환")) return "info" as const;
  return "neutral" as const;
}

export function MovementsView() {
  const [filters, setFilters] = useState<RowFilters>({});
  const [applied, setApplied] = useState<RowFilters>({});
  const [query, setQuery] = useState("");

  const { data, error, loading, reload } = useResource(
    () => fetchMovements(applied),
    `movements:${JSON.stringify(applied)}`,
  );

  // The app has answered this payload under both names across versions.
  const records: MovementRecord[] = useMemo(() => data?.records ?? data?.data ?? [], [data]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((record) =>
      [record.상품코드, record.상품명, record.협력사명, record.센터명, record.사유]
        .map(text)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [records, query]);

  if (loading && !data) return <LoadingState label="회송/교환 내역을 불러오는 중" />;
  if (error) {
    return (
      <ErrorState
        title="회송/교환 내역을 불러올 수 없습니다"
        description={error}
        actions={<Button onClick={reload}>다시 시도</Button>}
      />
    );
  }

  return (
    <div className="page">
      <PageHeader
        icon={<IconMovement size={20} aria-hidden />}
        title="회송 / 교환"
        description="검품 앱이 기록한 회송·교환 원본 내역입니다."
        meta={<MetaItem label="건수">{formatNumber(records.length)}</MetaItem>}
        actions={
          <Button onClick={reload} loading={loading}>
            새로 고침
          </Button>
        }
      />

      <SectionCard title="조회 조건">
        <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
          <Field label="작업기준일/CSV 식별값">
            <Input value={filters.jobKey ?? ""} onChange={(event) => setFilters({ ...filters, jobKey: event.target.value })} />
          </Field>
          <Field label="날짜">
            <Input type="date" value={filters.date ?? ""} onChange={(event) => setFilters({ ...filters, date: event.target.value })} />
          </Field>
          <Field label="filterMode">
            <Input
              value={filters.filterMode ?? ""}
              placeholder="current | all"
              onChange={(event) => setFilters({ ...filters, filterMode: event.target.value })}
            />
          </Field>
          <Button variant="primary" onClick={() => setApplied({ ...filters })}>
            조회
          </Button>
        </div>
      </SectionCard>

      <SectionCard flush>
        <div className="table-toolbar">
          <div className="table-toolbar-group">
            <SearchInput label="검색" value={query} onChange={setQuery} placeholder="상품, 협력사, 사유" width={280} />
            <span className="muted">{formatNumber(filtered.length)}건</span>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>구분</th>
                <th>센터</th>
                <th>상품코드</th>
                <th>상품명</th>
                <th>협력사</th>
                <th style={{ textAlign: "right" }}>수량</th>
                <th>사유</th>
                <th>처리상태</th>
                <th>작성일시</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((record, index) => (
                <tr key={`${text(record.상품코드)}-${record.__rowNumber ?? index}`}>
                  <td>
                    <Badge tone={kindTone(text(record.구분))} size="sm">
                      {text(record.구분) || "-"}
                    </Badge>
                  </td>
                  <td>{text(record.센터명) || "-"}</td>
                  <td className="mono">{text(record.상품코드)}</td>
                  <td title={text(record.상품명)}>{text(record.상품명)}</td>
                  <td title={text(record.협력사명)}>{text(record.협력사명)}</td>
                  <td className="num" style={{ textAlign: "right" }}>{formatNumber(Number(record.수량) || 0)}</td>
                  <td title={text(record.사유)}>{text(record.사유) || <span className="muted">-</span>}</td>
                  <td>{text(record.처리상태) || <span className="muted">-</span>}</td>
                  <td className="muted">{text(record.작성일시)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <EmptyState title="회송/교환 내역이 없습니다" inline />}
        </div>
      </SectionCard>
    </div>
  );
}
