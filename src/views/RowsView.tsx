import { useMemo, useState } from "react";
import type { InspectionRow, QtyConfirmation, WriteReceipt } from "../domain/types";
import type { FilterMode } from "../api";
import { confirmQty, correctQty, fetchRows, newQtyRequestId, photoUrl } from "../api";
import { photoIdsOf } from "../photos";
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
  Segmented,
  Select,
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

const MODE_OPTIONS: { value: FilterMode; label: string }[] = [
  { value: "current", label: "오늘 작업" },
  { value: "all", label: "전체 작업" },
];

/** jobKeys look like `csv_2026-10-22_2c10b50f`; show the date, which is what an operator recognises. */
function jobLabel(jobKey: string, count: number) {
  const date = jobKey.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  return `${date ?? jobKey} · ${formatNumber(count)}행`;
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
  const [mode, setMode] = useState<FilterMode>("current");
  const [jobKey, setJobKey] = useState("");
  const [query, setQuery] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<InspectionRow>();
  const [editQty, setEditQty] = useState("");
  const [pending, setPending] = useState<PendingCorrection>();
  const [busy, setBusy] = useState(false);
  const pushToast = useToast();

  const { data, error, loading, reload } = useResource(() => fetchRows({ filterMode: mode }), `rows:${mode}`);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  // A job is chosen from the rows already received: the app ignores `date`, so
  // there is nothing server-side to narrow by.
  const jobs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = text(row.작업기준일또는CSV식별값);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (jobKey && text(row.작업기준일또는CSV식별값) !== jobKey) return false;
      if (onlyIssues && !(number(row.회송수량) > 0 || number(row.교환수량) > 0 || text(row.불량사유).trim())) {
        return false;
      }
      if (!needle) return true;
      return [row.상품코드, row.상품명, row.협력사명, row["DPT명"], row.불량사유]
        .map(text)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, jobKey, query, onlyIssues]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const inspected = useMemo(() => filtered.filter((row) => number(row.검품수량) > 0).length, [filtered]);

  async function runCorrection() {
    if (!pending) return;
    setBusy(true);
    const { row, qty, requestId } = pending;
    const rowJob = text(row.작업기준일또는CSV식별값);
    const rowCode = text(row.상품코드);
    try {
      const { saved } = await correctQty({
        jobKey: rowJob,
        productCode: rowCode,
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
        const confirmation = await confirmQty(rowJob, rowCode, requestId);
        setPending({ ...pending, receipt: saved, confirmation });
        pushToast({
          tone: confirmation.matches ? "success" : "warning",
          title: confirmation.matches ? "보정이 반영되어 있습니다" : "저장 여부가 확정되지 않았습니다",
          description: confirmation.matches ? undefined : "같은 요청 ID로 다시 확인하세요. 다시 저장하지 마세요.",
        });
        return;
      }

      const confirmation = await confirmQty(rowJob, rowCode, requestId).catch(() => undefined);
      pushToast({
        tone: "success",
        title: "검품수량 보정 완료",
        description: `${text(row.상품명)} · ${number(row.검품수량)} → ${qty}`,
      });
      setPending(undefined);
      setSelected(undefined);
      setEditQty("");
      if (confirmation && confirmation.matches === false) {
        pushToast({ tone: "warning", title: "저장은 되었으나 확인 조회가 일치하지 않습니다", description: "화면을 새로 고쳐 확인하세요." });
      }
      reload();
    } catch (cause) {
      const retryable = cause instanceof Error && "retryable" in cause && (cause as { retryable?: boolean }).retryable;
      // On an uncertain outcome never resubmit; read the row back instead.
      const confirmation = retryable ? await confirmQty(rowJob, rowCode, requestId).catch(() => undefined) : undefined;
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

  const photos = selected ? photoIdsOf(selected) : [];

  return (
    <div className="page">
      <PageHeader
        icon={<IconRows size={20} aria-hidden />}
        title="검품 내역"
        description="검품 앱이 기록한 행을 그대로 조회합니다."
        meta={
          <>
            <MetaItem label="표시">{formatNumber(filtered.length)}행</MetaItem>
            <MetaItem label="검품 진행">{formatNumber(inspected)}행</MetaItem>
            {data?.sourceVersion?.version ? <MetaItem label="원본 버전">{data.sourceVersion.version}</MetaItem> : null}
            {data?.sourceVersion?.lastUpdated ? (
              <MetaItem label="원본 갱신">{data.sourceVersion.lastUpdated.slice(0, 16).replace("T", " ")} UTC</MetaItem>
            ) : null}
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
          수량 보정은 꺼져 있습니다. 허용하려면 서버에 <code>CORRECTIONS_ENABLED=true</code>를 설정하세요.
        </Notice>
      )}

      <SectionCard flush>
        <div className="table-toolbar">
          <div className="table-toolbar-group">
            <Segmented
              label="작업 범위"
              value={mode}
              options={MODE_OPTIONS}
              onChange={(value) => {
                setMode(value);
                setJobKey("");
                setPage(0);
                setSelected(undefined);
              }}
            />
            {mode === "all" && (
              <Select
                aria-label="작업(job)"
                value={jobKey}
                onChange={(event) => {
                  setJobKey(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">모든 작업 ({formatNumber(rows.length)}행)</option>
                {jobs.map(([key, count]) => (
                  <option key={key} value={key}>
                    {jobLabel(key, count)}
                  </option>
                ))}
              </Select>
            )}
            <SearchInput
              label="행 검색"
              value={query}
              onChange={(value) => {
                setQuery(value);
                setPage(0);
              }}
              placeholder="상품, 코드, 협력사, DPT, 사유"
              width={260}
            />
            <Button
              size="sm"
              variant={onlyIssues ? "primary" : "secondary"}
              onClick={() => {
                setOnlyIssues(!onlyIssues);
                setPage(0);
              }}
            >
              회송·교환·불량만
            </Button>
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
                <th>DPT</th>
                <th>상품코드</th>
                <th>상품명</th>
                <th>협력사</th>
                <th style={{ textAlign: "right" }}>발주</th>
                <th style={{ textAlign: "right" }}>검품</th>
                <th style={{ textAlign: "right" }}>회송</th>
                <th style={{ textAlign: "right" }}>교환</th>
                <th>불량사유</th>
                <th style={{ textAlign: "right" }}>사진</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, index) => {
                const count = photoIdsOf(row).length;
                const key = `${text(row.작업기준일또는CSV식별값)}-${text(row.상품코드)}-${text(row.협력사명)}-${index}`;
                return (
                  <tr
                    key={key}
                    onClick={() => {
                      setSelected(row);
                      setEditQty(String(number(row.검품수량)));
                      setPending(undefined);
                    }}
                    aria-selected={selected === row}
                    style={{ cursor: "pointer" }}
                  >
                    <td>{text(row["DPT명"]) || <span className="muted">-</span>}</td>
                    <td className="mono">{text(row.상품코드)}</td>
                    <td title={text(row.상품명)}>{text(row.상품명)}</td>
                    <td title={text(row.협력사명)}>{text(row.협력사명)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{formatNumber(number(row.발주수량))}</td>
                    <td className="num" style={{ textAlign: "right" }}>{formatNumber(number(row.검품수량))}</td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {number(row.회송수량) > 0 ? formatNumber(number(row.회송수량)) : <span className="muted">0</span>}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {number(row.교환수량) > 0 ? formatNumber(number(row.교환수량)) : <span className="muted">0</span>}
                    </td>
                    <td title={text(row.불량사유)}>{text(row.불량사유) || <span className="muted">-</span>}</td>
                    <td className="num" style={{ textAlign: "right" }}>{count || <span className="muted">0</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!pageRows.length && <EmptyState title="조건에 맞는 검품 행이 없습니다" inline />}
        </div>
      </SectionCard>

      {selected && (
        <SectionCard
          title={`${text(selected.상품명) || text(selected.상품코드)} 상세`}
          subtitle={`${text(selected["DPT명"])} · ${text(selected.협력사명)}`}
          actions={
            <Button variant="ghost" size="sm" onClick={() => setSelected(undefined)}>
              닫기
            </Button>
          }
        >
          <div className="stack" data-gap="sm">
            <div className="row">
              <Badge size="sm">발주 {formatNumber(number(selected.발주수량))}</Badge>
              <Badge tone="accent" size="sm">검품 {formatNumber(number(selected.검품수량))}</Badge>
              {number(selected.회송수량) > 0 && <Badge tone="danger" size="sm">회송 {formatNumber(number(selected.회송수량))}</Badge>}
              {number(selected.교환수량) > 0 && <Badge tone="info" size="sm">교환 {formatNumber(number(selected.교환수량))}</Badge>}
              {text(selected.불량사유) && <Badge tone="warning" size="sm">{text(selected.불량사유)}</Badge>}
            </div>

            <p className="muted mono">
              {text(selected.작업기준일또는CSV식별값)} · {text(selected.상품코드)}
              {selected.수정일시 ? ` · 수정 ${text(selected.수정일시)}` : ""}
            </p>

            {/* Photos load straight from the inspection app: the id is a signed
                capability, so an <img> needs no header from us. */}
            {photos.length > 0 && inspectionBase && (
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {photos.map((id) => (
                  <a key={id} href={photoUrl(inspectionBase, id, "w1200")} target="_blank" rel="noreferrer noopener" title="원본 크기로 열기">
                    <img
                      src={photoUrl(inspectionBase, id, "w320")}
                      alt={`${text(selected.상품명)} 검품 사진`}
                      loading="lazy"
                      style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }}
                    />
                  </a>
                ))}
              </div>
            )}
            {photos.length > 0 && !inspectionBase && (
              <p className="muted">사진 {photos.length}장 (검품 앱 주소를 알 수 없어 표시할 수 없습니다)</p>
            )}
            {photos.length === 0 && <p className="muted">등록된 사진이 없습니다.</p>}

            {correctionsEnabled && (
              <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
                <Field label="검품수량 보정" hint={`현재 ${formatNumber(number(selected.검품수량))}`}>
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
                  disabled={editQty === "" || Number(editQty) === number(selected.검품수량) || Number(editQty) < 0}
                  onClick={() => setPending({ row: selected, qty: Number(editQty), requestId: newQtyRequestId() })}
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
