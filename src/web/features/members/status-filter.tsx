import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { twMerge } from "tailwind-merge";

import { Checkbox } from "@/web/components/ui";
import { useDismissPopover, useEscapeToClose } from "@/web/features/timer/use-dismiss-popover";

export type MemberStatus = "active" | "pending" | "inactive";

const options: Array<{ value: MemberStatus; label: string }> = [
  { value: "active", label: "Active" },
  { value: "pending", label: "Invited" },
  { value: "inactive", label: "Inactive" },
];

export const DEFAULT_MEMBER_STATUSES: readonly MemberStatus[] = ["active", "pending"];

/** Trigger text: selected labels joined, or "All" when nothing (or everything) is selected. */
export function statusSummary(selected: readonly MemberStatus[]) {
  if (selected.length === 0 || selected.length === options.length) return "All";
  return options
    .filter((option) => selected.includes(option.value))
    .map((option) => option.label)
    .join(", ");
}

/**
 * Toggl's members status filter: a "Show <value>" dropdown (38px, 1px #666) opening a 292px
 * multi-select of checkbox rows (Active / Invited / Inactive).
 */
export function MemberStatusFilter({
  selected,
  onChange,
}: {
  selected: readonly MemberStatus[];
  onChange: (next: MemberStatus[]) => void;
}) {
  const summaryId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissPopover(root, close, menu, open);
  useEscapeToClose(open, () => {
    setOpen(false);
    trigger.current?.focus();
  });
  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 5, left: rect.left });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [close, open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label="Filter members by status"
        aria-describedby={summaryId}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="border-control bg-surface text-fg aria-expanded:bg-surface-hover box-border flex h-[38px] items-center gap-1 rounded-lg border px-3 text-left text-sm leading-5 font-medium"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex gap-1">
          <span className="text-fg-subtle">Show</span>{" "}
          <span id={summaryId}>{statusSummary(selected)}</span>
        </span>
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
          className="text-fg-subtle shrink-0"
        >
          <path d="M1 1l3 3 3-3" />
        </svg>
      </button>
      {open && position
        ? createPortal(
            <div
              ref={menu}
              role="group"
              aria-label="Member status"
              style={{ top: position.top, left: position.left }}
              className="timer-popover dark-surface fixed z-[70] w-[292px] px-[2.5px] pb-2 text-sm font-medium"
            >
              {options.map((option) => {
                const checked = selected.includes(option.value);
                return (
                  <label
                    key={option.value}
                    className={twMerge(
                      "hover:bg-surface-hover has-[:focus-visible]:bg-surface-hover flex h-[30px] cursor-pointer items-center gap-2.5 rounded-lg px-2.5 leading-[30px]",
                      checked && "bg-surface-hover",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onChange={() =>
                        onChange(
                          checked
                            ? selected.filter((value) => value !== option.value)
                            : [...selected, option.value],
                        )
                      }
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
