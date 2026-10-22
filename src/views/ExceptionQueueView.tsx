import { useMemo, useState } from "react";
import type { DecisionAction, ExceptionKind } from "../domain/types";
import type { QueuedException } from "../api";
import { decideException, fetchExceptions } from "../api";
import { useResource } from "../useResource";
import type { Column } from "../ui";
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  ErrorState,
  ExceptionStateBadge,
  Field,
  LoadingState,
  MetaItem,
  PageHeader,
  SearchInput,
  SectionCard,
  Segmented,
  Textarea,
  ValidationBadge,
  useToast,
} from "../ui";
import { IconExceptionQueue, IconOverdue } from "../ui/icons";
import { formatNumber, formatPercent, formatDateTime, formatRelativeTime } from "../view-models/format";

const KIND_LABELS: Record<ExceptionKind, string> = {
  defect_critical: "불량 긴급",
  return_pending: "반품 승인",
  exchange_pending: "교환 승인",
  inspection_shortfall: "검품률 미달",
  photo_missing: "증빙 누락",
};

type StateFilter = "pending" | "overdue" | "resolved" | "all";

const STATE_OPTIONS: { value: StateFilter; label: string }[] = [
  { value: "pending", label: "처리 대기" },
  { value: "overdue", label: "기한 초과" },
  { value: "resolved", label: "처리 완료" },
  { value: "all", label: "전체" },
];

/**
 * What each decision means, and how it reads back to the operator. `approve`
 * and `reject` are deliberately phrased per kind: "승인" on a return is not the
 * same act as "승인" on a shortfall, and an audit trail that blurs the two is
 * worse than no trail.
 */
const ACTION_LABELS: Record<DecisionAction, string> = {
  approve: "승인",
  reject: "반려",
  hold: "보류",
  dismiss: "해당 없음",
};

interface PendingDecision {
  item: QueuedException;
  action: DecisionAction;
}

