import { Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { twMerge } from "tailwind-merge";

import { Checkbox } from "@/web/components/ui";
import { useDismissPopover, useEscapeToClose } from "@/web/features/timer/use-dismiss-popover";

/**
 * Toggl's borderless filter chip ("Client", "Member", "Project name"): 34px tall, radius 8,
 * padding 8, an 18px muted icon and a 14/500 label. Hover and open use the neutral hover fill;
 * an applied filter switches to the accent tint with a white count badge.
 */
export function FilterChip({
  label,
  icon,
  count = 0,
  open,
  onClick,
  ref,
}: {
  label: string;
  icon: ReactNode;
  count?: number;
  open: boolean;
  onClick: () => void;
  ref?: RefObject<HTMLButtonElement | null>;
}) {
  const active = count > 0;
  return (
    <button
      ref={ref}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      className={twMerge(
        "box-border flex h-[34px] shrink-0 items-center gap-2 rounded-lg p-2 text-sm leading-[14px] font-medium",
        active
          ? "bg-accent-muted-hover text-accent-fg-hover hover:bg-accent-muted-active"
          : "text-fg hover:bg-surface-hover aria-expanded:bg-surface-hover",
      )}
      onClick={onClick}
    >
      <span
        className={twMerge(
          "grid size-[18px] shrink-0 place-items-center",
          !active && "text-fg-muted",
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      {label}
      {active ? (
        <span className="bg-fg text-fg-inverted grid h-4 min-w-4 place-items-center rounded px-1 text-[11px] leading-none font-semibold">
          {count}
        </span>
      ) : null}
    </button>
  );
}

/** "Clear filters": 36x36 ghost X shown after the chips while any filter is applied. */
export function ClearFiltersButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Clear filters"
      title="Clear filters"
      className="text-fg hover:bg-surface-hover grid size-9 shrink-0 place-items-center rounded-lg"
      onClick={onClick}
    >
      <X size={14} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}

/**
 * Toggl filter popover: portaled, left-aligned with its chip and 5px below it, 342px wide on the
 * shared popover surface. Closes on outside press and Escape (focus returns to the chip).
 */
export function FilterPopover({
  anchor,
  label,
  onClose,
  children,
  className,
}: {
  anchor: RefObject<HTMLElement | null>;
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const close = useCallback(() => onClose(), [onClose]);
  useDismissPopover(root, close, anchor);
  useEscapeToClose(true, () => {
    onClose();
    anchor.current?.focus();
  });
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ top: rect.bottom + 5, left: rect.left });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);
  const placed = position !== null;
  useEffect(() => {
    if (placed) root.current?.querySelector<HTMLElement>("input")?.focus();
  }, [placed]);
  if (!position) return null;
  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-label={label}
      style={{ top: position.top, left: position.left }}
      className={twMerge(
        "timer-popover dark-surface text-fg fixed z-[70] w-[342px] max-w-[calc(100vw-16px)] text-sm font-medium",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Search field of the filter popovers: 310x30 on the surface colour, 14px icon, 276px input. */
export function PopoverSearch({
  value,
  onChange,
  placeholder,
  label,
  onEnter,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  onEnter?: () => void;
}) {
  return (
    <div className="px-[15px] pt-[15px] pb-2.5">
      <label className="bg-surface flex h-[30px] items-center gap-2 rounded-lg pr-0 pl-3 shadow-[inset_0_0_0_1px_var(--color-stroke-tertiary)]">
        <span className="sr-only">{label}</span>
        <Search size={14} strokeWidth={1.5} className="text-fg-muted shrink-0" aria-hidden="true" />
        <input
          type="search"
          value={value}
          placeholder={placeholder}
          className="placeholder:text-fg-subtle h-full min-w-0 flex-1 bg-transparent text-sm font-medium outline-none [&::-webkit-search-cancel-button]:hidden"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && onEnter) {
              event.preventDefault();
              onEnter();
            }
          }}
        />
      </label>
    </div>
  );
}

export type ChecklistOption = { value: string; label: string; color?: string | null };

/**
 * Checklist body of the Client / Member popovers: a section header with ALL / NONE links and 30px
 * rows (14px checkbox, 10px gap) on a 3px inset, like Toggl.
 */
export function ChecklistPopoverBody({
  title,
  options,
  selected,
  onChange,
}: {
  title: string;
  options: ChecklistOption[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  const heading = useId();
  return (
    <div role="group" aria-labelledby={heading} className="pb-2.5">
      <div className="flex h-[25px] items-center justify-between px-[15px] text-[11px] leading-[14px] font-semibold tracking-[0.4px] uppercase">
        <span id={heading}>{title}</span>
        <span className="flex gap-2.5">
          <button
            type="button"
            className="text-accent-fg hover:text-accent-fg-hover leading-[14px] uppercase"
            onClick={() => onChange(new Set(options.map((option) => option.value)))}
          >
            All
          </button>
          <button
            type="button"
            className="text-accent-fg hover:text-accent-fg-hover leading-[14px] uppercase"
            onClick={() => onChange(new Set())}
          >
            None
          </button>
        </span>
      </div>
      <div className="max-h-[260px] overflow-y-auto px-[2px]">
        {options.map((option) => {
          const checked = selected.has(option.value);
          return (
            <label
              key={option.value}
              className={twMerge(
                "hover:bg-surface-hover mx-px flex h-[30px] cursor-pointer items-center gap-2.5 rounded-lg px-2.5",
                checked && "bg-surface-hover",
              )}
            >
              <Checkbox
                checked={checked}
                onChange={() => {
                  const next = new Set(selected);
                  if (checked) next.delete(option.value);
                  else next.add(option.value);
                  onChange(next);
                }}
              />
              {option.color ? (
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: option.color }}
                  aria-hidden="true"
                />
              ) : null}
              <span className="min-w-0 truncate">{option.label}</span>
            </label>
          );
        })}
        {options.length === 0 ? (
          <p className="text-fg-subtle px-2.5 py-1.5">Nothing found</p>
        ) : null}
      </div>
    </div>
  );
}

/** A chip with its popover: owns the anchor ref so callers only track which filter is open. */
export function ChipFilter({
  label,
  icon,
  count,
  open,
  onToggle,
  onClose,
  popoverClassName,
  children,
}: {
  label: string;
  icon: ReactNode;
  count?: number;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  popoverClassName?: string;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <FilterChip
        ref={anchor}
        label={label}
        icon={icon}
        count={count}
        open={open}
        onClick={onToggle}
      />
      {open ? (
        <FilterPopover
          anchor={anchor}
          label={`${label} filter`}
          onClose={onClose}
          className={popoverClassName}
        >
          {children}
        </FilterPopover>
      ) : null}
    </>
  );
}
