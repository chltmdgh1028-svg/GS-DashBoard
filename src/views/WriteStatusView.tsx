import { useState } from "react";
import type { WriteReceipt } from "../domain/types";
import { confirmQty, fetchWriteStatus, recoverWrite } from "../api";
import {
  Badge,
  Button,
  Field,
  Input,
  Notice,
  PageHeader,
  SectionCard,
  Select,
  useToast,
} from "../ui";
import { IconError, IconInfo, IconReceipt } from "../ui/icons";

/** The write kinds the inspection app keeps a receipt ledger for. */
const KINDS = [
  "action_status",
  "ai_feedback_save",
  "ai_feedback_reconcile",
  "history_sync",
  "inspection_full",
  "brix",
  "weight",
];

const STATE_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  COMMITTED: "success",
  REJECTED: "danger",
  PENDING: "warning",
  UNKNOWN: "warning",
};

export function WriteStatusView({ correctionsEnabled }: { correctionsEnabled: boolean }) {
  const [kind, setKind] = useState("action_status");
  const [operationId, setOperationId] = useState("");
  const [payloadHash, setPayloadHash] = useState("");
  const [receipt, setReceipt] = useState<WriteReceipt>();
  const [busy, setBusy] = useState(false);
  const pushToast = useToast();

  // A qty correction is confirmed by reading the row, not from the ledger, so
  // it gets its own lookup keyed by the request id the correction used.
  const [jobKey, setJobKey] = useState("");
  const [productCode, setProductCode] = useState("");
  const [requestId, setRequestId] = useState("");
  const [qtyResult, setQtyResult] = useState<string>();

  const ready = operationId.trim() !== "" && payloadHash.trim() !== "";

  async function run(action: "status" | "recover") {
    if (!ready) return;
    setBusy(true);
    try {
      const result =
        action === "status"
          ? await fetchWriteStatus(operationId.trim(), kind, payloadHash.trim())
          : await recoverWrite(operationId.trim(), kind, payloadHash.trim(), "console recovery");
      setReceipt(result);
    } catch (cause) {
      setReceipt(undefined);
      pushToast({
        tone: "danger",
        title: action === "status" ? "상태 조회에 실패했습니다" : "복구 요청에 실패했습니다",
        description: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function runQtyConfirm() {
    if (!jobKey.trim() || !productCode.trim()) return;
    setBusy(true);
    try {
      const result = await confirmQty(jobKey.trim(), productCode.trim(), requestId.trim());
      setQtyResult(
        result.matches
          ? requestId.trim()
            ? result.requestIdMatched
              ? "이 요청이 원본 행에 반영되어 있습니다."
              : "행은 일치하지만 이 requestId로 기록된 것은 아닙니다."
            : "행이 일치합니다."
          : "원본 행이 조회 조건과 일치하지 않습니다. 보정이 반영되지 않았을 수 있습니다.",
      );
    } catch (cause) {
      setQtyResult(cause instanceof Error ? cause.message : "확인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const ack = receipt?.nativeAck;
  const state = String(ack?.state ?? "");

  return (
    <div className="page">
      <PageHeader
        icon={<IconReceipt size={20} aria-hidden />}
        title="저장 / 복구 상태"
        description="저장 결과가 불확실할 때 다시 저장하지 않고 영수증을 읽어 확인합니다."
      />

      <Notice tone="info" icon={<IconInfo size={16} aria-hidden />} title="다시 저장하지 마세요">
        응답이 유실되었거나 PENDING으로 끝난 저장은 이미 반영되었을 수 있습니다. 같은 operationId로 상태를
        조회하고, 필요하면 복구를 요청하세요. 같은 내용을 다시 저장하면 중복이 생길 수 있습니다.
        영수증은 operationId와 payloadHash를 둘 다 알아야 찾을 수 있습니다. 수량 보정은 이 방식이 아니라 아래
        "수량 보정 확인"으로 원본 행을 읽어 확인합니다.
      </Notice>

      <SectionCard title="네이티브 저장 영수증" subtitle="operationId로 조회">
        <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
          <Field label="kind">
            <Select value={kind} onChange={(event) => setKind(event.target.value)}>
              {KINDS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="operationId">
            <Input value={operationId} onChange={(event) => setOperationId(event.target.value)} style={{ width: 300 }} />
          </Field>
          <Field label="payloadHash" hint="필수 · 저장 요청 내용의 지문(sha256)">
            <Input value={payloadHash} onChange={(event) => setPayloadHash(event.target.value)} style={{ width: 220 }} />
          </Field>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => run("status")}>
            상태 조회
          </Button>
          <Button
            variant="danger"
            disabled={!correctionsEnabled || !ready || busy}
            title={correctionsEnabled ? undefined : "CORRECTIONS_ENABLED=true 일 때만 사용할 수 있습니다"}
            onClick={() => run("recover")}
          >
            복구 요청
          </Button>
        </div>

        {receipt && (
          <div className="stack" data-gap="sm" style={{ marginTop: 16 }}>
            <div className="row">
              {state && <Badge tone={STATE_TONE[state] ?? "neutral"} size="sm">{state}</Badge>}
              {ack?.authoritative === true && <Badge tone="success" size="sm">authoritative</Badge>}
              {receipt.pendingWrite && <Badge tone="warning" size="sm">pending</Badge>}
            </div>
            {receipt.message && <p className="muted">{receipt.message}</p>}
            <pre className="mono" style={{ maxHeight: 280, overflow: "auto", margin: 0 }}>
              {JSON.stringify(receipt, null, 2)}
            </pre>
          </div>
        )}
      </SectionCard>

      <SectionCard title="수량 보정 확인" subtitle="원본 행을 읽어 반영 여부를 판정">
        <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
          <Field label="작업기준일/CSV 식별값">
            <Input value={jobKey} onChange={(event) => setJobKey(event.target.value)} style={{ width: 260 }} />
          </Field>
          <Field label="상품코드">
            <Input value={productCode} onChange={(event) => setProductCode(event.target.value)} style={{ width: 160 }} />
          </Field>
          <Field label="requestId" hint="보정 시 사용한 qty-… 값">
            <Input value={requestId} onChange={(event) => setRequestId(event.target.value)} style={{ width: 300 }} />
          </Field>
          <Button variant="primary" loading={busy} disabled={!jobKey.trim() || !productCode.trim()} onClick={runQtyConfirm}>
            확인
          </Button>
        </div>
        {qtyResult && (
          <Notice tone="info" icon={<IconError size={16} aria-hidden />} title="확인 결과">
            {qtyResult}
          </Notice>
        )}
      </SectionCard>
    </div>
  );
}
