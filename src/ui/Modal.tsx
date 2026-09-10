import type { ReactNode } from "react";
import { useEffect } from "react";
import { Button } from "./primitives";
import { IconWarning } from "./icons";

/**
 * Confirmation dialog for actions that write to the central server.
 * Escape closes, focus lands on the confirm button, and the backdrop click is
 * intentionally inert so a mis-click cannot discard a half-read warning.
 */
export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  cancelLabel = "취소",
  tone = "primary",
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-scrim">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          {tone === "danger" && <IconWarning size={18} aria-hidden />}
          <h2>{title}</h2>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            autoFocus
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
