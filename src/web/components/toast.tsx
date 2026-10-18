import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastInput = {
  /** Bold first line, e.g. "Success". */
  title?: string;
  message: string;
  /** Text-style button on the right, e.g. UNDO or VIEW. */
  action?: { label: string; onSelect: () => void };
  /** Milliseconds before dismissal while not hovered (default 5000). */
  duration?: number;
};

type ToastItem = ToastInput & { id: number };

const noop = () => {};
const ToastContext = createContext<(toast: ToastInput) => void>(noop);

/** Shows a toast; a no-op when no `ToastProvider` is mounted (e.g. isolated component tests). */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const show = useCallback((toast: ToastInput) => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((current) => [...current, { ...toast, id }]);
  }, []);
  const dismiss = useCallback(
    (id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)),
    [],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed right-[25px] bottom-[30px] z-[80] flex flex-col items-end gap-2"
      >
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Toggl toast: 320px card on the surface colour (1px #3a3a3a, radius 8, soft shadow). The action
 * is a 11px/600 uppercase text button behind a divider. Pausing on hover keeps it readable.
 */
export function Toast({
  title,
  message,
  action,
  duration = 5000,
  onDismiss,
}: ToastInput & { onDismiss: () => void }) {
  const [hovered, setHovered] = useState(false);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);
  useEffect(() => {
    if (hovered) return;
    const timer = window.setTimeout(() => dismissRef.current(), duration);
    return () => window.clearTimeout(timer);
  }, [duration, hovered]);
  return (
    <div
      className="border-stroke bg-surface text-fg pointer-events-auto flex w-80 max-w-[calc(100vw-50px)] items-stretch overflow-hidden rounded-lg border text-sm font-medium shadow-[0_1px_3px_rgb(0_0_0/32%)]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="min-w-0 flex-1 px-4 py-[15px] leading-[21px]">
        {title ? <p className="font-semibold">{title}</p> : null}
        <p>{message}</p>
      </div>
      {action ? (
        <button
          type="button"
          className="border-stroke text-accent-fg hover:text-accent-fg-active border-l px-[15px] text-[11px] font-semibold tracking-[0.4px] uppercase"
          onClick={() => {
            action.onSelect();
            onDismiss();
          }}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
