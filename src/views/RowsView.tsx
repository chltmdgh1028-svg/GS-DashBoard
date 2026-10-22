import { useMemo, useState } from "react";
import type { InspectionRow, QtyConfirmation, WriteReceipt } from "../domain/types";
import type { RowFilters } from "../api";
import { confirmQty, correctQty, fetchRows, newQtyRequestId, photoUrl } from "../api";
import { useResource } from "../useResource";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  MetaItem,
  Notice,
  PageHeader,
  SearchInput,
  SectionCard,
  useToast,
} from "../ui";
import { IconError, IconInfo, IconRows, IconWarning } from "../ui/icons";
import { formatNumber } from "../view-models/format";

const PAGE_SIZE = 50;

const text = (value: unknown) => (value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));
const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Photo ids the app attaches to a row. The field name has varied across the
 * app's own versions, so take whichever is present rather than assuming one.
 */
function photoIdsOf(row: InspectionRow): string[] {
  for (const key of ["photoIds", "photo_ids", "사진IDs", "사진들", "photos"]) {
    const value = row[key];
    if (Array.isArray(value)) {
      return value.map((item) => (typeof item === "string" ? item : text((item as { id?: string })?.id))).filter(Boolean);
    }
    if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

/** A correction in flight, kept so an uncertain outcome can be resolved by reading. */
interface PendingCorrection {
  row: InspectionRow;
  qty: number;
  requestId: string;
  receipt?: WriteReceipt;
  confirmation?: QtyConfirmation;
}

export function RowsView({
  correctionsEnabled,
  inspectionBase,
}: {
  correctionsEnabled: boolean;
  inspectionBase: string | null;
}) {
  const [filters, setFilters] = useState<RowFilters>({ filterMode: "current" });
  const [applied, setApplied] = useState<RowFilters>({ filterMode: "current" });
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<number>();
  const [editQty, setEditQty] = useState("");
  const [pending, setPending] = useState<PendingCorrection>();
  const [busy, setBusy] = useState(false);
  const pushToast = useToast();

  const key = JSON.stringify(applied);
  const { data, error, loading, reload } = useResource(() => fetchRows(applied), `rows:${key}`);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const indexed = rows.map((row, index) => [index, row] as const);
    if (!needle) return indexed;
    return indexed.filter(([, row]) =>
      [row.상품코드, row.상품명, row.협력사명, row.센터명, row.불량사유]
        .map(text)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [rows, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const activeRow = selected == null ? undefined : rows[selected];

  async function runCorrection() {
    if (!pending) return;
    setBusy(true);
    const { row, qty, requestId } = pending;
    try {
      const { saved } = await correctQty({
        jobKey: text(row.작업기준일또는CSV식별값),
        productCode: text(row.상품코드),
        partnerName: text(row.협력사명),
        productName: text(row.상품명),
        qty,
        orderQty: number(row.발주수량),
        baseQty: number(row.검품수량),
        requestId,
      });

      // A pending receipt is not a failure. Read the canonical row back and
      // let that decide, rather than retrying the write.
      if (saved.pendingWrite || saved.ok === false) {
        const confirmation = await confirmQty(text(row.작업기준일또는CSV식별값), text(row.상품코드), requestId);
        setPending({ ...pending, receipt: saved, confirmation });
        pushToast({
          tone: confirmation.matches ? "success" : "warning",
          title: confirmation.matches ? "보정이 반영되어 있습니다" : "저장 여부가 확정되지 않았습니다",
          description: confirmation.matches ? undefined : "저장/복구 상태에서 같은 요청 ID로 확인하세요.",
        });
        return;
      }

      const confirmation = await confirmQty(
        text(row.작업기준일또는CSV식별값),
        text(row.상품코드),
        requestId,
      ).catch(() => undefined);

      pushToast({
        tone: "success",
        title: "검품수량 보정 완료",
        description: `${text(row.상품명)} · ${number(row.검품수량)} → ${qty}`,
      });
      setPending(undefined);
      setEditQty("");
      if (confirmation && confirmation.matches === false) {
        pushToast({ tone: "warning", title: "저장은 되었으나 확인 조회가 일치하지 않습니다", description: "화면을 새로 고쳐 확인하세요." });
      }
      reload();
    } catch (cause) {
      const retryable = cause instanceof Error && "retryable" in cause && (cause as { retryable?: boolean }).retryable;
      // On an uncertain outcome never resubmit; read the row back instead.
      const confirmation = retryable
        ? await confirmQty(text(row.작업기준일또는CSV식별값), text(row.상품코드), requestId).catch(() => undefined)
        : undefined;
      setPending({ ...pending, confirmation });
      pushToast({
        tone: "danger",
        title: confirmation?.matches ? "응답은 실패했지만 보정은 반영되었습니다" : "보정에 실패했습니다",
        description: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

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

  const diagnostics = data?.diagnostics as Record<string, unknown> | undefined;

  return (
    <div className="page">
      <PageHeader
        icon={<IconRows size={20} aria-hidden />}
        title="검품 내역"
        description="검품 앱이 기록한 행을 그대로 조회합니다. 수량 보정은 원본 행에 직접 반영됩니다."
        meta={
          <>
            <MetaItem label="행">{formatNumber(rows.length)}</MetaItem>
            {diagnostics?.filterMode ? <MetaItem label="filterMode">{text(diagnostics.filterMode)}</MetaItem> : null}
            {diagnostics?.role ? <MetaItem label="role">{text(diagnostics.role)}</MetaItem> : null}
          </>
        }
        actions={
          <Button onClick={reload} loading={loading}>
            새로 고침
          </Button>
        }
      />

      {!correctionsEnabled && (
        <Notice tone="info" icon={<IconInfo size={16} aria-hidden />} title="조회 전용 배포">
          수량 보정을 허용하려면 서버에 <code>CORRECTIONS_ENABLED=true</code>를 설정하세요.
        </Notice>
      )}

      <SectionCard title="조회 조건">
        <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
          <Field label="작업기준일/CSV 식별값">
            <Input
              value={filters.jobKey ?? ""}
              placeholder="jobKey"
              onChange={(event) => setFilters({ ...filters, jobKey: event.target.value })}
            />
          </Field>
          <Field label="날짜">
            <Input
              type="date"
              value={filters.date ?? ""}
              onChange={(event) => setFilters({ ...filters, date: event.target.value })}
            />
          </Field>
          <Field label="센터">
            <Input
              value={filters.center ?? ""}
              placeholder="전체"
              onChange={(event) => setFilters({ ...filters, center: event.target.value })}
            />
          </Field>
          <Field label="filterMode">
            <Input
              value={filters.filterMode ?? ""}
              placeholder="current | all"
              onChange={(event) => setFilters({ ...filters, filterMode: event.target.value })}
            />
          </Field>
          <Button
            variant="primary"
            onClick={() => {
              setApplied({ ...filters });
              setPage(0);
              setSelected(undefined);
            }}
          >
            조회
          </Button>
        </div>
      </SectionCard>

      <SectionCard flush>
        <div className="table-toolbar">
          <div className="table-toolbar-group">
            <SearchInput
              label="행 검색"
              value={query}
              onChange={(value) => {
                setQuery(value);
                setPage(0);
              }}
              placeholder="상품, 코드, 협력사, 사유"
              width={280}
            />
            <span className="muted">
              {formatNumber(filtered.length)}행 중 {formatNumber(pageRows.length)}행
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
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>센터</th>
                <th>상품코드</th>
                <th>상품명</th>
                <th>협력사</th>
                <th style={{ textAlign: "right" }}>발주</th>
                <th style={{ textAlign: "right" }}>검품</th>
                <th style={{ textAlign: "right" }}>불량</th>
                <th>불량사유</th>
                <th style={{ textAlign: "right" }}>사진</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(([index, row]) => {
                const photos = photoIdsOf(row);
                return (
                  <tr
                    key={`${text(row.상품코드)}-${row.__rowNumber ?? index}`}
                    onClick={() => {
                      setSelected(index);
                      setEditQty(String(number(row.검품수량)));
                    }}
                    aria-selected={selected === index}
                    style={{ cursor: "pointer" }}
                  >
                    <td>{text(row.센터명) || "-"}</td>
                    <td className="mono">{text(row.상품코드)}</td>
                    <td title={text(row.상품명)}>{text(row.상품명)}</td>
                    <td title={text(row.협력사명)}>{text(row.협력사명)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{formatNumber(number(row.발주수량))}</td>
                    <td className="num" style={{ textAlign: "right" }}>{formatNumber(number(row.검품수량))}</td>
                    <td className="num" style={{ textAlign: "right" }}>{formatNumber(number(row.불량수량))}</td>
                    <td title={text(row.불량사유)}>{text(row.불량사유) || <span className="muted">-</span>}</td>
                    <td className="num" style={{ textAlign: "right" }}>{photos.length || <span className="muted">0</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!pageRows.length && <EmptyState title="조건에 맞는 검품 행이 없습니다" inline />}
        </div>
      </SectionCard>

      {activeRow && (
        <SectionCard
          title={`${text(activeRow.상품명) || text(activeRow.상품코드)} 상세`}
          subtitle={`${text(activeRow.센터명)} · ${text(activeRow.협력사명)}`}
          actions={
            <Button variant="ghost" size="sm" onClick={() => setSelected(undefined)}>
              닫기
            </Button>
          }
        >
          <div className="stack" data-gap="sm">
            <div className="row">
              <Badge size="sm">발주 {formatNumber(number(activeRow.발주수량))}</Badge>
              <Badge tone="accent" size="sm">검품 {formatNumber(number(activeRow.검품수량))}</Badge>
              <Badge tone={number(activeRow.불량수량) > 0 ? "warning" : "neutral"} size="sm">
                불량 {formatNumber(number(activeRow.불량수량))}
              </Badge>
              {text(activeRow.불량사유) && <Badge tone="warning" size="sm">{text(activeRow.불량사유)}</Badge>}
            </div>

            {text(activeRow.비고) && <p className="muted">비고: {text(activeRow.비고)}</p>}

            {/* Photos load straight from the inspection app: the id is a signed
                capability, so an <img> needs no header from us. */}
            {photoIdsOf(activeRow).length > 0 && inspectionBase && (
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {photoIdsOf(activeRow).map((id) => (
                  <a
                    key={id}
                    href={photoUrl(inspectionBase, id, "w1200")}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={id}
                  >
                    <img
                      src={photoUrl(inspectionBase, id, "w320")}
                      alt={`${text(activeRow.상품명)} 검품 사진`}
                      loading="lazy"
                      style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }}
                    />
                  </a>
                ))}
              </div>
            )}
            {photoIdsOf(activeRow).length > 0 && !inspectionBase && (
              <p className="muted">사진 {photoIdsOf(activeRow).length}장 (검품 앱 주소가 설정되지 않아 표시할 수 없습니다)</p>
            )}

            {correctionsEnabled && (
              <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
                <Field label="검품수량 보정" hint={`현재 ${formatNumber(number(activeRow.검품수량))}`}>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={editQty}
                    onChange={(event) => setEditQty(event.target.value)}
                    style={{ width: 140 }}
                  />
                </Field>
                <Button
                  variant="danger"
                  disabled={editQty === "" || Number(editQty) === number(activeRow.검품수량) || Number(editQty) < 0}
                  onClick={() =>
                    setPending({ row: activeRow, qty: Number(editQty), requestId: newQtyRequestId() })
                  }
                >
                  보정
                </Button>
              </div>
            )}

            {pending?.confirmation && (
              <Notice
                tone={pending.confirmation.matches ? "success" : "warning"}
                icon={<IconWarning size={16} aria-hidden />}
                title={pending.confirmation.matches ? "원본 행에 반영 확인됨" : "원본 행에서 확인되지 않음"}
              >
                <span className="mono">requestId {pending.requestId}</span>
              </Notice>
            )}
          </div>
        </SectionCard>
      )}

      <ConfirmDialog
        open={Boolean(pending) && !pending?.confirmation}
        title="검품수량 보정"
        confirmLabel="보정 저장"
        cancelLabel="취소"
        tone="danger"
        busy={busy}
        onConfirm={runCorrection}
        onCancel={() => setPending(undefined)}
      >
        {pending && (
          <div className="stack" data-gap="sm">
            <Notice tone="danger" icon={<IconError size={16} aria-hidden />}>
              검품 앱의 원본 행이 바뀝니다. 화면에 보인 수량({formatNumber(number(pending.row.검품수량))})이 그대로일
              때만 저장되고, 그 사이 누가 고쳤다면 거부됩니다.
            </Notice>
            <p>
              <b>{text(pending.row.상품명)}</b> · {text(pending.row.상품코드)}
              <br />
              {formatNumber(number(pending.row.검품수량))} → <b>{formatNumber(pending.qty)}</b>
            </p>
            <span className="muted mono">requestId {pending.requestId}</span>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
