import { useDeferredValue, useMemo, useState } from "react";
import { fetchHistory } from "../api";
import { useResource } from "../useResource";
import { Button, DataGrid, EmptyState, ErrorState, LoadingState, SearchInput } from "../ui";
import type { GridColumn } from "../ui";
import { IconHistory } from "../ui/icons";
import { formatNumber } from "../view-models/format";

type HistoryRow = Record<string, unknown>;

const text = (value: unknown) => (value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));

/** `_dateKey` is the app's sort key, not something to show. */
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
  const deferred = useDeferredValue(query);
  const { data, error, loading, reload } = useResource(() => fetchHistory(), "history");

  // The archive arrives oldest first (04/08 ... 10/22); an operator wants today on top.
  const rows = useMemo(() => {
    const list = Array.isArray(data?.data) ? (data.data as HistoryRow[]) : [];
    return list
      .filter((row) => row && typeof row === "object")
      .sort((a, b) => text(b._dateKey ?? b["일자"]).localeCompare(text(a._dateKey ?? a["일자"])));
  }, [data]);

  // Columns are whatever the archive carries, in first-seen order, so a new
  // field appears without a change here.
  const names = useMemo(() => {
    const seen: string[] = [];
    for (const row of rows) for (const key of Object.keys(row)) if (!HIDDEN.has(key) && !seen.includes(key)) seen.push(key);
    return seen;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = deferred.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => Object.values(row).some((value) => text(value).toLowerCase().includes(needle)));
  }, [rows, deferred]);

  const columns = useMemo<GridColumn<HistoryRow>[]>(
    () =>
      names.map((name, index) => ({
        key: name,
        header: name,
        title: name,
        width: index === 0 ? 88 : 140,
        align: index === 0 ? "left" : "right",
        sticky: index === 0,
        render: (row) => <span className={index === 0 ? "cell-strong" : undefined}>{cell(name, row[name]) || <span className="muted">-</span>}</span>,
      })),
    [names],
  );

  if (loading && !data) return <LoadingState label="이력을 불러오는 중" />;
  if (error) {
    return <ErrorState title="이력을 불러올 수 없습니다" description={error} actions={<Button onClick={reload}>다시 시도</Button>} />;
  }

  return (
    <div className="fill-page">
      <header className="console-head">
        <h1>
          <IconHistory size={20} aria-hidden />
          이력
          <span className="sub">일별 검품 KPI 요약 · 최신순</span>
        </h1>
        <div className="row" style={{ gap: 12 }}>
          <div className="stat-strip">
            <div className="stat">
              <span>기간</span>
              <b>
                {formatNumber(rows.length)}
                <small>일</small>
              </b>
            </div>
            {rows.length > 0 && (
              <div className="stat">
                <span>최근 일자</span>
                <b>{text(rows[0]["일자"])}</b>
              </div>
            )}
          </div>
          <Button onClick={reload} loading={loading}>
            새로 고침
          </Button>
        </div>
      </header>

      <div className="console-body">
        <div className="console-main">
          <div className="filter-bar">
            <div className="filter-row">
              <div className="grow" style={{ minWidth: 220 }}>
                <SearchInput label="이력 검색" value={query} onChange={setQuery} placeholder="일자나 값으로 검색" />
              </div>
              <span className="muted">{formatNumber(filtered.length)}일</span>
            </div>
          </div>

          <div className="grid-card">
            {filtered.length === 0 ? (
              <EmptyState title="이력이 없습니다" />
            ) : (
              <DataGrid<HistoryRow>
                columns={columns}
                rows={filtered}
                rowKey={(row) => text(row._dateKey ?? row["일자"])}
                minWidth={Math.max(900, names.length * 140)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
