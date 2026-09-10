import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { Tone } from "./Badge";
import { IconClose, IconError, IconOk, IconWarning } from "./icons";

export interface ToastItem {
  id: number;
  tone: Tone;
  title: string;
  description?: string;
}

type PushToast = (toast: Omit<ToastItem, "id">) => void;

const ToastContext = createContext<PushToast>(() => undefined);

/** Fire-and-forget feedback for actions whose result is not visible on screen. */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback<PushToast>(
    (toast) => {
      const id = nextId.current++;
      setToasts((previous) => [...previous.slice(-2), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), toast.tone === "danger" ? 9000 : 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div className="toast" key={toast.id} data-tone={toast.tone}>
            {toast.tone === "danger" ? (
              <IconError size={16} aria-hidden />
            ) : toast.tone === "warning" ? (
              <IconWarning size={16} aria-hidden />
            ) : (
              <IconOk size={16} aria-hidden />
            )}
            <div className="toast-body">
              <strong>{toast.title}</strong>
              {toast.description && <span>{toast.description}</span>}
            </div>
            <button type="button" onClick={() => dismiss(toast.id)} aria-label="알림 닫기">
              <IconClose size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
