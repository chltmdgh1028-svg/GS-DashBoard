/**
 * Reading the result of `saveInspectionQtyFastBatch`.
 *
 * The one thing that must not be got wrong: a rejected correction comes back
 * as `ok: true`. In the app's `app_save_qty_batch`, `ok` means "every row that
 * was not a CAS conflict was saved and read back", so a single row that loses
 * the compare-and-set has `savedCount: 0`, `casConflictCount: 1` and still
 * `ok: true`. Reading `ok` alone reports a conflict as a success and tells an
 * operator a correction landed when the row was left untouched.
 *
 * The truth is per row, in `data.inspectionItemResults[].status`:
 *
 *   updated            written and read back in the same transaction
 *   idempotent_replay  this requestId was already saved with this qty
 *   conflict           baseQty / baseRevision no longer match the stored row
 *   stale_ignored      the stored row carries a newer request; this one was dropped
 *   append_blocked_*   no live row to correct, and an append is not allowed
 *   inserted           a NEW row was created - never what a correction means
 */
import type { QtyOutcome } from "../src/domain/types.js";
import type { GasEnvelope } from "./inspectionApi.js";

interface ItemResult {
  status?: string;
  reason?: string;
  savedQty?: unknown;
  currentQty?: unknown;
  currentRevision?: unknown;
  requestedQty?: unknown;
}

const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return value === "" || value == null || !Number.isFinite(parsed) ? undefined : parsed;
};

export function parseQtySave(saved: GasEnvelope, expectedQty: number): QtyOutcome {
  if (saved.pendingWrite || saved.isTransient === true) {
    return {
      status: "pending",
      message: saved.message ?? "저장 결과를 확인 중입니다. 다시 저장하지 말고 원본 행을 확인하세요.",
    };
  }

  const data = (saved.data ?? {}) as { inspectionItemResults?: ItemResult[]; inspectionRows?: Record<string, unknown>[] };
  const items = Array.isArray(data.inspectionItemResults) ? data.inspectionItemResults : [];

  // Exactly one row is ever sent, so exactly one result must come back. Anything
  // else is not something to interpret; it is something to verify by reading.
  if (items.length !== 1) {
    return { status: "unknown", message: `저장 결과가 ${items.length}건입니다(1건 예상). 원본 행으로 확인하세요.` };
  }

  const item = items[0];
  const status = String(item.status ?? "");
  const row = Array.isArray(data.inspectionRows) ? data.inspectionRows[0] : undefined;
  const common = {
    reason: item.reason ? String(item.reason) : undefined,
    version: row?.["버전"] != null ? String(row["버전"]) : undefined,
    updatedAt: row?.["수정일시"] != null ? String(row["수정일시"]) : undefined,
  };

  if (status === "updated" || status === "idempotent_replay") {
    const savedQty = asNumber(item.savedQty);
    // The row says it saved something other than what was asked: not a success.
    if (savedQty !== expectedQty) {
      return {
        status: "unknown",
        ...common,
        savedQty,
        message: `요청 수량(${expectedQty})과 저장 수량(${savedQty ?? "없음"})이 다릅니다. 원본 행으로 확인하세요.`,
      };
    }
    return { status: status as "updated" | "idempotent_replay", ...common, savedQty };
  }

  if (status === "conflict") {
    return {
      status: "conflict",
      ...common,
      currentQty: asNumber(item.currentQty) ?? asNumber(item.savedQty),
      currentRevision: asNumber(item.currentRevision),
      message: "다른 곳에서 수량이 먼저 바뀌어 저장하지 않았습니다. 덮어쓰지 않았습니다.",
    };
  }

  if (status === "stale_ignored") {
    return {
      status: "stale_ignored",
      ...common,
      currentQty: asNumber(item.savedQty),
      message: "원본 행에 더 최신 요청이 있어 이 보정은 무시되었습니다.",
    };
  }

  if (status.startsWith("append_blocked")) {
    return { status: "blocked", ...common, message: "수정할 원본 행이 없어 저장하지 않았습니다." };
  }

  if (status === "inserted") {
    // A correction must never create a row. Say so loudly: this one already exists now.
    return { status: "unknown", ...common, message: "원본 행이 없어 새 행이 생성되었습니다. 즉시 확인이 필요합니다." };
  }

  return { status: "unknown", ...common, message: `알 수 없는 저장 결과입니다(${status || "status 없음"}).` };
}
