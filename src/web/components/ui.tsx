import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, CheckCircle2, LoaderCircle, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { twMerge } from "tailwind-merge";

import { useDismissPopover, useEscapeToClose } from "@/web/features/timer/use-dismiss-popover";

/**
 * Shared text control surface. Toggl page-level inputs and selects use a 1px #666 border, 36px
 * height, radius 8 and #999 placeholders. `.hl-control` (styles.css) holds the focus and in-dialog
 * rules, which must be unlayered to beat the global focus ring. Invalid fields get Toggl's red.
 */
export const controlClassName =
  "hl-control box-border h-9 min-w-0 w-full max-w-full rounded-lg border border-control bg-surface px-3 text-sm leading-5 font-medium text-fg placeholder:text-fg-subtle outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error";

export type ButtonVariant =
  "primary" | "secondary" | "outline" | "danger" | "ghost" | "text" | "accent";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-fg-inverted hover:bg-accent-hover",
  accent: "bg-accent text-fg-inverted hover:bg-accent-hover",
  // Toggl secondary: transparent with an inset 1px #808080 ring (no border, so height stays 36).
  secondary:
    "bg-transparent font-medium text-fg shadow-[inset_0_0_0_1px_var(--color-stroke-tertiary)] hover:bg-surface-hover",
  // Toggl empty-state CTA: surface fill, 1px #666 border.
  outline: "border border-control bg-surface px-[23px] text-fg hover:bg-surface-hover",
  danger: "bg-error text-fg-inverted hover:bg-[#d96a62]",
  ghost: "text-fg-muted hover:bg-surface-hover hover:text-fg",
  // Header actions: no chrome, foreground text.
  // Toggl ui-hover #d5d5d5 (measured on report header actions).
  text: "text-fg hover:text-[#d5d5d5]",
};

