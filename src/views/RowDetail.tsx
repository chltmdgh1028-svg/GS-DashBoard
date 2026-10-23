import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useState } from "react";
import type { InspectionRow } from "../domain/types";
import { photoUrl } from "../api";
import { photoIdsOf } from "../photos";
import { num } from "../lib/rowsModel";
import { Button, Field, Input } from "../ui";
import { IconCamera, IconClose } from "../ui/icons";
import { formatKst, formatNumber } from "../view-models/format";

const text = (value: unknown) => (value == null ? "" : String(value));

/** One big preview with a thumbnail strip. The big image opens the original in a new tab. */
function Photos({ ids, base, alt }: { ids: string[]; base: string | null; alt: string }) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

  if (!ids.length) {
    return (
      <div className="photo-main">
        <span className="cell-photo" data-empty="true">
          <IconCamera size={16} aria-hidden /> 등록된 사진이 없습니다
        </span>
      </div>
    );
  }
  if (!base) {
    return <div className="photo-main">검품 앱 주소를 알 수 없어 사진을 표시할 수 없습니다 ({ids.length}장)</div>;
  }

  const current = ids[Math.min(index, ids.length - 1)];
  const markFailed = (id: string) => setFailed((previous) => new Set(previous).add(id));

  return (
    <>
      <div className="photo-main">
        {failed.has(current) ? (
          <span>사진을 불러올 수 없습니다</span>
        ) : (
          <a href={photoUrl(base, current, "w1200")} target="_blank" rel="noreferrer noopener" title="원본 크기로 열기">
            <img src={photoUrl(base, current, "w640")} alt={alt} onError={() => markFailed(current)} />
          </a>
        )}
      </div>
      {ids.length > 1 && (
        <div className="photo-strip" role="list" aria-label="사진 목록">
          {ids.map((id, position) => (
            <button
              key={id}
              type="button"
              role="listitem"
              aria-label={`사진 ${position + 1}`}
              aria-current={position === index}
              onClick={() => setIndex(position)}
            >
              <img src={photoUrl(base, id, "w160")} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      <div className="photo-count">
        <span>
          {Math.min(index, ids.length - 1) + 1} / {ids.length}
        </span>
        <span>클릭하면 원본 크기로 열립니다</span>
      </div>
    </>
  );
}

export const DETAIL_MIN = 300;
export const DETAIL_MAX = 640;
export const DETAIL_DEFAULT = 340;
const clampWidth = (value: number) => Math.min(DETAIL_MAX, Math.max(DETAIL_MIN, Math.round(value)));

export function RowDetail({
  row,
  inspectionBase,
  correctionsEnabled,
  correctionNote,
  width,
  onWidthChange,
  onClose,
  onCorrect,
}: {
  row: InspectionRow;
  inspectionBase: string | null;
  /** True only when corrections are on AND this row's job may be corrected. */
  correctionsEnabled: boolean;
  /** Why a correction is unavailable, when corrections are on but this row is out of scope. */
  correctionNote?: string;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  onCorrect: (qty: number) => void;
}) {
  const [dragging, setDragging] = useState(false);

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    setDragging(true);
    document.body.style.userSelect = "none";
    const move = (moveEvent: PointerEvent) => onWidthChange(clampWidth(startWidth + (startX - moveEvent.clientX)));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.style.userSelect = "";
      setDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  // The same adjustment from the keyboard, so the handle is not pointer-only.
  function onResizeKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") onWidthChange(clampWidth(width + 24));
    else if (event.key === "ArrowRight") onWidthChange(clampWidth(width - 24));
    else return;
    event.preventDefault();
  }

  const [qty, setQty] = useState(String(num(row.검품수량)));
  const [seenQty, setSeenQty] = useState(num(row.검품수량));
  // The row was re-read (after a correction or a conflict): restart the input from the new value.
  if (seenQty !== num(row.검품수량)) {
    setSeenQty(num(row.검품수량));
    setQty(String(num(row.검품수량)));
  }
  const ids = photoIdsOf(row);
  const reasons = text(row.불량사유)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const q = (label: string, value: unknown, tone?: string) => (
    <div className="qty" data-tone={tone} data-zero={num(value) === 0 && tone !== "accent" ? "true" : undefined}>
      <span>{label}</span>
      <b>{formatNumber(num(value))}</b>
    </div>
  );

  const edited = qty !== "" && Number(qty) !== num(row.검품수량) && Number(qty) >= 0 && Number.isInteger(Number(qty));

  return (
    <aside className="detail" aria-label="행 상세" style={{ ["--detail-w" as string]: `${width}px` }}>
      <div
        className="detail-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="상세 패널 너비 조절"
        aria-valuemin={DETAIL_MIN}
        aria-valuemax={DETAIL_MAX}
        aria-valuenow={width}
        tabIndex={0}
        data-dragging={dragging || undefined}
        onPointerDown={startResize}
        onKeyDown={onResizeKey}
      />
      <div className="detail-head">
        <div className="t">
          <h2>{text(row.상품명) || `(상품명 없음) ${text(row.상품코드)}`}</h2>
          <p>
            {text(row.협력사명) || "협력사 미지정"}
            {row["DPT명"] ? ` · ${text(row["DPT명"])}` : ""}
          </p>
        </div>
        <Button variant="ghost" size="sm" iconOnly aria-label="닫기" icon={<IconClose size={16} aria-hidden />} onClick={onClose} />
      </div>

      <div className="detail-body">
        <section className="detail-section">
          <h3>수량</h3>
          <div className="qty-grid">
            {q("발주", row.발주수량)}
            {q("검품", row.검품수량, "accent")}
            {q("회송", row.회송수량, "danger")}
            {q("교환", row.교환수량, "info")}
          </div>
        </section>

        {reasons.length > 0 && (
          <section className="detail-section">
            <h3>불량 사유</h3>
            <div className="row" style={{ gap: 6 }}>
              {reasons.map((reason) => (
                <span key={reason} className="tag">
                  {reason}
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="detail-section">
          <h3>사진 {ids.length > 0 ? `(${ids.length})` : ""}</h3>
          <Photos key={text(row.상품코드) + text(row.작업기준일또는CSV식별값)} ids={ids} base={inspectionBase} alt={`${text(row.상품명)} 검품 사진`} />
        </section>

        <section className="detail-section">
          <h3>식별 정보</h3>
          <dl className="kv">
            <dt>상품코드</dt>
            <dd className="mono">{text(row.상품코드)}</dd>
            <dt>작업</dt>
            <dd className="mono">{text(row.작업기준일또는CSV식별값)}</dd>
            {row.소분류명 ? (
              <>
                <dt>소분류</dt>
                <dd>{text(row.소분류명)}</dd>
              </>
            ) : null}
            {row.작성일시 ? (
              <>
                <dt>작성</dt>
                <dd>{formatKst(row.작성일시)}</dd>
              </>
            ) : null}
            {row.수정일시 ? (
              <>
                <dt>수정</dt>
                <dd>{formatKst(row.수정일시)}</dd>
              </>
            ) : null}
            {row.버전 !== undefined ? (
              <>
                <dt>버전</dt>
                <dd>{text(row.버전)}</dd>
              </>
            ) : null}
          </dl>
        </section>

        {!correctionsEnabled && correctionNote && (
          <section className="detail-section">
            <h3>검품수량 보정</h3>
            <p className="muted">{correctionNote}</p>
          </section>
        )}

        {correctionsEnabled && (
          <section className="detail-section">
            <h3>검품수량 보정</h3>
            <div className="row" style={{ alignItems: "flex-end", gap: 8 }}>
              <Field label="새 수량" hint={`현재 ${formatNumber(num(row.검품수량))}`}>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={qty}
                  onChange={(event) => setQty(event.target.value)}
                  style={{ width: 120 }}
                />
              </Field>
              <Button variant="danger" disabled={!edited} onClick={() => onCorrect(Number(qty))}>
                보정
              </Button>
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
