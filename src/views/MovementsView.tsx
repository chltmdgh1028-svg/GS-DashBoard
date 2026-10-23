import { useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import type { MovementRecord } from "../domain/types";
import type { FilterMode } from "../api";
import { fetchMovements } from "../api";
import { compareKo, compareSupplier } from "../lib/korean";
import { facet, initialOf, num, NO_SUPPLIER_LABEL } from "../lib/rowsModel";
import { useResource } from "../useResource";
import {
  Button,
  DataGrid,
  EmptyState,
  ErrorState,
  LoadingState,
  MultiSelect,
  SearchInput,
  Segmented,
} from "../ui";
import type { GridColumn, GridSort } from "../ui";
import { IconChevronDown, IconChevronRight, IconFilterReset, IconMovement } from "../ui/icons";
import { formatNumber } from "../view-models/format";

const text = (value: unknown) => (value == null ? "" : String(value));

const MODE_OPTIONS: { value: FilterMode; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "current", label: "오늘 작업" },
];
const KIND_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "회송", label: "회송" },
  { value: "교환", label: "교환" },
] as const;
const VIEW_OPTIONS: { value: "group" | "flat"; label: string }[] = [
  { value: "group", label: "협력사별" },
  { value: "flat", label: "목록" },
];

const supplierOf = (record: MovementRecord) => text(record.협력사명).trim();

/** 처리유형 is 회송 or 교환; the amount is whichever of the two quantity columns applies. */
function quantityOf(record: MovementRecord) {
  const kind = text(record.처리유형);
  if (kind.includes("교환")) return num(record.교환수량);
  if (kind.includes("회송")) return num(record.회송수량);
  return num(record.회송수량) || num(record.교환수량);
}

/** 조치 등급 on production: 개선요청 / 경고조치 / 주의조치. Severity, not "done". */
function gradeTone(grade: string) {
  if (grade.includes("개선")) return "danger" as const;
  if (grade.includes("경고")) return undefined; // the default amber tag
  return "info" as const;
}

interface MovementGroup {
  key: string;
  label: string;
  rows: MovementRecord[];
}

const rowKeyOf = (record: MovementRecord) =>
  text(record.recordId) || `${text(record.작업기준일또는CSV식별값)}|${text(record.상품코드)}|${text(record.작성일시)}|${record.__rowNumber ?? ""}`;

const comparators: Record<string, (a: MovementRecord, b: MovementRecord) => number> = {
  supplier: (a, b) => compareSupplier(supplierOf(a), supplierOf(b)),
  kind: (a, b) => compareKo(text(a.처리유형), text(b.처리유형)),
  center: (a, b) => compareKo(text(a.센터명), text(b.센터명)),
  code: (a, b) => text(a.상품코드).localeCompare(text(b.상품코드)),
  name: (a, b) => compareKo(text(a.상품명), text(b.상품명)),
  qty: (a, b) => quantityOf(a) - quantityOf(b),
  reason: (a, b) => compareKo(text(a.불량사유), text(b.불량사유)),
  grade: (a, b) => compareKo(text(a.effectiveActionStatus), text(b.effectiveActionStatus)),
  photos: (a, b) => num(a.사진개수) - num(b.사진개수),
  editor: (a, b) => compareKo(text(a.수정자), text(b.수정자)),
  at: (a, b) => text(a.작성일시).localeCompare(text(b.작성일시)),
};

