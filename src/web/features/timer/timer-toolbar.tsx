import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { twMerge } from "tailwind-merge";
import type { ReactNode, RefObject } from "react";

export type TimerView = "calendar" | "list" | "timesheet";

const VIEWS: Array<{ id: TimerView; label: string }> = [
  { id: "calendar", label: "Calendar" },
  { id: "list", label: "List view" },
  { id: "timesheet", label: "Timesheet" },
];

export function TimerToolbar({
  view,
  onViewChange,
  periodLabel,
  onPrevious,
  onNext,
  onPeriodClick,
  previousDisabled,
  nextDisabled,
  todayTotal,
  weekTotal,
  showTodayTotal,
  trailing,
  periodTitle,
  periodButtonRef,
  periodPopover,
  periodExpanded,
  onTodayClick,
  onWeekClick,
}: {
  view: TimerView;
  onViewChange: (view: TimerView) => void;
  periodLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onPeriodClick?: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  todayTotal?: string;
  weekTotal: string;
  showTodayTotal?: boolean;
  trailing?: ReactNode;
  periodTitle?: string;
  periodButtonRef?: RefObject<HTMLButtonElement | null>;
  periodPopover?: ReactNode;
  periodExpanded?: boolean;
  onTodayClick?: () => void;
  onWeekClick?: () => void;
}) {
  return (
    <section className="border-b border-[#3b3b3b] bg-[#1b1b1b]">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 2xl:h-[68px] 2xl:flex-nowrap 2xl:py-0">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 2xl:flex-nowrap">
          <div className="relative max-w-full min-w-0 shrink-0">
            <div className="timer-date-control min-w-0">
              <button
                type="button"
                className="grid h-full w-9 shrink-0 place-items-center text-[#a4a4a4] hover:bg-white/6 hover:text-[#fafafa] disabled:opacity-30"
                onClick={onPrevious}
                disabled={previousDisabled}
                aria-label="Select previous period"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                ref={periodButtonRef}
                type="button"
                className="inline-flex h-full min-w-0 flex-1 items-center justify-center gap-2 px-2 text-sm font-semibold text-[#fafafa] hover:bg-white/6 2xl:w-[248px] 2xl:flex-none"
                onClick={onPeriodClick}
                title={periodTitle ?? "Jump to current period"}
                aria-expanded={periodPopover ? Boolean(periodExpanded) : undefined}
                aria-haspopup={periodPopover ? "dialog" : undefined}
                aria-controls={periodPopover ? "timer-date-range-popover" : undefined}
              >
                <CalendarDays size={16} aria-hidden />
                <span className="truncate">{periodLabel}</span>
              </button>
              <button
                type="button"
                className="grid h-full w-9 shrink-0 place-items-center text-[#a4a4a4] hover:bg-white/6 hover:text-[#fafafa] disabled:opacity-30"
                onClick={onNext}
                disabled={nextDisabled}
                aria-label="Select following period"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            {periodPopover}
          </div>

          <div className="flex min-w-0 items-center gap-4 text-xs font-medium text-[#a4a4a4]">
            {showTodayTotal && todayTotal !== undefined ? (
              onTodayClick ? (
                <button
                  type="button"
                  className="whitespace-nowrap hover:text-[#fafafa]"
                  onClick={onTodayClick}
                  aria-label="Show today's entries"
                >
                  Today <span className="ml-1 font-mono text-[#fafafa]">{todayTotal}</span>
                </button>
              ) : (
                <span className="whitespace-nowrap">
                  Today <span className="ml-1 font-mono text-[#fafafa]">{todayTotal}</span>
                </span>
              )
            ) : null}
            {onWeekClick ? (
              <button
                type="button"
                className="whitespace-nowrap hover:text-[#fafafa]"
                onClick={onWeekClick}
                aria-label="Show this week's entries"
              >
                Week total <span className="ml-1 font-mono text-[#fafafa]">{weekTotal}</span>
              </button>
            ) : (
              <span className="whitespace-nowrap">
                Week total <span className="ml-1 font-mono text-[#fafafa]">{weekTotal}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 2xl:shrink-0 2xl:flex-nowrap">
          {trailing}
          <div className="timer-view-switch" role="radiogroup" aria-label="Timer view">
            {VIEWS.map(({ id, label }) => {
              const active = view === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={twMerge(
                    "border-hourlark-control-border inline-flex h-full items-center border-l px-2 text-xs font-semibold whitespace-nowrap transition first:border-l-0 sm:px-3 sm:text-sm md:px-5",
                    active
                      ? "bg-[#382b16] text-[#fbbf24]"
                      : "text-[#a4a4a4] hover:bg-white/6 hover:text-[#fafafa]",
                  )}
                  onClick={() => onViewChange(id)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
