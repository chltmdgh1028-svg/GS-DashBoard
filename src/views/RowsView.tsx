import { useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import type { InspectionRow } from "../domain/types";
import type { FilterMode } from "../api";
import { fetchRows, newQtyRequestId } from "../api";
import { photoIdsOf } from "../photos";
import {
  activeFilterCount,
  applyFilters,
  dptOf,
  EMPTY_FILTERS,
  facet,
  groupBySupplier,
  hasIssue,
  initialOf,
  jobOf,
  num,
  rateOf,
  sortRows,
  summarize,
  supplierOf,
} from "../lib/rowsModel";
import type { IssueFilter, PhotoFilter, RowFilters, SortKey, SortSpec, StatusFilter, SupplierGroup } from "../lib/rowsModel";
import { useResource } from "../useResource";
import { CorrectionDialog } from "./CorrectionDialog";
import { DETAIL_DEFAULT, DETAIL_MAX, DETAIL_MIN, RowDetail } from "./RowDetail";
import {
  Button,
  DataGrid,
  EmptyState,
  ErrorState,
  LoadingState,
  MultiSelect,
  SearchInput,
  Segmented,
  Select,
} from "../ui";
import type { GridColumn } from "../ui";
import {
  IconCamera,
  IconChevronDown,
  IconChevronRight,
  IconFilterReset,
  IconRows,
} from "../ui/icons";
import { formatNumber, formatPercent } from "../view-models/format";

const text = (value: unknown) => (value == null ? "" : String(value));

const WIDTH_KEY = "console.detailWidth";

/**
 * Widths that are not 상품명: 코드 124 + DPT 84 + 발주 72 + 검품 72 + 검품률 112 +
 * 회송 60 + 교환 60 + 불량사유 144 + 사진 64. The table never gets narrower than
 * these plus NAME_MIN, so a product name is scrolled to rather than cut off.
 */
const FIXED_WIDTH = 792;
const NAME_MIN = 300;

/** The drawer width an operator last chose. Storage can be unavailable (private window), so it only ever helps. */
function readDetailWidth() {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(stored) && stored >= DETAIL_MIN && stored <= DETAIL_MAX ? stored : DETAIL_DEFAULT;
  } catch {
    return DETAIL_DEFAULT;
  }
}

const MODE_OPTIONS: { value: FilterMode; label: string }[] = [
  { value: "current", label: "오늘 작업" },
  { value: "all", label: "전체 작업" },
];
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "done", label: "검품 완료" },
  { value: "todo", label: "미검품" },
];
const ISSUE_OPTIONS: { value: IssueFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "any", label: "이슈 있음" },
  { value: "return", label: "회송" },
  { value: "exchange", label: "교환" },
  { value: "reason", label: "불량사유" },
];
const PHOTO_OPTIONS: { value: PhotoFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "with", label: "있음" },
  { value: "without", label: "없음" },
];
const VIEW_OPTIONS: { value: "group" | "flat"; label: string }[] = [
  { value: "group", label: "협력사별" },
  { value: "flat", label: "목록" },
];

/** jobKeys look like `csv_2026-10-22_2c10b50f`; the date is what an operator recognises. */
function jobLabel(jobKey: string, count: number) {
  const date = jobKey.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  return `${date ?? jobKey} · ${formatNumber(count)}행`;
}

const rowKeyOf = (row: InspectionRow) => `${jobOf(row)}|${row.__rowNumber ?? ""}|${text(row.상품코드)}|${supplierOf(row)}`;

/** The 1,000+ row table is only readable if "nothing done yet" recedes. */
const isTodo = (row: InspectionRow) => num(row.검품수량) === 0;