export function MovementsView() {
  const [mode, setMode] = useState<FilterMode>("all");
  const [kind, setKind] = useState<"all" | "회송" | "교환">("all");
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [centers, setCenters] = useState<string[]>([]);
  const [grades, setGrades] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"group" | "flat">("group");
  const [groupDesc, setGroupDesc] = useState(false);
  // Newest first inside a supplier: a movement log is read by recency.
  const [sort, setSort] = useState<GridSort>({ key: "at", dir: "desc" });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);

  const { data, error, loading, reload } = useResource(() => fetchMovements({ filterMode: mode }), `movements:${mode}`);
  const records = useMemo(() => data?.records ?? [], [data]);
  const grouped = view === "group";
  const deferredQuery = useDeferredValue(query);

  const supplierOptions = useMemo(
    () =>
      facet(
        records.map((record) => ({ 협력사명: record.협력사명 })),
        (row) => text(row.협력사명).trim(),
        NO_SUPPLIER_LABEL,
      ),
    [records],
  );
  const centerOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of records) counts.set(text(record.센터명), (counts.get(text(record.센터명)) ?? 0) + 1);
    return [...counts.entries()]
      .sort(([a], [b]) => compareKo(a, b))
      .map(([value, count]) => ({ value, label: value || "(센터 없음)", count }));
  }, [records]);
  const gradeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of records) counts.set(text(record.effectiveActionStatus), (counts.get(text(record.effectiveActionStatus)) ?? 0) + 1);
    return [...counts.entries()].map(([value, count]) => ({ value, label: value || "(미지정)", count }));
  }, [records]);

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    const supplierSet = new Set(suppliers);
    const centerSet = new Set(centers);
    const gradeSet = new Set(grades);
    return records.filter((record) => {
      if (kind !== "all" && !text(record.처리유형).includes(kind)) return false;
      if (supplierSet.size && !supplierSet.has(supplierOf(record))) return false;
      if (centerSet.size && !centerSet.has(text(record.센터명))) return false;
      if (gradeSet.size && !gradeSet.has(text(record.effectiveActionStatus))) return false;
      if (!needle) return true;
      return [record.상품코드, record.상품명, record.협력사명, record.센터명, record.불량사유, record.수정자]
        .map(text)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [records, kind, suppliers, centers, grades, deferredQuery]);

  const effectiveSort: GridSort = useMemo(
    () => (grouped && sort.key === "supplier" ? { key: "at", dir: "desc" } : sort),
    [grouped, sort],
  );
  const sorted = useMemo(() => {
    const primary = comparators[effectiveSort.key] ?? comparators.at;
    const sign = effectiveSort.dir === "asc" ? 1 : -1;
    return [...filtered].sort(
      (a, b) => primary(a, b) * sign || comparators.supplier(a, b) || comparators.at(b, a) || comparators.code(a, b),
    );
  }, [filtered, effectiveSort]);

  const groups = useMemo<MovementGroup[] | undefined>(() => {
    if (!grouped) return undefined;
    const byKey = new Map<string, MovementRecord[]>();
    for (const record of sorted) {
      const key = supplierOf(record);
      byKey.set(key, [...(byKey.get(key) ?? []), record]);
    }
    return [...byKey.entries()]
      .sort(([a], [b]) => compareSupplier(a, b, groupDesc ? "desc" : "asc"))
      .map(([key, rows]) => ({ key, label: key || NO_SUPPLIER_LABEL, rows }));
  }, [grouped, sorted, groupDesc]);

  const totals = useMemo(() => {
    let returns = 0;
    let exchanges = 0;
    for (const record of filtered) {
      if (text(record.처리유형).includes("교환")) exchanges += quantityOf(record);
      else returns += quantityOf(record);
    }
    return {
      returnCount: filtered.filter((record) => text(record.처리유형).includes("회송")).length,
      exchangeCount: filtered.filter((record) => text(record.처리유형).includes("교환")).length,
      returns,
      exchanges,
    };
  }, [filtered]);

  const onSort = useCallback((key: string) => {
    setSort((previous) => ({ key, dir: previous.key === key && previous.dir === "asc" ? "desc" : "asc" }));
  }, []);

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const initials = useMemo(() => {
    const first = new Map<string, string>();
    for (const group of groups ?? []) {
      const initial = initialOf(group.key);
      if (!first.has(initial)) first.set(initial, group.key);
    }
    return [...first.entries()];
  }, [groups]);

  function jumpTo(groupKey: string) {
    setCollapsed((previous) => {
      if (!previous.has(groupKey)) return previous;
      const next = new Set(previous);
      next.delete(groupKey);
      return next;
    });
    requestAnimationFrame(() => {
      scroller.current
        ?.querySelector<HTMLElement>(`tr.group[data-group-key="${CSS.escape(groupKey)}"]`)
        ?.scrollIntoView({ block: "start" });
    });
  }

  const columns = useMemo<GridColumn<MovementRecord>[]>(() => {
    const list: GridColumn<MovementRecord>[] = [];
    if (!grouped) {
      list.push({
        key: "supplier",
        header: "협력사",
        width: 180,
        sortKey: "supplier",
        render: (record) => <span title={supplierOf(record)}>{supplierOf(record) || <span className="muted">-</span>}</span>,
      });
    }
    list.push(
      {
        key: "kind",
        header: "구분",
        width: 72,
        sortKey: "kind",
        render: (record) => (
          <span className="tag" data-tone={text(record.처리유형).includes("회송") ? "danger" : "info"}>
            {text(record.처리유형) || "-"}
          </span>
        ),
      },
      {
        key: "center",
        header: "센터",
        width: 120,
        sortKey: "center",
        render: (record) => text(record.센터명) || <span className="muted">-</span>,
      },
      {
        key: "code",
        header: "상품코드",
        width: 132,
        sortKey: "code",
        render: (record) => <span className="mono">{text(record.상품코드)}</span>,
      },
      {
        key: "name",
        header: "상품명",
        sortKey: "name",
        render: (record) => (
          <span className="cell-strong" title={text(record.상품명)}>
            {text(record.상품명)}
          </span>
        ),
      },
      {
        key: "qty",
        header: "수량",
        width: 72,
        align: "right",
        sortKey: "qty",
        render: (record) => <span className="cell-strong">{formatNumber(quantityOf(record))}</span>,
      },
      {
        key: "reason",
        header: "불량사유",
        width: 168,
        sortKey: "reason",
        render: (record) => {
          const reasons = text(record.불량사유)
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
        key: "grade",
        header: "조치",
        title: "개선요청 / 경고조치 / 주의조치 (처리 완료 여부가 아니라 조치 등급)",
        width: 96,
        sortKey: "grade",
        render: (record) => {
          const grade = text(record.effectiveActionStatus);
          return grade ? <span className="tag" data-tone={gradeTone(grade)}>{grade}</span> : <span className="muted">-</span>;
        },
      },
      {
        key: "photos",
        header: "사진",
        width: 56,
        align: "right",
        sortKey: "photos",
        render: (record) => num(record.사진개수) || <span className="muted">0</span>,
      },
      {
        key: "editor",
        header: "수정자",
        width: 84,
        sortKey: "editor",
        render: (record) => text(record.수정자) || <span className="muted">-</span>,
      },
      {
        key: "at",
        header: "작성일시",
        width: 150,
        sortKey: "at",
        render: (record) => <span className="muted">{text(record.작성일시)}</span>,
      },
    );
    return list;
  }, [grouped]);

  const renderGroup = useCallback((group: MovementGroup, isCollapsed: boolean) => {
    const Chevron = isCollapsed ? IconChevronRight : IconChevronDown;
    const returns = group.rows.filter((record) => text(record.처리유형).includes("회송"));
    const exchanges = group.rows.filter((record) => text(record.처리유형).includes("교환"));
    return (
      <div className="group-inner">
        <Chevron size={16} className="chev" aria-hidden />
        <span className="gname" title={group.label}>
          {group.label}
        </span>
        <span className="gcount">{formatNumber(group.rows.length)}건</span>
        <span className="gstats">
          {returns.length > 0 && (
            <span className="warn">
              회송 <b>{formatNumber(returns.length)}건</b> ({formatNumber(returns.reduce((n, record) => n + quantityOf(record), 0))}개)
            </span>
          )}
          {exchanges.length > 0 && (
            <span>
              교환 <b>{formatNumber(exchanges.length)}건</b> ({formatNumber(exchanges.reduce((n, record) => n + quantityOf(record), 0))}개)
            </span>
          )}
        </span>
      </div>
    );
  }, []);

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

  const filterCount =
    (kind !== "all" ? 1 : 0) + (suppliers.length ? 1 : 0) + (centers.length ? 1 : 0) + (grades.length ? 1 : 0) + (query.trim() ? 1 : 0);
  const reset = () => {
    setKind("all");
    setSuppliers([]);
    setCenters([]);
    setGrades([]);
    setQuery("");
  };
  const allCollapsed = groups ? groups.length > 0 && groups.every((group) => collapsed.has(group.key)) : false;

  return (
    <div className="fill-page">
      <header className="console-head">
        <h1>
          <IconMovement size={20} aria-hidden />
          회송 / 교환
        </h1>
        <div className="row" style={{ gap: 12 }}>
          <div className="stat-strip">
            <div className="stat">
              <span>표시</span>
              <b>
                {formatNumber(filtered.length)}
                <small>건</small>
              </b>
            </div>
            <div className="stat" data-tone={totals.returnCount ? "danger" : undefined}>
              <span>회송</span>
              <b>
                {formatNumber(totals.returnCount)}
                <small>{formatNumber(totals.returns)}개</small>
              </b>
            </div>
            <div className="stat" data-tone={totals.exchangeCount ? "info" : undefined}>
              <span>교환</span>
              <b>
                {formatNumber(totals.exchangeCount)}
                <small>{formatNumber(totals.exchanges)}개</small>
              </b>
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
              <Segmented label="작업 범위" value={mode} options={MODE_OPTIONS} onChange={setMode} />
              <span className="filter-label">구분</span>
              <Segmented label="구분" value={kind} options={[...KIND_OPTIONS]} onChange={setKind} />
              <div className="grow" style={{ minWidth: 220 }}>
                <SearchInput label="검색" value={query} onChange={setQuery} placeholder="상품명, 상품코드, 협력사, 사유, 수정자 검색" />
              </div>
              <Button variant="ghost" size="sm" disabled={filterCount === 0} icon={<IconFilterReset size={14} aria-hidden />} onClick={reset}>
                필터 초기화{filterCount ? ` (${filterCount})` : ""}
              </Button>
            </div>
            <div className="filter-row">
              <MultiSelect label="협력사" options={supplierOptions} selected={suppliers} onChange={setSuppliers} />
              <MultiSelect label="센터" options={centerOptions} selected={centers} onChange={setCenters} width={240} />
              <MultiSelect label="조치" options={gradeOptions} selected={grades} onChange={setGrades} width={220} searchable={false} />
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
                title="회송/교환 내역이 없습니다"
                description={filterCount ? "필터를 줄이거나 초기화해 보세요." : mode === "current" ? "오늘 작업에는 아직 없습니다. 범위를 '전체'로 바꿔 보세요." : undefined}
                actions={
                  filterCount ? (
                    <Button variant="primary" onClick={reset}>
                      필터 초기화
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <DataGrid<MovementRecord, MovementGroup>
                columns={columns}
                rows={sorted}
                groups={groups}
                rowKey={rowKeyOf}
                sort={effectiveSort}
                onSort={onSort}
                collapsed={collapsed}
                onToggleGroup={toggleGroup}
                renderGroup={renderGroup}
                minWidth={grouped ? 980 : 1160}
                scrollerRef={scroller}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
