import { useState } from "react";
import type { QtyVerification, WriteReceipt } from "../domain/types";
import { fetchWriteStatus, recoverWrite, verifyQty } from "../api";
import { Badge, Button, Field, Input, Notice, PageHeader, SectionCard, Select, useToast } from "../ui";
import { IconInfo, IconReceipt } from "../ui/icons";
import { formatNumber } from "../view-models/format";

/** The write kinds the inspection app keeps a receipt ledger for. */
const KINDS = ["action_status", "ai_feedback_save", "ai_feedback_reconcile", "history_sync", "inspection_full", "brix", "weight"];

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

  // A qty correction is resolved by reading the row, not from the receipt ledger.
  const [jobKey, setJobKey] = useState("");
  const [productCode, setProductCode] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [expectedQty, setExpectedQty] = useState("");
  const [requestId, setRequestId] = useState("");
  const [verification, setVerification] = useState<QtyVerification>();
  const [verifyError, setVerifyError] = useState<string>();

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

  const qtyReady = jobKey.trim() !== "" && productCode.trim() !== "" && partnerName.trim() !== "" && expectedQty.trim() !== "";

  async function runVerify() {
    if (!qtyReady) return;
    setBusy(true);
    setVerifyError(undefined);
    try {
      setVerification(
        (
          await verifyQty({
            jobKey: jobKey.trim(),
            productCode: productCode.trim(),
            partnerName: partnerName.trim(),
            expectedQty: Number(expectedQty),
            requestId: requestId.trim(),
          })
        ).verification,
      );
    } catch (cause) {
      setVerification(undefined);
      setVerifyError(cause instanceof Error ? cause.message : "확인에 실패했습니다.");
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
        description="저장 결과가 불확실할 때 다시 저장하지 않고 원본을 읽어 확인합니다."
      />

      <Notice tone="info" icon={<IconInfo size={16} aria-hidden />} title="다시 저장하지 마세요">
        응답이 유실되었거나 PENDING으로 끝난 저장은 이미 반영되었을 수 있습니다. 아래에서 확인만 하세요. 영수증은
        operationId와 payloadHash를 둘 다 알아야 찾을 수 있고, 수량 보정은 영수증이 아니라 원본 행을 읽어 확인합니다.
      </Notice>

      <SectionCard title="수량 보정 확인" subtitle="원본 행을 다시 읽어 반영 여부를 판정 (읽기 전용)">
        <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
          <Field label="작업(jobKey)">
            <Input value={jobKey} onChange={(event) => setJobKey(event.target.value)} style={{ width: 240 }} />
          </Field>
          <Field label="상품코드">
            <Input value={productCode} onChange={(event) => setProductCode(event.target.value)} style={{ width: 150 }} />
          </Field>
          <Field label="협력사명">
            <Input value={partnerName} onChange={(event) => setPartnerName(event.target.value)} style={{ width: 200 }} />
          </Field>
          <Field label="기대 수량">
            <Input type="number" min={0} value={expectedQty} onChange={(event) => setExpectedQty(event.target.value)} style={{ width: 100 }} />
          </Field>
          <Field label="requestId" hint="선택 · 보정 때 쓴 qty-… 값">
            <Input value={requestId} onChange={(event) => setRequestId(event.target.value)} style={{ width: 260 }} />
          </Field>
          <Button variant="primary" loading={busy} disabled={!qtyReady} onClick={runVerify}>
            원본 확인
          </Button>
        </div>

        {verifyError && (
          <Notice tone="danger" title="확인에 실패했습니다">
            {verifyError}
          </Notice>
        )}
        {verification && (
          <div className="stack" data-gap="sm" style={{ marginTop: 16 }}>
            <div className="row">
              <Badge tone={verification.found ? (verification.matchesQty ? "success" : "warning") : "danger"} size="sm">
                {!verification.found ? "행 없음" : verification.matchesQty ? "기대 수량과 일치" : "기대 수량과 다름"}
              </Badge>
              {requestId.trim() && (
                <Badge tone={verification.matchesRequestId ? "success" : "neutral"} size="sm">
                  {verification.matchesRequestId ? "요청 ID 일치" : "요청 ID 불일치"}
                </Badge>
              )}
            </div>
            {verification.found && (
              <dl className="kv">
                <dt>원본 검품수량</dt>
                <dd>{verification.qty === undefined ? "-" : formatNumber(verification.qty)}</dd>
                <dt>원본 요청 ID</dt>
                <dd className="mono">{verification.requestId || "-"}</dd>
                <dt>버전</dt>
                <dd>{verification.version || "-"}</dd>
                <dt>수정</dt>
                <dd>{verification.updatedAt || "-"}</dd>
              </dl>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard title="네이티브 저장 영수증" subtitle="operationId + payloadHash로 조회 (수량 보정 외 저장용)">
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
              {state && (
                <Badge tone={STATE_TONE[state] ?? "neutral"} size="sm">
                  {state}
                </Badge>
              )}
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
    </div>
  );
}