export function RowsView({
  correctionsEnabled,
  correctionJobs,
  inspectionBase,
}: {
  correctionsEnabled: boolean;
  /** Jobs a correction may touch; empty means any. */
  correctionJobs: string[];
  inspectionBase: string | null;
}) {
  const [mode, setMode] = useState<FilterMode>("current");
  const [filters, setFilters] = useState<RowFilters>(EMPTY_FILTERS);
  const [view, setView] = useState<"group" | "flat">("group");
  const [groupDesc, setGroupDesc] = useState(false);
  const [sort, setSort] = useState<SortSpec>({ key: "supplier", dir: "asc" });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<InspectionRow>();
  const [correcting, setCorrecting] = useState<{ row: InspectionRow; qty: number; requestId: string }>();
  const [detailWidth, setDetailWidth] = useState(readDetailWidth);
  const scroller = useRef<HTMLDivElement>(null);

  const { data, error, loading, reload } = useResource(() => fetchRows({ filterMode: mode }), `rows:${mode}`);
  const rows = useMemo(() => data?.rows ?? [], [data]);

  const grouped = view === "group";
  const selectedKey = selected ? rowKeyOf(selected) : undefined;
  // After a correction or a conflict the table is re-read; the panel must show the new row, not the clicked copy.
  const current = useMemo(
    () => (selectedKey ? rows.find((row) => rowKeyOf(row) === selectedKey) ?? selected : undefined),
    [rows, selectedKey, selected],
  );
  const deferredQuery = useDeferredValue(filters.query);

  const jobs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(jobOf(row), (counts.get(jobOf(row)) ?? 0) + 1);
    return [...counts.entries()].filter(([key]) => key).sort(([a], [b]) => b.localeCompare(a));
  }, [rows]);

  const supplierOptions = useMemo(() => facet(rows, supplierOf, "(협력사 미지정)"), [rows]);
  const dptOptions = useMemo(() => facet(rows, dptOf, "(DPT 없음)"), [rows]);

  const filtered = useMemo(
    () => applyFilters(rows, { ...filters, query: deferredQuery }),
    [rows, filters, deferredQuery],
  );

  // Inside a supplier group every row has the same supplier, so sorting "by
  // supplier" there means nothing; fall back to the product name.
  const effectiveSort: SortSpec = useMemo(
    () => (grouped && sort.key === "supplier" ? { key: "name", dir: "asc" } : sort),
    [grouped, sort],
  );
  const sorted = useMemo(() => sortRows(filtered, effectiveSort), [filtered, effectiveSort]);
  const groups = useMemo(
    () => (grouped ? groupBySupplier(sorted, groupDesc ? "desc" : "asc") : undefined),
    [grouped, sorted, groupDesc],
  );
  const summary = useMemo(() => summarize(filtered), [filtered]);

  const filterCount = activeFilterCount(filters);
  const patch = (change: Partial<RowFilters>) => setFilters((previous) => ({ ...previous, ...change }));

  const onSort = useCallback((key: string) => {
    setSort((previous) => ({
      key: key as SortKey,
      dir: previous.key === key && previous.dir === "asc" ? "desc" : "asc",
    }));
  }, []);

  const onSelect = useCallback((row: InspectionRow) => setSelected(row), []);

  const changeDetailWidth = useCallback((width: number) => {
    setDetailWidth(width);
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* not persisted; the width still applies for this visit */
    }
  }, []);

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /** Jump index: the first supplier under each 가나다 initial. */
  const initials = useMemo(() => {
    const firstGroup = new Map<string, string>();
    for (const group of groups ?? []) {
      const initial = initialOf(group.key);
      if (!firstGroup.has(initial)) firstGroup.set(initial, group.key);
    }
    return [...firstGroup.entries()];
  }, [groups]);

  function jumpTo(groupKey: string) {
    setCollapsed((previous) => {
      if (!previous.has(groupKey)) return previous;
      const next = new Set(previous);
      next.delete(groupKey);
      return next;
    });
    // After the expansion has rendered.
    requestAnimationFrame(() => {
      const target = scroller.current?.querySelector<HTMLElement>(`tr.group[data-group-key="${CSS.escape(groupKey)}"]`);
      target?.scrollIntoView({ block: "start" });
    });
  }

  const columns = useMemo<GridColumn<InspectionRow>[]>(() => {
    const list: GridColumn<InspectionRow>[] = [];
    if (!grouped) {
      list.push({
        key: "supplier",
        header: "협력사",
        width: 180,
        sortKey: "supplier",
        render: (row) => <span title={supplierOf(row)}>{supplierOf(row) || <span className="muted">-</span>}</span>,
      });
    }
    if (mode === "all") {
      // Across jobs the same product repeats once per job; the date is what tells the copies apart.
      list.push({
        key: "job",
        header: "작업일",
        title: "작업(job) 기준일",
        width: 104,
        sortKey: "job",
        render: (row) => <span className="mono" title={jobOf(row)}>{jobOf(row).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? jobOf(row)}</span>,
      });
    }
    list.push(
      {
        key: "code",
        header: "상품코드",
        width: 124,
        sortKey: "code",
        render: (row) => <span className="mono">{text(row.상품코드)}</span>,
      },
      {
        key: "name",
        header: "상품명",
        sortKey: "name",
        render: (row) => (
          <span className="cell-strong" title={text(row.상품명)}>
            {text(row.상품명) || <span className="muted">(상품명 없음)</span>}
          </span>
        ),
      },
      {
        key: "dpt",
        header: "DPT",
        width: 84,
        sortKey: "dpt",
        render: (row) => dptOf(row) || <span className="muted">-</span>,
      },
      {
        key: "ordered",
        header: "발주",
        width: 72,
        align: "right",
        sortKey: "ordered",
        render: (row) => formatNumber(num(row.발주수량)),
      },
      {
        key: "inspected",
        header: "검품",
        width: 72,
        align: "right",
        sortKey: "inspected",
        render: (row) => <span className="cell-strong">{formatNumber(num(row.검품수량))}</span>,
      },
      {
        key: "rate",
        header: "검품률",
        title: "검품수량 ÷ 발주수량",
        width: 112,
        sortKey: "rate",
        render: (row) => {
          const rate = rateOf(row);
          return (
            <div className="rate">
              <div className="bar">
                <i style={{ width: `${Math.min(100, rate * 100)}%` }} data-tone={rate >= 1 ? "done" : undefined} />
              </div>
              <span className="v">{rate > 0 ? formatPercent(rate, 0) : "-"}</span>
            </div>
          );
        },
      },
      {
        key: "returns",
        header: "회송",
        width: 60,
        align: "right",
        sortKey: "returns",
        render: (row) =>
          num(row.회송수량) > 0 ? <span className="tag" data-tone="danger">{formatNumber(num(row.회송수량))}</span> : <span className="muted">-</span>,
      },
      {
        key: "exchanges",
        header: "교환",
        width: 60,
        align: "right",
        sortKey: "exchanges",
        render: (row) =>
          num(row.교환수량) > 0 ? <span className="tag" data-tone="info">{formatNumber(num(row.교환수량))}</span> : <span className="muted">-</span>,
      },
      {
        key: "reason",
        header: "불량사유",
        width: 144,
        sortKey: "reason",
        render: (row) => {
          const reasons = text(row.불량사유)
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
          if (!reasons.length) return <span className="muted">-</span>;
          return (
            <span className="row" style={{ gap: 4, flexWrap: "nowrap" }} title={reasons.join(", ")}>
              <span className="tag">{reasons[0]}</span>
              {reasons.length > 1 && <span className="tag" data-tone="neutral">+{reasons.length - 1}</span>}
            </span>
          );
        },
      },
      {
        key: "photos",
        header: "사진",
        width: 64,
        align: "right",
        sortKey: "photos",
        render: (row) => {
          const count = photoIdsOf(row).length;
          return (
            <span className="cell-photo" data-empty={count === 0 || undefined}>
              <IconCamera size={13} aria-hidden />
              {count}
            </span>
          );
        },
      },
    );
    return list;
  }, [grouped, mode]);

  const renderGroup = useCallback(
    (group: SupplierGroup, isCollapsed: boolean) => {
      const s = group.summary;
      const Chevron = isCollapsed ? IconChevronRight : IconChevronDown;
      return (
        <div className="group-inner">
          <Chevron size={16} className="chev" aria-hidden />
          <span className="gname" title={group.label}>
            {group.label}
          </span>
          <span className="gcount">{formatNumber(s.rows)}개 상품</span>
          <span className="gstats">
            <span>
              발주 <b>{formatNumber(s.ordered)}</b>
            </span>
            <span>
              검품 <b>{formatNumber(s.inspected)}</b> ({formatPercent(s.rate, 0)})
            </span>
            {s.returns > 0 && (
              <span className="warn">
                회송 <b>{formatNumber(s.returns)}</b>
              </span>
            )}
            {s.exchanges > 0 && (
              <span>
                교환 <b>{formatNumber(s.exchanges)}</b>
              </span>
            )}
          </span>
        </div>
      );
    },
    [],
  );

  /** A correction is allowed only when enabled and, if a job list is set, only for those jobs. */
  const correctable = (row: InspectionRow) =>
    correctionsEnabled && (correctionJobs.length === 0 || correctionJobs.includes(jobOf(row)));

  if (loading && !data) return <LoadingState label="검품 내역을 불러오는 중" />;

  if (error) {
    const notConfigured = error.includes("환경변수");
    return (
      <ErrorState
        title={notConfigured ? "검품 앱에 연결되지 않았습니다" : "검품 내역을 불러올 수 없습니다"}
        description={error}
        tone={notConfigured ? "warning" : "danger"}
        actions={<Button onClick={reload}>다시 시도</Button>}
      />
    );
  }

  const updated = data?.sourceVersion?.lastUpdated
    ? new Date(data.sourceVersion.lastUpdated).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : undefined;

  const resetFilters = () => setFilters(EMPTY_FILTERS);
  const allCollapsed = groups ? groups.length > 0 && groups.every((group) => collapsed.has(group.key)) : false;

  return (
    <div className="fill-page">
      <header className="console-head">
        <h1>
          <IconRows size={20} aria-hidden />
          검품 내역
          <span className="sub">
            {updated ? `원본 갱신 ${updated}` : ""}
            {data?.sourceVersion?.version ? ` · v${data.sourceVersion.version}` : ""}
          </span>
        </h1>

        <div className="row" style={{ gap: 12 }}>
          <div className="stat-strip" aria-label="표시 중인 행 요약">
            <div className="stat">
              <span>표시</span>
              <b>
                {formatNumber(summary.rows)}
                <small>행</small>
              </b>
            </div>
            <div className="stat">
              <span>검품 진행</span>
              <b>
                {formatNumber(summary.inspectedRows)}
                <small>{summary.rows ? formatPercent(summary.inspectedRows / summary.rows, 0) : "-"}</small>
              </b>
            </div>
            <div className="stat">
              <span>발주</span>
              <b>{formatNumber(summary.ordered)}</b>
            </div>
            <div className="stat">
              <span>검품</span>
              <b>
                {formatNumber(summary.inspected)}
                <small>{formatPercent(summary.rate, 1)}</small>
              </b>
            </div>
            <div className="stat" data-tone={summary.returns ? "danger" : undefined}>
              <span>회송</span>
              <b>{formatNumber(summary.returns)}</b>
            </div>
            <div className="stat" data-tone={summary.exchanges ? "info" : undefined}>
              <span>교환</span>
              <b>{formatNumber(summary.exchanges)}</b>
            </div>
            <div className="stat">
              <span>사진</span>
              <b>{formatNumber(summary.photos)}</b>
            </div>
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
              <span className="filter-label">범위</span>
              <Segmented
                label="작업 범위"
                value={mode}
                options={MODE_OPTIONS}
                onChange={(value) => {
                  setMode(value);
                  setSelected(undefined);
                  patch({ job: "" });
                }}
              />
              {mode === "all" && (
                <Select
                  aria-label="작업(job)"
                  value={filters.job}
                  onChange={(event) => patch({ job: event.target.value })}
                  style={{ width: 170 }}
                >
                  <option value="">모든 작업</option>
                  {jobs.map(([key, count]) => (
                    <option key={key} value={key}>
                      {jobLabel(key, count)}
                    </option>
                  ))}
                </Select>
              )}
              <div className="grow" style={{ minWidth: 220 }}>
                <SearchInput
                  label="검색"
                  value={filters.query}
                  onChange={(value) => patch({ query: value })}
                  placeholder="상품명, 상품코드, 협력사, 사유 검색"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={filterCount === 0}
                icon={<IconFilterReset size={14} aria-hidden />}
                onClick={resetFilters}
              >
                필터 초기화{filterCount ? ` (${filterCount})` : ""}
              </Button>
            </div>

            <div className="filter-row">
              <MultiSelect
                label="협력사"
                options={supplierOptions}
                selected={filters.suppliers}
                onChange={(suppliers) => patch({ suppliers })}
              />
              <MultiSelect label="DPT" options={dptOptions} selected={filters.dpts} onChange={(dpts) => patch({ dpts })} width={240} />
              <span className="filter-divider" />
              <span className="fgroup">
                <span className="filter-label">검품</span>
                <Segmented label="검품 상태" value={filters.status} options={STATUS_OPTIONS} onChange={(status) => patch({ status })} />
              </span>
              <span className="fgroup">
                <span className="filter-label">이슈</span>
                <Segmented label="이슈" value={filters.issue} options={ISSUE_OPTIONS} onChange={(issue) => patch({ issue })} />
              </span>
              <span className="fgroup">
                <span className="filter-label">사진</span>
                <Segmented label="사진" value={filters.photo} options={PHOTO_OPTIONS} onChange={(photo) => patch({ photo })} />
              </span>
            </div>
          </div>

          <div className="grid-card">
            <div className="grid-meta">
              <Segmented label="보기" value={view} options={VIEW_OPTIONS} onChange={setView} />
              {grouped && groups && (
                <>
                  <span>
                    <b>{formatNumber(groups.length)}</b>개 협력사
                  </span>
                  <span className="jump" aria-label="가나다 바로가기">
                    {initials.map(([initial, groupKey]) => (
                      <button key={initial} type="button" onClick={() => jumpTo(groupKey)} title={`${initial}으로 시작하는 협력사로 이동`}>
                        {initial}
                      </button>
                    ))}
                  </span>
                </>
              )}
              <span className="spacer" />
              {grouped && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setGroupDesc(!groupDesc)} title="협력사 정렬 방향">
                    {groupDesc ? "ㅎ → ㄱ" : "ㄱ → ㅎ"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setCollapsed(allCollapsed ? new Set() : new Set((groups ?? []).map((group) => group.key)))}
                  >
                    {allCollapsed ? "모두 펼치기" : "모두 접기"}
                  </Button>
                </>
              )}
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon={<IconFilterReset size={20} aria-hidden />}
                title="조건에 맞는 검품 행이 없습니다"
                description={filterCount ? "필터를 줄이거나 초기화해 보세요." : "이 범위에는 검품 행이 없습니다."}
                actions={
                  filterCount ? (
                    <Button variant="primary" onClick={resetFilters}>
                      필터 초기화
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <DataGrid<InspectionRow, SupplierGroup>
                columns={columns}
                rows={sorted}
                groups={groups}
                rowKey={rowKeyOf}
                selectedKey={selectedKey}
                onSelect={onSelect}
                sort={effectiveSort}
                onSort={onSort}
                collapsed={collapsed}
                onToggleGroup={toggleGroup}
                renderGroup={renderGroup}
                rowTone={(row) => (hasIssue(row) ? "attention" : undefined)}
                rowDim={isTodo}
                minWidth={NAME_MIN + FIXED_WIDTH + (grouped ? 0 : 180) + (mode === "all" ? 104 : 0)}
                scrollerRef={scroller}
              />
            )}
          </div>
        </div>

        {current && (
          <RowDetail
            key={rowKeyOf(current)}
            row={current}
            inspectionBase={inspectionBase}
            correctionsEnabled={correctable(current)}
            correctionNote={
              correctionsEnabled && !correctable(current) ? "이 배포는 지정된 작업(job)에서만 보정을 허용합니다." : undefined
            }
            width={detailWidth}
            onWidthChange={changeDetailWidth}
            onClose={() => setSelected(undefined)}
            onCorrect={(qty) => setCorrecting({ row: current, qty, requestId: newQtyRequestId() })}
          />
        )}
      </div>

      {correcting && (
        <CorrectionDialog
          row={correcting.row}
          qty={correcting.qty}
          requestId={correcting.requestId}
          onClose={(changed) => {
            setCorrecting(undefined);
            if (changed) reload();
          }}
        />
      )}
    </div>
  );
}
