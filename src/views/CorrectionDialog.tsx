import { useEffect, useRef, useState } from "react";
import type { InspectionRow, QtyOutcome, QtyVerification } from "../domain/types";
import { ApiError, correctQty, verifyQty } from "../api";
import { jobOf, num } from "../lib/rowsModel";
import { Button, Notice } from "../ui";
import { IconError, IconInfo, IconOk, IconWarning } from "../ui/icons";
import { formatKst, formatNumber } from "../view-models/format";

const text = (value: unknown) => (value == null ? "" : String(value));

/**
 * One correction, from "are you sure" to "the row now says X".
 *
 * Two rules drive the whole flow:
 *
 *  1. The save response is not believed on its own. After anything that might
 *     have written, the canonical row is read back and *that* decides.
 *  2. An uncertain outcome (timeout, lost response, PENDING) is never answered
 *     by writing again. The only actions offered are reading and closing.
 *
 * `requestId` is fixed when the dialog opens, so every call this dialog makes
 * for one correction carries the same id.
 */
type Phase =
  | { kind: "review" }
  | { kind: "saving" }
  | { kind: "applied"; outcome: QtyOutcome; verification: QtyVerification }
  | { kind: "mismatch"; outcome: QtyOutcome; verification: QtyVerification }
  | { kind: "conflict"; outcome: QtyOutcome; latest?: QtyVerification }
  | { kind: "not-applied"; outcome: QtyOutcome }
  | { kind: "uncertain"; why: string; verification?: QtyVerification; verifyError?: string }
  | { kind: "failed"; message: string };

