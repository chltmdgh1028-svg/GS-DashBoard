import { useCallback, useMemo, useState } from "react";
import type { CellError, DatasetEntry, GridView, PreviewResult } from "../domain/types";
import type { GridSubmission } from "../api";
import { fetchView, previewGrid, saveGrid } from "../api";
import { useResource } from "../useResource";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  MetaItem,
  Notice,
  PageHeader,
  SearchInput,
  SectionCard,
  useToast,
} from "../ui";
import { IconError, IconInfo, IconMaster, IconWarning } from "../ui/icons";
import { formatNumber } from "../view-models/format";

/** A dataset can run to 20,000 rows; never render them all at once. */
const PAGE_SIZE = 50;

/** Mirrors the inspection app's own ceiling, so an oversize edit fails here with a clear message. */
const MAX_ROWS = 20000;

function cloneRows(rows: string[][]) {
  return rows.map((row) => [...row]);
}

/** Error lookup keyed "row:col", so a cell can colour itself in O(1). */
function errorIndex(errors: CellError[]) {
  const index = new Map<string, string>();
  for (const error of errors) {
    const key = `${error.row}:${error.col}`;
    index.set(key, index.has(key) ? `${index.get(key)}\n${error.message}` : error.message);
  }
  return index;
}

export function MasterConsoleView({
  entry,
  writesEnabled,
}: {
  entry: DatasetEntry;
  writesEnabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [edited, setEdited] = useState<{ key: string; rows: string[][] }>();
  const [preview, setPreview] = useState<PreviewResult>();
  const [operationId, setOperationId] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const pushToast = useToast();

  const { data, error, loading, reload } = useResource(() => fetchView(entry.name), `view:${entry.name}`);
  const view: GridView | undefined = data?.view;

  /**
   * Edits belong to one exact version of one dataset. Keying them by
   * dataset+revision+sourceHash means a refreshed view drops them during
   * render rather than through an effect, so an edit can never be carried
   * onto a revision it was not made against.
   */
  const viewKey = view ? `${view.dataset}:${view.revision}:${view.sourceHash}` : "";
  const draft = view ? (edited?.key === viewKey ? edited.rows : view.rows) : undefined;

  const discard = useCallback(() => {
    setEdited(undefined);
    setPreview(undefined);
    setOperationId(undefined);
  }, []);

  const dirtyCells = useMemo(() => {
    if (!view || !draft) return new Set<string>();
    const dirty = new Set<string>();
    for (let r = 0; r < draft.length; r += 1) {
      for (let c = 0; c < (view.columns.length || 0); c += 1) {
        const before = view.rows[r]?.[c] ?? "";
        if ((draft[r]?.[c] ?? "") !== before) dirty.add(`${r}:${c}`);
      }
    }
    if (draft.length !== view.rows.length) dirty.add("length");
    return dirty;
  }, [view, draft]);

  const changed = dirtyCells.size > 0;

  const submission: GridSubmission | undefined = useMemo(() => {
    if (!view || !draft) return undefined;
    return {
      columns: view.columns.map((column) => column.label),
      rows: draft,
      expectedRevision: view.revision,
      sourceHash: view.sourceHash,
    };
  }, [view, draft]);

  const errors = errorIndex(preview?.errors ?? []);
  const blocking = (preview?.errors.length ?? 0) > 0;

  /** Rows matching the filter, as [originalIndex, cells] so edits hit the right row. */
  const filtered = useMemo(() => {
    const rows = draft ?? [];
    const needle = query.trim().toLowerCase();
    const indexed = rows.map((cells, index) => [index, cells] as const);
    if (!needle) return indexed;
    return indexed.filter(([, cells]) => cells.some((cell) => String(cell ?? "").toLowerCase().includes(needle)));
  }, [draft, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function editRows(mutate: (rows: string[][]) => string[][]) {
    if (!draft) return;
    setPreview(undefined);
    setEdited({ key: viewKey, rows: mutate(cloneRows(draft)) });
  }

  function setCell(rowIndex: number, colIndex: number, value: string) {
    editRows((rows) => {
      rows[rowIndex] = rows[rowIndex] ?? [];
      rows[rowIndex][colIndex] = value;
      return rows;
    });
  }

  async function runPreview() {
    if (!submission) return;
    setBusy(true);
    try {
      const result = await previewGrid(entry.name, submission);
      setPreview(result);
      if (!operationId) setOperationId(crypto.randomUUID());
      if (result.errors.length) {
        pushToast({
          tone: "warning",
          title: `검토 결과 ${result.errors.length}건의 오류`,
          description: "표에 표시된 셀을 수정한 뒤 다시 검토하세요.",
        });
      }
    } catch (cause) {
      setPreview(undefined);
      pushToast({
        tone: "danger",
        title: "검토에 실패했습니다",
        description: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function runSave() {
    if (!submission || !operationId) return;
    setBusy(true);
    try {
      const result = await saveGrid(entry.name, submission, operationId);
      if (result.pendingWrite) {
        pushToast({
          tone: "warning",
          title: "저장 결과 확인 중",
          description: result.message ?? "같은 내용으로 다시 시도하면 중복 저장되지 않습니다.",
        });
      } else {
        pushToast({ tone: "success", title: `${entry.label} 저장 완료` });
        setConfirming(false);
        reload();
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : undefined;
      pushToast({
        tone: "danger",
        title: "저장에 실패했습니다",
        description: message,
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <LoadingState label={`${entry.label} 불러오는 중`} />;

  if (error) {
    const notConfigured = error.includes("환경변수");
    return (
      <ErrorState
        title={notConfigured ? "검품 앱에 연결되지 않았습니다" : `${entry.label}을(를) 불러올 수 없습니다`}
        description={error}
        tone={notConfigured ? "warning" : "danger"}
        actions={<Button onClick={reload}>다시 시도</Button>}
      />
    );
  }

  if (!view || !draft) return null;

  const canEdit = writesEnabled;
  const tooManyRows = draft.length > MAX_ROWS;

  return (
    <div className="page">
      <PageHeader
        icon={<IconMaster size={20} aria-hidden />}
        title={view.label || entry.label}
        description="검품 운영 기준정보 원본입니다. 저장하면 검품 앱이 쓰는 정규 데이터가 바뀝니다."
        meta={
          <>
            <MetaItem label="행">{formatNumber(draft.length)}</MetaItem>
            <MetaItem label="컬럼">{formatNumber(view.columns.length)}</MetaItem>
            <MetaItem label="revision">{formatNumber(view.revision)}</MetaItem>
            <MetaItem label="원본">{view.sourceOwner ?? "-"}</MetaItem>
          </>
        }
        actions={
          <Button onClick={reload} loading={loading} disabled={changed}>
            새로 고침
          </Button>
        }
      />

      {!writesEnabled && (
        <Notice tone="info" icon={<IconInfo size={16} aria-hidden />} title="읽기 전용 배포">
          이 배포는 조회만 가능합니다. 수정하려면 서버에 <code>MASTER_WRITES_ENABLED=true</code>를 설정하세요.
        </Notice>
      )}

      {tooManyRows && (
        <Notice tone="danger" icon={<IconError size={16} aria-hidden />} title="행 수 한도 초과">
          {formatNumber(draft.length)}행은 저장 한도 {formatNumber(MAX_ROWS)}행을 넘습니다.
        </Notice>
      )}

      {preview && !blocking && (
        <Notice tone="success" icon={<IconInfo size={16} aria-hidden />} title="검토 통과">
          변경 {formatNumber(preview.changes?.length ?? 0)}건. 저장하면 검품 앱의 정규 데이터에 반영됩니다.
        </Notice>
      )}

      {preview?.warnings?.length ? (
        <Notice tone="warning" icon={<IconWarning size={16} aria-hidden />} title="확인 필요">
          <ul style={{ margin: 0, paddingLeft: "1.1em" }}>
            {preview.warnings.map((warning, index) => (
              <li key={index}>
                {warning.row + 1}행: {warning.message}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {blocking && (
        <Notice tone="danger" icon={<IconError size={16} aria-hidden />} title={`오류 ${preview?.errors.length}건`}>
          표시된 셀을 수정한 뒤 다시 검토하세요. 오류가 있으면 저장할 수 없습니다.
        </Notice>
      )}

      <SectionCard
        flush
        actions={
          canEdit ? (
            <div className="row">
              <Button variant="ghost" onClick={discard} disabled={!changed || busy}>
                변경 취소
              </Button>
              <Button variant="primary" onClick={runPreview} loading={busy && !confirming} disabled={!changed || tooManyRows}>
                검토
              </Button>
              <Button
                variant="danger"
                onClick={() => setConfirming(true)}
                disabled={!preview || blocking || !changed || tooManyRows}
              >
                저장
              </Button>
            </div>
          ) : undefined
        }
      >
        <div className="table-toolbar">
          <div className="table-toolbar-group">
            <SearchInput
              label="행 검색"
              value={query}
              onChange={(value) => {
                setQuery(value);
                setPage(0);
              }}
              placeholder="모든 셀에서 검색"
              width={280}
            />
            <span className="muted">
              {formatNumber(filtered.length)}행 중 {formatNumber(pageRows.length)}행
              {changed && ` · 변경 ${formatNumber(dirtyCells.size)}셀`}
            </span>
          </div>
          <div className="spacer" />
          <div className="table-toolbar-group">
            <Button size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              이전
            </Button>
            <span className="muted num">
              {safePage + 1} / {pageCount}
            </span>
            <Button size="sm" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
              다음
            </Button>
            {canEdit && (
              <Button
                size="sm"
                disabled={draft.length >= MAX_ROWS}
                onClick={() => {
                  editRows((rows) => [...rows, view.columns.map(() => "")]);
                  setPage(Math.ceil((draft.length + 1) / PAGE_SIZE) - 1);
                }}
              >
                행 추가
              </Button>
            )}
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={{ width: 56 }}>#</th>
                {view.columns.map((column) => (
                  <th key={column.label} title={column.readOnly ? "읽기 전용" : column.type}>
                    {column.label}
                    {column.required && <span style={{ color: "var(--neg)" }}> *</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map(([rowIndex, cells]) => (
                <tr key={rowIndex}>
                  <td className="num muted">{rowIndex + 1}</td>
                  {view.columns.map((column, colIndex) => {
                    const message = errors.get(`${rowIndex}:${colIndex}`);
                    const dirty = dirtyCells.has(`${rowIndex}:${colIndex}`);
                    const value = cells[colIndex] ?? "";

                    if (!canEdit || column.readOnly) {
                      return (
                        <td key={column.label}>
                          <span className="muted" title={value}>
                            {value || "-"}
                          </span>
                        </td>
                      );
                    }

                    return (
                      <td key={column.label}>
                        <Input
                          value={value}
                          aria-label={`${rowIndex + 1}행 ${column.label}`}
                          aria-invalid={message ? true : undefined}
                          title={message}
                          list={column.options ? `opt-${entry.name}-${colIndex}` : undefined}
                          style={
                            message
                              ? { borderColor: "var(--neg)" }
                              : dirty
                                ? { borderColor: "var(--warn)" }
                                : undefined
                          }
                          onChange={(event) => setCell(rowIndex, colIndex, event.target.value)}
                        />
                        {column.options && (
                          <datalist id={`opt-${entry.name}-${colIndex}`}>
                            {column.options.map((option) => (
                              <option key={option} value={option} />
                            ))}
                          </datalist>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!pageRows.length && <EmptyState title="표시할 행이 없습니다" inline />}
        </div>
      </SectionCard>

      <ConfirmDialog
        open={confirming}
        title={`${view.label || entry.label} 저장`}
        confirmLabel="저장"
        cancelLabel="취소"
        tone="danger"
        busy={busy}
        onConfirm={runSave}
        onCancel={() => setConfirming(false)}
      >
        <div className="stack" data-gap="sm">
          <Notice tone="danger" icon={<IconError size={16} aria-hidden />}>
            검품 앱이 사용하는 정규 기준정보가 바뀝니다. revision {view.revision} 기준으로 저장하며, 그 사이
            다른 사람이 수정했다면 저장되지 않고 충돌로 거부됩니다.
          </Notice>
          <div className="row">
            <Badge tone="warning" size="sm">
              변경 {formatNumber(preview?.changes?.length ?? dirtyCells.size)}
            </Badge>
            <Badge size="sm">행 {formatNumber(draft.length)}</Badge>
            <span className="muted mono">operation {operationId?.slice(0, 8)}…</span>
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}

export function NoDatasetSelected({ datasets }: { datasets: DatasetEntry[] }) {
  return (
    <div className="page">
      <EmptyState
        title="데이터셋을 선택하세요"
        description={`왼쪽에서 열람하거나 수정할 기준정보를 고르세요. (${datasets.length}개)`}
      />
    </div>
  );
}
