import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { twMerge } from "tailwind-merge";

import { Button, Input } from "@/web/components/ui";
import {
  formatInclusiveLabel,
  LIST_DATE_PRESETS,
  MONTH_NAMES,
  monthCalendarWeeks,
  parseYearMonth,
  selectionFromInclusiveDates,
  selectionFromPreset,
  shiftYearMonth,
  timeEntryListCapMessage,
  weekRowLabel,
  zonedToday,
  type ListDatePreset,
  type ListDateSelection,
  type WeekStartsOn,
} from "@/web/features/timer/list-date-range";
import { useDismissPopover, useEscapeToClose } from "@/web/features/timer/use-dismiss-popover";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function TimeEntryListCapWarning({ entryCount }: { entryCount: number }) {
  const message = timeEntryListCapMessage(entryCount);
  if (!message) return null;
  return (
    <p
      role="status"
      className="bg-accent-muted text-fg border-stroke border-b px-5 py-3 text-sm font-medium"
    >
      {message}
    </p>
  );
}

const monthArrowClass =
  "box-border grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-fg-subtle shadow-[inset_0_0_0_1px_var(--color-stroke-tertiary)] hover:bg-surface-hover";

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
  mode = "apply",
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
  /**
   * `instant` (Toggl): the second day click applies the range and closes. `apply` keeps typed
   * Start/End date fields with an Apply button below the calendar.
   */
  mode?: "instant" | "apply";
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
  const [yearsOpen, setYearsOpen] = useState(false);
  // Toggl shows no band while "All dates" is active; the drafts only matter once a range exists.
  const hasRange = value.preset !== "all" || pickingEnd || mode === "apply";

  useEffect(() => {
    if (!open) return;
    const month = parseYearMonth(value.endDate ?? value.startDate ?? today);
    setVisibleMonth(month);
    setDraftStart(value.startDate ?? today);
    setDraftEnd(value.endDate ?? today);
    setPickingEnd(false);
    setYearsOpen(false);
    root.current?.focus();
  }, [open, today, value.endDate, value.startDate]);

  const weeks = useMemo(
    () => monthCalendarWeeks(visibleMonth.year, visibleMonth.month, weekStartsOn),
    [visibleMonth.month, visibleMonth.year, weekStartsOn],
  );
  const weekdayOrder = useMemo(
    () => [...WEEKDAY_NAMES.slice(weekStartsOn), ...WEEKDAY_NAMES.slice(0, weekStartsOn)],
    [weekStartsOn],
  );
  const years = useMemo(() => {
    const todayYear = parseYearMonth(today).year;
    const first = Math.min(todayYear - 6, visibleMonth.year);
    const last = Math.max(todayYear + 1, visibleMonth.year);
    return Array.from({ length: last - first + 1 }, (_, index) => last - index);
  }, [today, visibleMonth.year]);
  const monthPrefix = `${visibleMonth.year}-${String(visibleMonth.month).padStart(2, "0")}`;
  const rangeStart = draftStart <= draftEnd ? draftStart : draftEnd;
  const rangeEnd = draftStart <= draftEnd ? draftEnd : draftStart;

  if (!open) return null;

  const applyPreset = (preset: Exclude<ListDatePreset, "custom">) => {
    onChange(selectionFromPreset(preset, now, timezone, weekStartsOn));
    onClose(true);
  };
  const applyRange = (from: string, to: string) => {
    onChange(selectionFromInclusiveDates(from, to, now, timezone, weekStartsOn));
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
    if (mode === "instant")
      applyRange(draftStart <= date ? draftStart : date, draftStart <= date ? date : draftStart);
  };

  return (
    <div
      ref={root}
      id="timer-date-range-popover"
      tabIndex={-1}
      role="dialog"
      aria-label={ariaLabel}
      className="timer-popover absolute top-11 left-0 z-50 box-border flex w-[min(calc(100vw-40px),568px)] max-w-[568px] flex-col shadow-[0_2px_8px_rgba(0,0,0,0.5)] outline-none sm:min-h-[360px] sm:flex-row"
    >
      <div className="box-border flex shrink-0 flex-col py-2 sm:w-56">
        <div className="border-[#191919] px-4 py-3 sm:flex-1 sm:border-r">
          {presets ?? (
            <div className="flex flex-wrap sm:block">
              {LIST_DATE_PRESETS.map((preset) => {
                const active = value.preset === preset.id;
                return (
                  <div key={preset.id} className="sm:h-[33px]">
                    <button
                      type="button"
                      aria-pressed={active}
                      className={twMerge(
                        "box-border block h-[33px] rounded-lg p-2 text-left text-sm leading-[normal]",
                        active
                          ? "bg-accent-muted text-accent-fg font-semibold"
                          : "text-fg-secondary hover:bg-surface-hover font-medium",
                      )}
                      onClick={() => applyPreset(preset.id)}
                    >
                      {preset.label}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="relative box-border min-w-0 flex-1 overflow-x-auto pb-4 sm:w-[342px] sm:flex-none sm:overflow-visible">
        <div className="mx-auto w-full max-w-[342px] min-w-[342px]">
          <div className="relative flex items-start justify-between px-5 pt-[15px]">
            <button
              type="button"
              className={monthArrowClass}
              aria-label="Previous month"
              onClick={() =>
                setVisibleMonth((current) => shiftYearMonth(current.year, current.month, -1))
              }
            >
              <ChevronLeft width={12} height={14} strokeWidth={2.5} aria-hidden="true" />
            </button>
            <div className="mt-px flex items-center">
              <span className="text-fg text-center text-xl leading-8 font-semibold">
                {MONTH_NAMES[visibleMonth.month - 1]}
              </span>
              <div className="relative">
                <button
                  type="button"
                  className="text-fg hover:bg-surface-hover ml-2 box-border inline-flex h-8 w-[100px] items-center gap-2.5 rounded-lg px-3 text-center text-sm font-medium"
                  aria-haspopup="listbox"
                  aria-expanded={yearsOpen}
                  aria-label={`Year ${visibleMonth.year}`}
                  onClick={() => setYearsOpen((current) => !current)}
                >
                  <span className="text-xl leading-8 font-semibold whitespace-nowrap">
                    {visibleMonth.year}
                  </span>
                  <ChevronDown width={14} height={9} strokeWidth={2.2} aria-hidden="true" />
                </button>
                {yearsOpen ? (
                  <div
                    role="listbox"
                    aria-label="Choose year"
                    className="timer-popover dark-surface absolute top-9 left-1/2 z-10 max-h-[200px] min-w-[100px] -translate-x-1/2 overflow-y-auto p-[5px] text-sm font-medium"
                  >
                    {years.map((year) => (
                      <button
                        key={year}
                        type="button"
                        role="option"
                        aria-selected={year === visibleMonth.year}
                        className={twMerge(
                          "text-fg hover:bg-surface-hover flex h-[30px] w-full items-center rounded-lg px-2.5 text-left",
                          year === visibleMonth.year && "bg-surface-hover",
                        )}
                        onClick={() => {
                          setVisibleMonth((current) => ({ ...current, year }));
                          setYearsOpen(false);
                        }}
                      >
                        {year}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              className={monthArrowClass}
              aria-label="Next month"
              onClick={() =>
                setVisibleMonth((current) => shiftYearMonth(current.year, current.month, 1))
              }
            >
              <ChevronRight width={12} height={14} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>

          <ul
            className="text-control mt-[18px] flex h-3.5 pl-[57px] text-xs leading-3 font-medium"
            aria-hidden="true"
          >
            {weekdayOrder.map((label) => (
              <li key={label} className="w-[38px] text-center">
                {label}
              </li>
            ))}
          </ul>

          <div className="mt-[11px]">
            {weeks.map((week) => (
              <div key={week[0]} className="flex h-[38px]">
                <button
                  type="button"
                  aria-label={`Select week ${weekRowLabel(week)}`}
                  className="text-fg-subtle bg-surface-secondary hover:bg-surface-hover border-control ml-3 grid w-[38px] shrink-0 place-items-center border-r text-center text-xs leading-3 font-medium"
                  onClick={() => {
                    const start = week[0];
                    const end = week[6];
                    if (!start || !end) return;
                    if (mode === "instant") applyRange(start, end);
                    else {
                      setDraftStart(start);
                      setDraftEnd(end);
                      setPickingEnd(false);
                    }
                  }}
                >
                  {weekRowLabel(week)}
                </button>
                <div className="ml-2 grid grid-cols-[repeat(7,38px)] border-t border-[#4d4d4d]">
                  {week.map((date) => {
                    const inMonth = date.startsWith(monthPrefix);
                    const selected = hasRange && date >= rangeStart && date <= rangeEnd;
                    const isStart = selected && date === rangeStart;
                    const isEnd = selected && date === rangeEnd;
                    return (
                      <button
                        key={date}
                        type="button"
                        aria-label={date}
                        aria-pressed={selected}
                        aria-current={date === today ? "date" : undefined}
                        className="group box-border block h-[37px] w-[38px] py-1"
                        onClick={() => selectDay(date)}
                      >
                        <span
                          className={twMerge(
                            "grid h-[29px] w-[38px] place-items-center",
                            selected && "bg-accent-muted-hover",
                            isStart && "bg-accent-fg rounded-l-lg",
                            isEnd && "bg-accent-fg rounded-r-lg",
                          )}
                        >
                          <span
                            className={twMerge(
                              "grid size-7 place-items-center rounded-[50%] text-sm leading-[14px] font-medium",
                              isStart || isEnd
                                ? "text-fg-inverted"
                                : inMonth
                                  ? twMerge(
                                      "text-fg group-hover:bg-surface-hover",
                                      date === today && !selected && "bg-surface-raised",
                                    )
                                  : "text-fg-subtle group-hover:bg-surface-hover",
                            )}
                          >
                            {Number(date.slice(8, 10))}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {mode === "apply" ? (
            <div className="mt-4 px-5">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-fg-subtle grid gap-1 text-[11px] font-semibold tracking-[0.04em] uppercase">
                  Start
                  <Input
                    type="date"
                    value={draftStart}
                    aria-label="Range start date"
                    onChange={(event) => setDraftStart(event.target.value)}
                  />
                </label>
                <label className="text-fg-subtle grid gap-1 text-[11px] font-semibold tracking-[0.04em] uppercase">
                  End
                  <Input
                    type="date"
                    value={draftEnd}
                    aria-label="Range end date"
                    onChange={(event) => setDraftEnd(event.target.value)}
                  />
                </label>
              </div>
              <p className="text-fg-subtle mt-2 text-xs font-medium">
                {draftStart && draftEnd
                  ? formatInclusiveLabel(rangeStart, rangeEnd)
                  : "Choose a start and end date"}
              </p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-fg-subtle hover:text-fg text-xs font-semibold"
                  onClick={reset ? reset.onClick : () => applyPreset("all")}
                >
                  {reset?.label ?? "Reset to All dates"}
                </button>
                <Button
                  disabled={!draftStart || !draftEnd}
                  onClick={() => applyRange(rangeStart, rangeEnd)}
                >
                  Apply
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
