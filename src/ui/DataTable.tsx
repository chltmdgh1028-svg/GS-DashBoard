import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { IconArrowDown, IconArrowUp, IconEmpty, IconSortable } from "./icons";

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Native tooltip on the header cell - use for unit or definition notes. */
  headerTitle?: string;
  align?: "left" | "right" | "center";
  render: (row: T, index: number) => ReactNode;
  /** Providing this makes the column sortable. */
  sortValue?: (row: T) => number | string | undefined;
  width?: number;
  /** Pin the column while the table scrolls horizontally (first column only). */
  sticky?: boolean;
  footer?: ReactNode;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string;
  rowTone?: (row: T) => "attention" | undefined;
  density?: "default" | "compact";
  defaultSort?: { key: string; direction: "asc" | "desc" };
  loading?: boolean;
  autoHeight?: boolean;
  maxHeight?: number | string;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Rendered above the table: filters, search, counts. */
  toolbar?: ReactNode;
  caption?: string;
}

type SortState = { key: string; direction: "asc" | "desc" } | undefined;

function compare(a: number | string | undefined, b: number | string | undefined) {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // blanks always sink to the bottom
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "ko");
}

/**
 * The single table used across the dashboard.
 *
 * Deliberate choices:
 *  - header is sticky and the body scrolls, so column meaning never scrolls
 *    away on a 1000-row store list;
 *  - numbers are right aligned with tabular figures, text is left aligned;
 *  - rows are separated by a hairline instead of zebra striping - striping
 *    fights with the status colours we actually want to notice;
 *  - a clickable row is focusable and responds to Enter/Space.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  selectedKey,
  rowTone,
  density = "default",
  defaultSort,
  loading = false,
  autoHeight = false,
  maxHeight,
  emptyTitle = "표시할 데이터가 없습니다",
  emptyDescription,
  toolbar,
  caption,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>(defaultSort);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((item) => item.key === sort.key);
    if (!column?.sortValue) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => factor * compare(column.sortValue?.(a), column.sortValue?.(b)));
  }, [rows, columns, sort]);

  function toggleSort(column: Column<T>) {
    if (!column.sortValue) return;
    setSort((previous) => {
      if (previous?.key !== column.key) return { key: column.key, direction: "desc" };
      if (previous.direction === "desc") return { key: column.key, direction: "asc" };
      return defaultSort && defaultSort.key !== column.key ? defaultSort : undefined;
    });
  }

  const hasFooter = columns.some((column) => column.footer != null);
  // Short tables grow with the page instead of opening a second scrollbar.
  const growsWithPage = autoHeight || rows.length <= 12;

  return (
    <div className="stack" data-gap="sm">
      {toolbar && <div className="table-toolbar">{toolbar}</div>}
      <div
        className="table-scroll"
        data-auto-height={growsWithPage || undefined}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="data" data-density={density}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((column) => {
                const sorted = sort?.key === column.key;
                const alignClass = column.align === "right" ? "num" : column.align === "center" ? "center" : "";
                return (
                  <th
                    key={column.key}
                    className={`${alignClass} ${column.sticky ? "sticky-col" : ""}`.trim() || undefined}
                    style={column.width ? { width: column.width, minWidth: column.width } : undefined}
                    title={column.headerTitle}
                    aria-sort={sorted ? (sort?.direction === "asc" ? "ascending" : "descending") : undefined}
                    scope="col"
                  >
                    {column.sortValue ? (
                      <button type="button" className="sorter" onClick={() => toggleSort(column)}>
                        {sorted ? (
                          sort?.direction === "asc" ? (
                            <IconArrowUp size={12} aria-hidden />
                          ) : (
                            <IconArrowDown size={12} aria-hidden />
                          )
                        ) : (
                          <IconSortable size={12} aria-hidden />
                        )}
                        {column.header}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 6 }, (_, index) => (
                <tr key={`skeleton-${index}`}>
                  {columns.map((column) => (
                    <td key={column.key}>
                      <div className="skeleton" style={{ height: 12 }} />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              sortedRows.map((row, index) => {
                const key = rowKey(row, index);
                return (
                  <tr
                    key={key}
                    data-clickable={onRowClick ? "true" : undefined}
                    data-selected={selectedKey != null && selectedKey === key ? "true" : undefined}
                    data-tone={rowTone?.(row)}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={
                          `${column.align === "right" ? "num" : column.align === "center" ? "center" : ""} ${
                            column.sticky ? "sticky-col" : ""
                          }`.trim() || undefined
                        }
                      >
                        {column.render(row, index)}
                      </td>
                    ))}
                  </tr>
                );
              })}
          </tbody>
          {hasFooter && !loading && sortedRows.length > 0 && (
            <tfoot>
              <tr>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={
                      `${column.align === "right" ? "num" : column.align === "center" ? "center" : ""} ${
                        column.sticky ? "sticky-col" : ""
                      }`.trim() || undefined
                    }
                  >
                    {column.footer}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
        {!loading && sortedRows.length === 0 && (
          <div className="state" data-inline="true">
            <span className="state-icon">
              <IconEmpty size={20} aria-hidden />
            </span>
            <strong>{emptyTitle}</strong>
            {emptyDescription && <p>{emptyDescription}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Cell helper: clamp a long name and expose the full value as a tooltip. */
export function TextCell({ value, width = 200, strong }: { value?: string; width?: number; strong?: boolean }) {
  if (!value) return <span className="muted">-</span>;
  return (
    <span
      className={strong ? "trunc cell-strong" : "trunc"}
      style={{ ["--trunc-w" as string]: `${width}px` }}
      title={value}
    >
      {value}
    </span>
  );
}

/** Cell helper: percentage with an inline bar, for rate columns. */
export function MeterCell({ value, tone }: { value?: number; tone?: "success" | "warning" | "danger" }) {
  if (value == null) return <span className="muted">-</span>;
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="meter">
      <div className="meter-track">
        <div className="meter-fill" data-tone={tone} style={{ width: `${pct}%` }} />
      </div>
      <span className="meter-value">{`${pct.toFixed(0)}%`}</span>
    </div>
  );
}