export function Button({
  variant = "primary",
  icon,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  /** Leading 20px icon slot; Toggl pads these buttons 12px left / 16px right with a 5px gap. */
  icon?: ReactNode;
}) {
  return (
    <button
      className={twMerge(
        "box-border inline-flex h-9 shrink-0 items-center justify-center gap-[5px] rounded-lg px-3 text-sm leading-5 font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50",
        icon && "pr-4",
        buttonVariants[variant],
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="grid size-5 shrink-0 place-items-center" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={twMerge(controlClassName, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={twMerge(controlClassName, "h-auto min-h-[72px] resize-y py-2", className)}
      {...props}
    />
  );
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
  // Toggl labels sit 4px above their control (measured in the New client and Invite dialogs).
  return (
    <label className="grid min-w-0 content-start gap-1">
      <span className="text-fg-subtle text-[11px] leading-4 font-semibold tracking-[0.04em] uppercase">
        {label}
      </span>
      {children}
      {error ? (
        <span className="text-xs font-medium text-[#e32817]" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="text-fg-subtle text-xs font-medium">{hint}</span>
      ) : null}
    </label>
  );
}

export { Select, type SelectOption } from "@/web/components/select";
export { Checkbox } from "@/web/components/checkbox";
export { Switch } from "@/web/components/switch";
export { ToastProvider, useToast } from "@/web/components/toast";

// Toggl small dialogs inset content 24px (360 wide); the 520 project dialog uses 20px.
// `compact` is Toggl's New/Edit tag dialog: 360x187, 20px inset, 16px title, 21px to the body.
const modalSizes = {
  sm: { panel: "w-[min(94vw,360px)] px-6 pt-[15px] pb-6", body: "mt-7" },
  md: { panel: "w-[min(94vw,520px)] px-[19px] pt-[15px] pb-[19px]", body: "mt-7" },
  lg: { panel: "w-[min(94vw,620px)] px-[19px] pt-[15px] pb-[19px]", body: "mt-7" },
  compact: { panel: "w-[min(94vw,360px)] px-5 pt-[22px] pb-4", body: "mt-[17px]" },
} as const;

const modalTitleSizes = {
  sm: "text-sm leading-5",
  // Toggl invite/tag dialogs: 16px/600, line-height 22.88px.
  md: "text-base leading-[22.88px]",
} as const;

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "lg",
  align = "center",
  titleSize = size === "compact" ? "md" : "sm",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Toggl dialogs are 360 (small forms, confirms) or 520 wide; `lg` (620) fits two-column forms. */
  size?: keyof typeof modalSizes;
  /** `top` anchors the panel 100px from the top like Toggl's project dialogs. */
  align?: "center" | "top";
  titleSize?: keyof typeof modalTitleSizes;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            // Pages can mark the field that should receive focus first (`data-autofocus`).
            const target = event.currentTarget as HTMLElement;
            const preferred = target.querySelector<HTMLElement>("[data-autofocus]");
            if (!preferred) return;
            event.preventDefault();
            preferred.focus();
          }}
          className={twMerge(
            "dark-surface hl-modal border-stroke bg-surface text-fg shadow-popover fixed left-1/2 z-50 flex -translate-x-1/2 flex-col rounded-lg border",
            modalSizes[size].panel,
            align === "top"
              ? "top-[100px] max-h-[calc(100dvh-116px)]"
              : "top-1/2 max-h-[calc(100dvh-32px)] -translate-y-1/2",
          )}
        >
          <div className="min-w-0 shrink-0 pr-7">
            <Dialog.Title className={twMerge("text-fg font-semibold", modalTitleSizes[titleSize])}>
              {title}
            </Dialog.Title>
            {description ? (
              <Dialog.Description className="text-fg-secondary mt-1 text-sm leading-5">
                {description}
              </Dialog.Description>
            ) : null}
          </div>
          {/* Padding keeps focus rings from being clipped by the scroll container. */}
          <div
            className={twMerge(
              "-mx-1 min-h-0 min-w-0 flex-1 overflow-y-auto px-1 py-1",
              modalSizes[size].body,
            )}
          >
            {children}
          </div>
          {footer ? (
            <footer className="mt-6 flex shrink-0 flex-wrap justify-end gap-2.5">{footer}</footer>
          ) : null}
          {/* Rendered last so Radix's initial focus lands on the first field, not on Close. */}
          <Dialog.Close
            className="text-fg hover:text-fg-soft absolute top-[7.5px] right-[6.5px] grid size-[37px] place-items-center rounded-lg"
            aria-label="Close dialog"
          >
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="text-fg-subtle flex min-h-40 items-center justify-center gap-2 text-sm">
      <LoaderCircle className="animate-spin" size={20} /> {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="panel flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertCircle className="text-error" />
      <p className="text-fg-subtle text-sm">{message}</p>
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
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  /** Stands in for Toggl's illustrations, which are not reusable; defaults to a neutral mark. */
  icon?: ReactNode;
}) {
  // Toggl spaces the illustration, heading, copy and action 16px apart.
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-4 p-8 text-center">
      {icon ?? <CheckCircle2 className="text-fg-disabled" size={56} strokeWidth={1.25} />}
      <div className="grid gap-1">
        <h3 className="text-fg text-2xl leading-9 font-bold">{title}</h3>
        <p className="text-fg-subtle max-w-md text-sm leading-5 font-medium">{description}</p>
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function Badge({ children, color }: { children: ReactNode; color?: string | null }) {
  return (
    <span
      className="border-stroke text-fg-muted inline-flex items-center gap-1 rounded-full border bg-white/4 px-2 py-0.5 text-xs font-medium"
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
        <h1 className="text-fg shrink-0 text-base leading-[20.8px] font-semibold">{title}</h1>
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
        className="text-fg-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
        size={14}
        aria-hidden="true"
      />
      {/* Toggl search: transparent, inset 1px #808080 ring instead of a border. */}
      <input
        type="search"
        className="hl-control text-fg placeholder:text-fg-subtle box-border h-9 w-full rounded-lg bg-transparent pr-8 pl-[34px] text-sm leading-5 font-medium shadow-[inset_0_0_0_1px_var(--color-stroke-tertiary)] outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none"
        placeholder={`${label}...`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          type="button"
          className="text-fg-muted hover:text-fg absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-lg"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={() => onChange("")}
        >
          <X size={10} strokeWidth={2.4} aria-hidden="true" />
        </button>
      ) : null}
    </label>
  );
}

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Gap between the kebab and its menu (Toggl: menu top sits 5px below the 30px trigger). */
const MENU_OFFSET = 5;

export function RowMenu({
  label,
  items,
  menuClassName,
}: {
  label: string;
  items: RowMenuItem[];
  /** Width/size overrides per surface, e.g. Toggl's list menu is 170px and the timer menu 130px. */
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissPopover(root, close, menu, open);
  useEscapeToClose(open, () => {
    setOpen(false);
    trigger.current?.focus();
  });

  // The menu is portaled and fixed-positioned so overflow containers (tables) cannot clip it.
  const place = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ top: rect.bottom + MENU_OFFSET, right: window.innerWidth - rect.right });
  }, []);
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);
  // Toggl focuses the first item however the menu was opened.
  useEffect(() => {
    if (!open || !position) return;
    menu.current?.querySelector<HTMLButtonElement>("button:enabled")?.focus();
  }, [open, position]);
  useEffect(() => {
    if (!open) return;
    // Scrolling or resizing would detach a fixed menu from its row, so dismiss instead.
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [close, open]);

  if (items.length === 0) return null;

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:enabled")];
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div ref={root} className="relative">
      {/* Toggl "More options": 30x30, radius 8, 4x16 vertical dots; neutral fill while open. */}
      <button
        ref={trigger}
        type="button"
        className="text-fg hover:bg-surface-hover aria-expanded:bg-stroke-tertiary grid size-[30px] place-items-center rounded-lg"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="4" height="16" viewBox="0 0 4 16" fill="currentColor" aria-hidden="true">
          <circle cx="2" cy="2" r="2" />
          <circle cx="2" cy="8" r="2" />
          <circle cx="2" cy="14" r="2" />
        </svg>
      </button>
      {open && position
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              style={{ top: position.top, right: position.right }}
              onKeyDown={moveFocus}
              className={twMerge(
                "timer-popover dark-surface fixed z-[70] min-w-32 p-[5px] text-sm font-medium",
                menuClassName,
              )}
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  className={twMerge(
                    "text-fg hover:bg-surface-hover focus-visible:bg-surface-hover disabled:text-fg-disabled flex h-[30px] w-full items-center rounded-lg px-2.5 text-left leading-[30px] whitespace-nowrap disabled:cursor-not-allowed disabled:hover:bg-transparent",
                    item.danger && "text-error-fg",
                  )}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** Toggl's 8x5 sort chevron; `d` points up or down. */
function SortChevron({ up, active }: { up: boolean; active: boolean }) {
  return (
    <svg
      width="8"
      height="5"
      viewBox="0 0 8 5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={active ? "text-accent-fg" : "text-control"}
    >
      <path d={up ? "M1 4 4 1l3 3" : "M1 1l3 3 3-3"} />
    </svg>
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
  return (
    <button
      type="button"
      className="hover:text-fg inline-flex items-center gap-2.5 uppercase"
      aria-label={`Sort by ${label.toLowerCase()}`}
      onClick={onToggle}
    >
      {label}
      <span className="flex flex-col gap-[3px]" aria-hidden="true">
        <SortChevron up active={direction === "asc"} />
        <SortChevron up={false} active={direction === "desc"} />
      </span>
    </button>
  );
}
