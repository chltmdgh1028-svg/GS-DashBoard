import { useMemo, useState } from "react";
import { fetchHistory } from "../api";
import { useResource } from "../useResource";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  MetaItem,
  PageHeader,
  SearchInput,
  SectionCard,
} from "../ui";
import { IconHistory } from "../ui/icons";
import { formatNumber } from "../view-models/format";

const text = (value: unknown) => (value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));

/** `_dateKey` is the app's sort key, not something to show; the rest are shown as received. */
const HIDDEN = new Set(["_dateKey"]);

/** Columns that carry a 0..1 ratio on production (검품률, SKU 커버리지). */
const isRatio = (column: string) => /률|커버리지/.test(column);

function cell(column: string, value: unknown) {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    if (isRatio(column) && value >= 0 && value <= 1) return `${(value * 100).toFixed(1)}%`;
    return formatNumber(value);
  }
  return text(value);
}

export function HistoryView() {
  const [query, setQuery] = useState("");
  const { data, error, loading, reload } = useResource(() => fetchHistory(), "history");

  // The archive arrives oldest first (04/08 ... 10/22); an operator wants today on top.
  const rows = useMemo(() => {
    const list = Array.isArray(data?.data) ? (data.data as Record<string, unknown>[]) : [];
    return list
      .filter((row) => row && typeof row === "object")
      .sort((a, b) => text(b._dateKey ?? b["일자"]).localeCompare(text(a._dateKey ?? a["일자"])));
  }, [data]);

  // History columns are whatever the archive carries; infer them in first-seen
  // order so a new field appears without a change here.
  const columns = useMemo(() => {
    const seen: string[] = [];
    for (const row of rows) for (const key of Object.keys(row)) if (!HIDDEN.has(key) && !seen.includes(key)) seen.push(key);
    return seen;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => Object.values(row).some((value) => text(value).toLowerCase().includes(needle)));
  }, [rows, query]);

  if (loading && !data) return <LoadingState label="이력을 불러오는 중" />;
  if (error) {
    return (
      <ErrorState title="이력을 불러올 수 없습니다" description={error} actions={<Button onClick={reload}>다시 시도</Button>} />
    );
  }

  return (
    <div className="page">
      <PageHeader
        icon={<IconHistory size={20} aria-hidden />}
        title="이력"
        description="검품 앱의 이력 아카이브입니다."
        meta={<MetaItem label="건수">{formatNumber(rows.length)}</MetaItem>}
        actions={
          <Button onClick={reload} loading={loading}>
            새로 고침
          </Button>
        }
      />

      <SectionCard flush>
        <div className="table-toolbar">
          <div className="table-toolbar-group">
            <SearchInput label="이력 검색" value={query} onChange={setQuery} placeholder="모든 항목에서 검색" width={280} />
            <span className="muted">{formatNumber(filtered.length)}건</span>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} style={{ textAlign: column === "일자" ? "left" : "right" }}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td
                      key={column}
                      className="num"
                      title={text(row[column])}
                      style={{ textAlign: column === "일자" ? "left" : "right" }}
                    >
                      {cell(column, row[column]) || <span className="muted">-</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <EmptyState title="이력이 없습니다" inline />}
          {filtered.length > 500 && <p className="muted">상위 500건만 표시합니다. 검색으로 범위를 좁히세요.</p>}
        </div>
      </SectionCard>
    </div>
  );
}
