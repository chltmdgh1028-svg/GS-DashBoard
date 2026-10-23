import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { memo } from "react";
import { EmptyState } from "./layout";
import { IconArrowDown, IconArrowUp, IconSortable } from "./icons";

export interface GridColumn<T> {
  key: string;
  header: ReactNode;
  /** Native tooltip on the header: a unit or a definition. */
  title?: string;
  /** Pixels. Leave one column without a width so it absorbs the slack. */
  width?: number;
  align?: "left" | "right" | "center";
  /** Present = the header sorts by this key. */
  sortKey?: string;
  /** Pin to the left edge while the table scrolls sideways. */
  sticky?: boolean;
  render: (row: T) => ReactNode;
}

export interface GridSort {
  key: string;
  dir: "asc" | "desc";
}

export interface GridGroup<T> {
  key: string;
  rows: T[];
}

interface DataGridProps<T, G extends GridGroup<T>> {
  columns: GridColumn<T>[];
  /** Flat rows. Ignored when `groups` is given. */
  rows?: T[];
  groups?: G[];
  rowKey: (row: T) => string;
  selectedKey?: string;
  onSelect?: (row: T) => void;
  sort?: GridSort;
  onSort?: (key: string) => void;
  collapsed?: ReadonlySet<string>;
  onToggleGroup?: (key: string) => void;
  renderGroup?: (group: G, collapsed: boolean) => ReactNode;
  rowTone?: (row: T) => "attention" | undefined;
  /** Rows de-emphasised as "nothing done yet". */
  rowDim?: (row: T) => boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Minimum table width in px before the area scrolls sideways. */
  minWidth?: number;
  scrollerRef?: RefObject<HTMLDivElement | null>;
}

const alignClass = (align?: "left" | "right" | "center") => (align === "right" ? "num" : align === "center" ? "center" : "");

interface RowProps<T> {
  row: T;
  columns: GridColumn<T>[];
  selected: boolean;
  tone?: "attention";
  dim: boolean;
  onSelect?: (row: T) => void;
}

function GridRowInner<T>({ row, columns, selected, tone, dim, onSelect }: RowProps<T>) {
  function onKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (onSelect && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onSelect(row);
    }
  }

  return (
    <tr
      data-clickable={onSelect ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-tone={tone}
      data-dim={dim ? "true" : undefined}
      aria-selected={onSelect ? selected : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect ? () => onSelect(row) : undefined}
      onKeyDown={onKeyDown}
    >
      {columns.map((column) => (
        <td key={column.key} className={`${alignClass(column.align)}${column.sticky ? " sticky-col" : ""}`}>
          {column.render(row)}
        </td>
      ))}
    </tr>
  );
}

// Selecting a row must not re-render the other 1,900: only a row whose own
// props changed does, provided the caller keeps `columns` and `onSelect` stable.
const GridRow = memo(GridRowInner) as typeof GridRowInner;

/**
 * The console's table. Sticky column header, optional sticky group headers,
 * sortable columns, keyboard-selectable rows.
 *
 * Geometry matters: the scroller is the element that owns vertical scroll, so
 * `position: sticky` on the header and on a group row both resolve against it.
 * Group headers stick at `--thead-h` (just under the column header), which is
 * why that height is fixed in CSS rather than left to content.
 */
export function DataGrid<T, G extends GridGroup<T> = GridGroup<T>>({
  columns,
  rows = [],
  groups,
  rowKey,
  selectedKey,
  onSelect,
  sort,
  onSort,
  collapsed,
  onToggleGroup,
  renderGroup,
  rowTone,
  rowDim,
  emptyTitle = "표시할 데이터가 없습니다",
  emptyDescription,
  minWidth,
  scrollerRef,
}: DataGridProps<T, G>) {
  const empty = groups ? groups.every((group) => group.rows.length === 0) : rows.length === 0;

  const renderRow = (row: T) => {
    const key = rowKey(row);
    return (
      <GridRow
        key={key}
        row={row}
        columns={columns}
        selected={key === selectedKey}
        tone={rowTone?.(row)}
        dim={rowDim?.(row) ?? false}
        onSelect={onSelect}
      />
    );
  };

  return (
    <div className="grid-scroll" ref={scrollerRef}>
      {empty ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <table className="data grid" style={minWidth ? ({ ["--grid-min-w" as string]: `${minWidth}px` } as React.CSSProperties) : undefined}>
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={column.width ? { width: column.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column) => {
                const active = sort && column.sortKey && sort.key === column.sortKey;
                const Icon = !active ? IconSortable : sort.dir === "asc" ? IconArrowUp : IconArrowDown;
                return (
                  <th
                    key={column.key}
                    title={column.title}
                    className={`${alignClass(column.align)}${column.sticky ? " sticky-col" : ""}`}
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {column.sortKey && onSort ? (
                      <button type="button" className="sorter" onClick={() => onSort(column.sortKey as string)}>
                        {column.header}
                        <Icon size={12} aria-hidden />
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
            {groups
              ? groups.map((group) => {
                  const isCollapsed = collapsed?.has(group.key) ?? false;
                  return [
                    <tr
                      key={`g:${group.key}`}
                      className="group"
                      data-group-key={group.key}
                      aria-expanded={!isCollapsed}
                      onClick={onToggleGroup ? () => onToggleGroup(group.key) : undefined}
                    >
                      <td colSpan={columns.length}>{renderGroup?.(group, isCollapsed)}</td>
                    </tr>,
                    ...(isCollapsed ? [] : group.rows.map(renderRow)),
                  ];
                })
              : rows.map(renderRow)}
          </tbody>
        </table>
      )}
    </div>
  );
}
