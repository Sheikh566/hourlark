import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, CheckCircle2, LoaderCircle, X } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { twMerge } from "tailwind-merge";

export function Button({
  variant = "primary",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "accent";
}) {
  const variants = {
    primary: "bg-frosted-mint-700 text-white hover:bg-frosted-mint-600",
    secondary:
      "border border-white/15 bg-white/4 text-slate-200 hover:border-frosted-mint-700 hover:bg-white/8",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "text-slate-400 hover:bg-white/7 hover:text-slate-100",
    accent: "bg-light-green-500 text-light-green-950 hover:bg-light-green-600 hover:text-white",
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
  return (
    <input
      className={twMerge(
        "min-h-10 w-full rounded-lg border border-white/15 bg-[#111710] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-300">
      <span>{label}</span>
      {children}
      {hint ? <span className="text-xs font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={twMerge(
        "min-h-10 w-full rounded-lg border border-white/15 bg-[#111710] px-3 py-2 text-sm text-slate-100",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

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
        <Dialog.Content className="dark-surface fixed top-1/2 left-1/2 z-50 max-h-[92vh] w-[min(94vw,620px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-white/12 bg-[#171d16] text-slate-200 shadow-2xl">
          <header className="flex items-start justify-between border-b border-white/10 px-5 py-4">
            <div>
              <Dialog.Title className="text-lg font-bold text-slate-100">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-slate-500">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" className="h-9 w-9 p-0" aria-label="Close dialog">
                <X size={18} />
              </Button>
            </Dialog.Close>
          </header>
          <div className="p-5">{children}</div>
          {footer ? (
            <footer className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
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
    <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-500">
      <LoaderCircle className="animate-spin" size={20} /> {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="panel flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertCircle className="text-red-500" />
      <p className="text-sm text-slate-400">{message}</p>
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
      <CheckCircle2 className="text-frosted-mint-700" size={28} />
      <h3 className="font-semibold text-slate-200">{title}</h3>
      <p className="max-w-md text-sm text-slate-500">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Badge({ children, color }: { children: ReactNode; color?: string | null }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/4 px-2 py-0.5 text-xs font-medium text-slate-400"
      style={
        color
          ? {
              borderColor: `${color}88`,
              backgroundColor: `${color}18`,
              color: "#e2e8f0",
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
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
