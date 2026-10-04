import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import {
  formatInclusiveLabel,
  formatMonthTitle,
  LIST_DATE_PRESETS,
  monthCalendarDays,
  parseYearMonth,
  selectionFromInclusiveDates,
  selectionFromPreset,
  shiftYearMonth,
  timeEntryListCapMessage,
  zonedToday,
  type ListDatePreset,
  type ListDateSelection,
  type WeekStartsOn,
} from "@/web/features/timer/list-date-range";
import { useDismissPopover, useEscapeToClose } from "@/web/features/timer/use-dismiss-popover";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

export function TimeEntryListCapWarning({ entryCount }: { entryCount: number }) {
  const message = timeEntryListCapMessage(entryCount);
  if (!message) return null;
  return (
    <p
      role="status"
      className="border-b border-[#3b3b3b] bg-[#382b16]/50 px-5 py-3 text-sm text-[#fafafa]"
    >
      {message}
    </p>
  );
}

export function DateRangePopover({
  open,
  timezone,
  weekStartsOn,
  value,
  now,
  onChange,
  onClose,
  triggerRef,
  presets,
  reset,
  ariaLabel = "Choose date range",
}: {
  open: boolean;
  timezone: string;
  weekStartsOn: WeekStartsOn;
  value: ListDateSelection;
  now: Date;
  onChange: (next: ListDateSelection) => void;
  onClose: (restoreFocus: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  presets?: ReactNode;
  reset?: { label: string; onClick: () => void };
  ariaLabel?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const today = zonedToday(now, timezone);
  const closeWithoutFocus = () => onClose(false);
  const closeWithFocus = () => onClose(true);
  useDismissPopover(root, closeWithoutFocus, triggerRef, open);
  useEscapeToClose(open, closeWithFocus);

  const initialMonth = parseYearMonth(value.endDate ?? value.startDate ?? today);
  const [visibleMonth, setVisibleMonth] = useState(initialMonth);
  const [draftStart, setDraftStart] = useState(value.startDate ?? today);
  const [draftEnd, setDraftEnd] = useState(value.endDate ?? today);
  const [pickingEnd, setPickingEnd] = useState(false);

  useEffect(() => {
    if (!open) return;
    const month = parseYearMonth(value.endDate ?? value.startDate ?? today);
    setVisibleMonth(month);
    setDraftStart(value.startDate ?? today);
    setDraftEnd(value.endDate ?? today);
    setPickingEnd(false);
    root.current?.focus();
  }, [open, today, value.endDate, value.startDate]);

  const days = useMemo(
    () => monthCalendarDays(visibleMonth.year, visibleMonth.month, weekStartsOn),
    [visibleMonth.month, visibleMonth.year, weekStartsOn],
  );
  const weekdayOrder = useMemo(
    () => [...WEEKDAY_LABELS.slice(weekStartsOn), ...WEEKDAY_LABELS.slice(0, weekStartsOn)],
    [weekStartsOn],
  );
  const monthPrefix = `${visibleMonth.year}-${String(visibleMonth.month).padStart(2, "0")}`;
  const rangeStart = draftStart <= draftEnd ? draftStart : draftEnd;
  const rangeEnd = draftStart <= draftEnd ? draftEnd : draftStart;

  if (!open) return null;

  const applyPreset = (preset: Exclude<ListDatePreset, "custom">) => {
    onChange(selectionFromPreset(preset, now, timezone, weekStartsOn));
    onClose(true);
  };
  const applyCustom = () => {
    if (!draftStart || !draftEnd) return;
    onChange(selectionFromInclusiveDates(rangeStart, rangeEnd, now, timezone, weekStartsOn));
    onClose(true);
  };
  const selectDay = (date: string) => {
    if (!pickingEnd) {
      setDraftStart(date);
      setDraftEnd(date);
      setPickingEnd(true);
      return;
    }
    setDraftEnd(date);
    setPickingEnd(false);
  };

  return (
    <div
      ref={root}
      id="timer-date-range-popover"
      tabIndex={-1}
      style={{ maxHeight: "min(560px, 70vh)", overflowY: "auto" }}
      role="dialog"
      aria-label={ariaLabel}
      className="timer-popover absolute top-11 left-0 z-50 w-[min(calc(100vw-40px),22rem)] outline-none"
    >
      <div className="grid grid-cols-2 gap-1 border-b border-[#3b3b3b] p-2">
        {presets ??
          LIST_DATE_PRESETS.map((preset) => {
            const active = value.preset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                className={`rounded-md px-2 py-1.5 text-left text-sm ${
                  active ? "bg-[#382b16] text-[#fbbf24]" : "text-[#fafafa] hover:bg-white/8"
                }`}
                onClick={() => applyPreset(preset.id)}
              >
                {preset.label}
              </button>
            );
          })}
      </div>

      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-md text-[#a4a4a4] hover:bg-white/8 hover:text-[#fafafa]"
            aria-label="Previous month"
            onClick={() =>
              setVisibleMonth((current) => shiftYearMonth(current.year, current.month, -1))
            }
          >
            <ChevronLeft size={16} />
          </button>
          <p className="text-sm font-semibold text-[#fafafa]">
            {formatMonthTitle(visibleMonth.year, visibleMonth.month)}
          </p>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-md text-[#a4a4a4] hover:bg-white/8 hover:text-[#fafafa]"
            aria-label="Next month"
            onClick={() =>
              setVisibleMonth((current) => shiftYearMonth(current.year, current.month, 1))
            }
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="mb-2 grid grid-cols-7 text-center text-[10px] font-semibold tracking-wide text-[#a4a4a4]">
          {weekdayOrder.map((label, index) => (
            <span key={`${label}-${index}`}>{label}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {days.map((date) => {
            const inMonth = date.startsWith(monthPrefix);
            const selected = date >= rangeStart && date <= rangeEnd;
            const endpoint = date === rangeStart || date === rangeEnd;
            const isToday = date === today;
            return (
              <button
                key={date}
                type="button"
                aria-label={date}
                aria-pressed={selected}
                className={`h-8 rounded-md text-xs ${
                  endpoint
                    ? "bg-[#f59e0b] text-[#18181b]"
                    : selected
                      ? "bg-[#382b16] text-[#fbbf24]"
                      : inMonth
                        ? "text-[#fafafa] hover:bg-white/8"
                        : "text-[#a4a4a4]/50 hover:bg-white/6"
                } ${isToday && !endpoint ? "ring-1 ring-[#f59e0b]/70" : ""}`}
                onClick={() => selectDay(date)}
              >
                {Number(date.slice(8, 10))}
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-[10px] font-bold tracking-wider text-[#a4a4a4] uppercase">
            Start
            <input
              type="date"
              className="h-8 rounded-md border border-[#3b3b3b] bg-[#1b1b1b] px-2 text-xs text-[#fafafa] outline-none focus:border-[#f59e0b]"
              value={draftStart}
              aria-label="Range start date"
              onChange={(event) => {
                setDraftStart(event.target.value);
              }}
            />
          </label>
          <label className="grid gap-1 text-[10px] font-bold tracking-wider text-[#a4a4a4] uppercase">
            End
            <input
              type="date"
              className="h-8 rounded-md border border-[#3b3b3b] bg-[#1b1b1b] px-2 text-xs text-[#fafafa] outline-none focus:border-[#f59e0b]"
              value={draftEnd}
              aria-label="Range end date"
              onChange={(event) => {
                setDraftEnd(event.target.value);
              }}
            />
          </label>
        </div>

        <p className="mt-2 text-xs text-[#a4a4a4]">
          {draftStart && draftEnd
            ? formatInclusiveLabel(rangeStart, rangeEnd)
            : "Choose a start and end date"}
        </p>

        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            className="text-xs font-semibold text-[#a4a4a4] hover:text-[#fafafa]"
            onClick={reset ? reset.onClick : () => applyPreset("all")}
          >
            {reset?.label ?? "Reset to All dates"}
          </button>
          <button
            type="button"
            className="h-8 rounded-md bg-[#f59e0b] px-3 text-xs font-semibold text-[#18181b] hover:bg-[#fbbf24]"
            disabled={!draftStart || !draftEnd}
            onClick={applyCustom}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
