import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  LoaderCircle,
  MoreVertical,
  Search,
  X,
} from "lucide-react";
import {
  useCallback,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { twMerge } from "tailwind-merge";

import { useDismissPopover, useEscapeToClose } from "@/web/features/timer/use-dismiss-popover";

const controlClassName =
  "min-h-10 min-w-0 w-full max-w-full rounded-lg border border-hourlark-control-border bg-[#1b1b1b] px-3 py-2 text-sm text-[#fafafa] placeholder:text-[#a4a4a4] outline-none focus:border-[#f59e0b]";

export function Button({
  variant = "primary",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "accent";
}) {
  const variants = {
    primary: "bg-[#f59e0b] text-[#18181b] hover:bg-[#fbbf24] hover:text-[#18181b]",
    secondary:
      "border border-hourlark-control-border bg-[#1b1b1b] text-[#fafafa] hover:border-[#f59e0b] hover:bg-white/8",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "text-[#a4a4a4] hover:bg-white/7 hover:text-[#fafafa]",
    accent: "bg-[#f59e0b] text-[#18181b] hover:bg-[#fbbf24] hover:text-[#18181b]",
  };
  return (
    <button
      className={twMerge(
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={twMerge(controlClassName, className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium text-[#a4a4a4]">
      <span>{label}</span>
      {children}
      {error ? (
        <span className="text-xs font-normal text-red-400" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="text-xs font-normal text-[#a4a4a4]">{hint}</span>
      ) : null}
    </label>
  );
}

export { Select, type SelectOption } from "@/web/components/select";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-[2px]" />
        <Dialog.Content className="dark-surface fixed top-1/2 left-1/2 z-50 flex max-h-[min(92vh,100dvh)] w-[min(94vw,620px)] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-[#3b3b3b] bg-[#212121] text-[#fafafa] shadow-2xl">
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[#3b3b3b] px-5 py-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="font-display text-lg font-bold text-[#fafafa]">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-[#a4a4a4]">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" className="h-9 w-9 shrink-0 p-0" aria-label="Close dialog">
                <X size={18} />
              </Button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5">{children}</div>
          {footer ? (
            <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[#3b3b3b] px-5 py-4">
              {footer}
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-[#a4a4a4]">
      <LoaderCircle className="animate-spin" size={20} /> {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="panel flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertCircle className="text-red-500" />
      <p className="text-sm text-[#a4a4a4]">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-2 p-8 text-center">
      <CheckCircle2 className="text-[#fbbf24]" size={28} />
      <h3 className="font-display font-semibold text-[#fafafa]">{title}</h3>
      <p className="max-w-md text-sm text-[#a4a4a4]">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Badge({ children, color }: { children: ReactNode; color?: string | null }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-[#3b3b3b] bg-white/4 px-2 py-0.5 text-xs font-medium text-[#a4a4a4]"
      style={
        color
          ? {
              borderColor: `${color}88`,
              backgroundColor: `${color}18`,
              color: "#fafafa",
            }
          : undefined
      }
    >
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="flex min-w-0 items-center gap-6">
        <h1 className="shrink-0 text-[17px] font-bold text-[#fafafa]">{title}</h1>
        {description ? <p className="sr-only">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function PageToolbar({ children }: { children: ReactNode }) {
  return <div className="page-toolbar">{children}</div>;
}

export function SearchInput({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={twMerge("relative block w-full max-w-[200px] min-w-[160px]", className)}>
      <span className="sr-only">{label}</span>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#a4a4a4]"
        size={15}
        aria-hidden="true"
      />
      <input
        type="search"
        className="border-hourlark-control-border h-9 w-full rounded-lg border bg-transparent pr-3 pl-9 text-sm text-[#fafafa] outline-none placeholder:text-[#a4a4a4] focus:border-[#f59e0b]"
        placeholder={`${label}...`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissPopover(root, close, undefined, open);
  useEscapeToClose(open, () => {
    setOpen(false);
    trigger.current?.focus();
  });
  if (items.length === 0) return null;
  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        className="grid h-8 w-8 place-items-center rounded-md text-[#a4a4a4] hover:bg-white/8 hover:text-[#fafafa]"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreVertical size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          className="timer-popover absolute top-full right-0 z-40 mt-1 min-w-40 py-1.5"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={twMerge(
                "block w-full px-4 py-2 text-left text-sm text-[#fafafa] hover:bg-white/8 disabled:opacity-50",
                item.danger && "text-red-400",
              )}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SortHeader({
  label,
  direction,
  onToggle,
}: {
  label: string;
  direction: "asc" | "desc" | null;
  onToggle: () => void;
}) {
  const Icon =
    direction === "asc" ? ChevronUp : direction === "desc" ? ChevronDown : ChevronsUpDown;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 uppercase hover:text-[#fafafa]"
      aria-label={`Sort by ${label.toLowerCase()}`}
      onClick={onToggle}
    >
      {label}
      <Icon size={13} aria-hidden="true" className={direction ? "text-[#fbbf24]" : undefined} />
    </button>
  );
}