export function ExceptionQueueView({ date }: { date: string }) {
  const [stateFilter, setStateFilter] = useState<StateFilter>("pending");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<PendingDecision>();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const pushToast = useToast();

  const { data, error, loading, reload } = useResource(
    () => fetchExceptions(stateFilter, date),
    `exceptions:${stateFilter}:${date}`,
  );

  const rows = useMemo(() => {
    const items = data?.items ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [item.productName, item.sku, item.supplier, item.inspector, item.center, item.summary]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [data, query]);

  async function confirmDecision() {
    if (!pending) return;
    setBusy(true);
    try {
      await decideException(pending.item.id, pending.action, data?.businessDate ?? date, note.trim() || undefined);
      pushToast({
        tone: "success",
        title: `${KIND_LABELS[pending.item.kind]} · ${ACTION_LABELS[pending.action]} 처리`,
        description: `${pending.item.center} · ${pending.item.productName}`,
      });
      setPending(undefined);
      setNote("");
      reload();
    } catch (cause) {
      pushToast({
        tone: "danger",
        title: "처리에 실패했습니다",
        description: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<QueuedException>[] = [
    {
      key: "severity",
      header: "등급",
      sticky: true,
      width: 90,
      render: (row) => <ValidationBadge severity={row.severity} />,
      sortValue: (row) => ({ error: 0, warning: 1, info: 2 })[row.severity],
    },
    {
      key: "kind",
      header: "유형",
      width: 110,
      render: (row) => <Badge size="sm">{KIND_LABELS[row.kind]}</Badge>,
      sortValue: (row) => KIND_LABELS[row.kind],
    },
    {
      key: "center",
      header: "센터",
      width: 110,
      render: (row) => row.center,
      sortValue: (row) => row.center,
    },
    {
      key: "product",
      header: "상품",
      width: 200,
      render: (row) => (
        <div>
          <div className="trunc" style={{ ["--trunc-w" as string]: "190px" }} title={row.productName}>
            {row.productName}
          </div>
          <span className="muted mono">{row.sku}</span>
        </div>
      ),
      sortValue: (row) => row.productName,
    },
    {
      key: "summary",
      header: "내용",
      width: 240,
      render: (row) => (
        <span className="trunc" style={{ ["--trunc-w" as string]: "230px" }} title={row.summary}>
          {row.summary}
        </span>
      ),
      sortValue: (row) => row.summary,
    },
    {
      key: "qty",
      header: "수량",
      align: "right",
      width: 80,
      render: (row) => <span className="num">{row.qty == null ? "-" : formatNumber(row.qty)}</span>,
      sortValue: (row) => row.qty,
    },
    {
      key: "defectRate",
      header: "불량률",
      align: "right",
      width: 90,
      render: (row) => <span className="num">{formatPercent(row.defectRate)}</span>,
      sortValue: (row) => row.defectRate,
    },
    {
      key: "supplier",
      header: "협력사",
      width: 120,
      render: (row) => (
        <span className="trunc" style={{ ["--trunc-w" as string]: "110px" }} title={row.supplier}>
          {row.supplier}
        </span>
      ),
      sortValue: (row) => row.supplier,
    },
    {
      key: "dueAt",
      header: "처리 기한",
      width: 130,
      render: (row) =>
        row.overdue ? (
          <Badge tone="danger" size="sm" icon={<IconOverdue size={12} aria-hidden />} title={formatDateTime(row.dueAt)}>
            {formatRelativeTime(row.dueAt)}
          </Badge>
        ) : (
          <span className="muted" title={formatDateTime(row.dueAt)}>
            {formatDateTime(row.dueAt)}
          </span>
        ),
      sortValue: (row) => row.dueAt,
    },
    {
      key: "state",
      header: "상태",
      width: 110,
      render: (row) => (
        <ExceptionStateBadge
          state={row.state}
        />
      ),
      sortValue: (row) => row.state,
    },
    {
      key: "decision",
      header: "처리",
      width: 230,
      render: (row) =>
        row.decision ? (
          <span className="muted" title={row.decision.note}>
            {ACTION_LABELS[row.decision.action]} · {row.decision.decidedBy} · {formatDateTime(row.decision.decidedAt)}
          </span>
        ) : (
          <div className="row" style={{ gap: 4 }}>
            <Button size="sm" variant="primary" onClick={() => setPending({ item: row, action: "approve" })}>
              승인
            </Button>
            <Button size="sm" onClick={() => setPending({ item: row, action: "reject" })}>
              반려
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending({ item: row, action: "hold" })}>
              보류
            </Button>
          </div>
        ),
    },
  ];

  if (loading && !data) return <LoadingState label="예외 항목을 불러오는 중" />;
  if (error) {
    return (
      <ErrorState
        title="예외 항목을 불러올 수 없습니다"
        description={error}
        actions={<Button onClick={reload}>다시 시도</Button>}
      />
    );
  }

  return (
    <div className="page">
      <PageHeader
        icon={<IconExceptionQueue size={20} aria-hidden />}
        title="예외 처리"
        description="현장에서 판단할 수 없어 운영 결정이 필요한 검품 건입니다."
        meta={
          <>
            <MetaItem label="운영일">{data?.businessDate ?? date}</MetaItem>
            <MetaItem label="범위">{data?.scope.label ?? "-"}</MetaItem>
            <MetaItem label="표시">{formatNumber(rows.length)}건</MetaItem>
          </>
        }
        actions={
          <Button onClick={reload} loading={loading}>
            새로 고침
          </Button>
        }
      />

      <SectionCard flush>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          rowTone={(row) => (row.overdue ? "attention" : undefined)}
          density="compact"
          autoHeight
          emptyTitle={stateFilter === "pending" ? "처리할 예외가 없습니다" : "조건에 맞는 항목이 없습니다"}
          emptyDescription={stateFilter === "pending" ? "모든 검품 예외가 처리되었습니다." : undefined}
          toolbar={
            <div className="table-toolbar">
              <div className="table-toolbar-group">
                <Segmented
                  label="상태 필터"
                  value={stateFilter}
                  options={STATE_OPTIONS}
                  onChange={setStateFilter}
                />
              </div>
              <div className="spacer" />
              <div className="table-toolbar-group">
                <SearchInput
                  label="예외 검색"
                  value={query}
                  onChange={setQuery}
                  placeholder="상품, SKU, 협력사, 담당"
                  width={260}
                />
              </div>
            </div>
          }
        />
      </SectionCard>

      <ConfirmDialog
        open={Boolean(pending)}
        title={pending ? `${KIND_LABELS[pending.item.kind]} · ${ACTION_LABELS[pending.action]}` : ""}
        confirmLabel={pending ? ACTION_LABELS[pending.action] : ""}
        tone={pending?.action === "reject" ? "danger" : "primary"}
        busy={busy}
        onConfirm={confirmDecision}
        onCancel={() => {
          setPending(undefined);
          setNote("");
        }}
      >
        {pending && (
          <div className="stack" data-gap="sm">
            <p>
              <b>{pending.item.center}</b> · {pending.item.productName}
              <br />
              <span className="muted">{pending.item.summary}</span>
            </p>
            <Field label="처리 메모" hint="처리 이력에 함께 기록됩니다. 선택 항목입니다.">
              <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