export function CorrectionDialog({
  row,
  qty,
  requestId,
  onClose,
}: {
  row: InspectionRow;
  qty: number;
  requestId: string;
  /** `changed` is true when the row may now differ from what the table shows, so the caller re-reads it. */
  onClose: (changed: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "review" });
  const [checking, setChecking] = useState(false);
  const wrote = useRef(false);

  const before = num(row.검품수량);
  const identity = {
    jobKey: jobOf(row),
    productCode: text(row.상품코드),
    partnerName: text(row.협력사명).trim(),
  };

  // Escape closes only while nothing is in flight: leaving mid-save would hide the result.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && phase.kind !== "saving") onClose(wrote.current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase.kind, onClose]);

  async function read(expectedQty: number) {
    return (await verifyQty({ ...identity, expectedQty, requestId })).verification;
  }

  async function submit() {
    setPhase({ kind: "saving" });
    wrote.current = true;
    const revision = Number(row.수량요청리비전);

    let outcome: QtyOutcome;
    try {
      ({ outcome } = await correctQty({
        ...identity,
        productName: text(row.상품명),
        qty,
        orderQty: num(row.발주수량),
        baseQty: before,
        // A blank revision means "no revision to compare"; only send one that exists.
        ...(row.수량요청리비전 !== "" && row.수량요청리비전 != null && Number.isSafeInteger(revision) ? { baseRevision: revision } : {}),
        requestId,
      }));
    } catch (cause) {
      const uncertain = cause instanceof ApiError ? cause.retryable || cause.status >= 500 : true;
      if (!uncertain) {
        // Validation or a refusal: nothing was sent to the app, nothing to verify.
        wrote.current = false;
        setPhase({ kind: "failed", message: cause instanceof Error ? cause.message : "보정에 실패했습니다." });
        return;
      }
      await resolveUncertain(cause instanceof Error ? cause.message : "응답을 받지 못했습니다.");
      return;
    }

    if (outcome.status === "conflict") {
      wrote.current = false;
      // Show what the row holds now. Nothing was written.
      const latest = await read(qty).catch(() => undefined);
      setPhase({ kind: "conflict", outcome, latest });
      return;
    }
    if (outcome.status === "stale_ignored" || outcome.status === "blocked") {
      wrote.current = false;
      setPhase({ kind: "not-applied", outcome });
      return;
    }
    if (outcome.status === "pending" || outcome.status === "unknown") {
      await resolveUncertain(outcome.message ?? "저장 결과를 확정하지 못했습니다.");
      return;
    }

    // updated / idempotent_replay: believe it only after reading the row.
    try {
      const verification = await read(qty);
      setPhase({ kind: verification.matchesQty ? "applied" : "mismatch", outcome, verification } as Phase);
    } catch (cause) {
      await resolveUncertain(cause instanceof Error ? cause.message : "저장 후 재조회에 실패했습니다.");
    }
  }

  /** Read once, automatically; reading is safe. Writing is not offered. */
  async function resolveUncertain(why: string) {
    try {
      setPhase({ kind: "uncertain", why, verification: await read(qty) });
    } catch (cause) {
      setPhase({ kind: "uncertain", why, verifyError: cause instanceof Error ? cause.message : "원본 행을 읽지 못했습니다." });
    }
  }

  async function recheck(why: string) {
    setChecking(true);
    await resolveUncertain(why);
    setChecking(false);
  }

  const delta = qty - before;
  const zero = qty === 0;
  const busy = phase.kind === "saving";

  return (
    <div className="modal-scrim">
      <div className="modal" role="dialog" aria-modal="true" aria-label="검품수량 보정" style={{ width: 520, maxWidth: "94vw" }}>
        <div className="modal-head">
          {phase.kind === "applied" ? <IconOk size={18} aria-hidden /> : <IconWarning size={18} aria-hidden />}
          <h2>{phase.kind === "review" || phase.kind === "saving" ? "검품수량 보정" : "보정 결과"}</h2>
        </div>

        <div className="modal-body">
          <div className="stack" data-gap="sm">
            <div>
              <b>{text(row.상품명) || "(상품명 없음)"}</b>
              <div className="muted">
                {text(row.협력사명) || "협력사 미지정"} · {text(row["DPT명"]) || "DPT 없음"}
              </div>
              <div className="muted mono">
                {identity.jobKey} · {identity.productCode}
              </div>
            </div>

            <div className="qty-change" aria-label="변경 전후">
              <div>
                <span>변경 전</span>
                <b>{formatNumber(before)}</b>
              </div>
              <span className="arrow" aria-hidden>
                →
              </span>
              <div data-tone={zero ? "danger" : "accent"}>
                <span>변경 후</span>
                <b>{formatNumber(qty)}</b>
              </div>
              <em data-sign={delta > 0 ? "up" : delta < 0 ? "down" : undefined}>{delta > 0 ? `+${formatNumber(delta)}` : formatNumber(delta)}</em>
            </div>

            {phase.kind === "review" && (
              <>
                {zero && (
                  <Notice tone="warning" icon={<IconWarning size={16} aria-hidden />} title="0으로 보정합니다">
                    검품 수량을 0으로 만드는 정상적인 보정입니다. 앱에는 명시적 0으로 전달됩니다.
                  </Notice>
                )}
                <Notice tone="danger" icon={<IconError size={16} aria-hidden />}>
                  검품 앱의 원본 행이 바뀝니다. 화면에 보인 수량({formatNumber(before)})
                  {Number.isSafeInteger(revision0(row)) ? "과 리비전" : ""}이 그대로일 때만 저장되고, 그 사이 다른 곳에서 바뀌었다면
                  <b> 덮어쓰지 않고 거부</b>합니다.
                </Notice>
                <span className="muted mono">requestId {requestId}</span>
              </>
            )}

            {phase.kind === "saving" && (
              <Notice tone="info" icon={<IconInfo size={16} aria-hidden />} title="저장하고 원본 행을 다시 읽는 중입니다">
                창을 닫지 마세요.
              </Notice>
            )}

            {phase.kind === "applied" && (
              <Notice tone="success" icon={<IconOk size={16} aria-hidden />} title="반영 확인됨">
                <Verification verification={phase.verification} expected={qty} />
              </Notice>
            )}

            {phase.kind === "mismatch" && (
              <Notice tone="danger" icon={<IconError size={16} aria-hidden />} title="저장은 성공했다고 했지만 원본 행의 값이 다릅니다">
                <Verification verification={phase.verification} expected={qty} />
                <p>다시 저장하지 말고, 새로 고친 뒤 원본 값을 확인하세요.</p>
              </Notice>
            )}

            {phase.kind === "conflict" && (
              <Notice tone="warning" icon={<IconWarning size={16} aria-hidden />} title="다른 곳에서 수량이 먼저 바뀌었습니다 — 저장하지 않았습니다">
                <p>
                  내가 본 값 <b>{formatNumber(before)}</b> → 지금 값{" "}
                  <b>{formatNumber(phase.outcome.currentQty ?? phase.latest?.qty ?? 0)}</b>
                  {phase.outcome.currentQty === undefined && phase.latest?.qty === undefined ? " (읽지 못함)" : ""}
                </p>
                <p className="muted">최신 값으로 화면을 갱신한 뒤, 필요하면 그 값을 기준으로 다시 보정하세요.</p>
              </Notice>
            )}

            {phase.kind === "not-applied" && (
              <Notice tone="warning" icon={<IconWarning size={16} aria-hidden />} title="적용되지 않았습니다">
                {phase.outcome.message}
              </Notice>
            )}

            {phase.kind === "uncertain" && (
              <Notice
                tone={phase.verification?.matchesQty ? "success" : "warning"}
                icon={<IconWarning size={16} aria-hidden />}
                title={
                  phase.verification
                    ? phase.verification.matchesQty
                      ? "응답은 못 받았지만 원본 행에는 반영되어 있습니다"
                      : "응답을 못 받았고, 원본 행에는 아직 반영되지 않은 것으로 보입니다"
                    : "저장 결과를 확정하지 못했습니다"
                }
              >
                <p>{phase.why}</p>
                {phase.verification && <Verification verification={phase.verification} expected={qty} />}
                {phase.verifyError && <p>원본 행 확인 실패: {phase.verifyError}</p>}
                <p>
                  <b>자동으로 다시 저장하지 않았습니다.</b> 확인만 반복할 수 있습니다.
                </p>
              </Notice>
            )}

            {phase.kind === "failed" && (
              <Notice tone="danger" icon={<IconError size={16} aria-hidden />} title="보정하지 못했습니다">
                {phase.message}
              </Notice>
            )}
          </div>
        </div>

        <div className="modal-foot">
          {phase.kind === "review" && (
            <>
              <Button variant="ghost" onClick={() => onClose(false)}>
                취소
              </Button>
              <Button variant="danger" autoFocus onClick={submit}>
                보정 저장
              </Button>
            </>
          )}
          {phase.kind === "saving" && (
            <Button variant="danger" loading disabled>
              저장 중
            </Button>
          )}
          {phase.kind === "uncertain" && (
            <>
              <Button onClick={() => recheck(phase.why)} loading={checking}>
                원본 다시 확인
              </Button>
              <Button variant="primary" onClick={() => onClose(true)} disabled={busy}>
                닫고 새로 고침
              </Button>
            </>
          )}
          {(phase.kind === "applied" || phase.kind === "mismatch" || phase.kind === "conflict" || phase.kind === "not-applied") && (
            <Button variant="primary" autoFocus onClick={() => onClose(true)}>
              {phase.kind === "conflict" ? "최신값으로 새로 고침" : "확인"}
            </Button>
          )}
          {phase.kind === "failed" && (
            <Button variant="primary" autoFocus onClick={() => onClose(false)}>
              닫기
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const revision0 = (row: InspectionRow) => (row.수량요청리비전 === "" || row.수량요청리비전 == null ? NaN : Number(row.수량요청리비전));

/** What the canonical row says, as evidence. */
function Verification({ verification, expected }: { verification: QtyVerification; expected: number }) {
  if (!verification.found) return <p>원본에서 이 행을 찾을 수 없습니다.</p>;
  return (
    <dl className="kv" style={{ marginTop: 6 }}>
      <dt>원본 검품수량</dt>
      <dd>
        <b>{verification.qty === undefined ? "-" : formatNumber(verification.qty)}</b>{" "}
        {verification.matchesQty ? "(요청값과 일치)" : `(요청값 ${formatNumber(expected)}과 다름)`}
      </dd>
      <dt>요청 ID</dt>
      <dd>{verification.matchesRequestId ? "이 요청으로 기록됨" : "이 요청으로 기록되지 않음"}</dd>
      {verification.version ? (
        <>
          <dt>버전</dt>
          <dd>{verification.version}</dd>
        </>
      ) : null}
      {verification.updatedAt ? (
        <>
          <dt>수정</dt>
          <dd>{formatKst(verification.updatedAt)}</dd>
        </>
      ) : null}
      {verification.confirm ? (
        <>
          <dt>앱 확인</dt>
          <dd>
            {verification.confirm.error
              ? "응답 없음(참고용)"
              : verification.confirm.matches
                ? `일치${verification.confirm.requestIdMatched ? " · 요청 ID 일치" : ""}`
                : "불일치"}
          </dd>
        </>
      ) : null}
    </dl>
  );
}
