import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { twMerge } from "tailwind-merge";
import type { ReactNode, RefObject } from "react";

export type TimerView = "calendar" | "list" | "timesheet";

const VIEWS: Array<{ id: TimerView; label: string }> = [
  { id: "calendar", label: "Calendar" },
  { id: "list", label: "List view" },
  { id: "timesheet", label: "Timesheet" },
];

/** Toolbar total chip: 11px/600 uppercase label with a 14px/600 value, 28px high, radius 8. */
function TotalChip({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  const content = (
    <span className="text-fg-subtle text-[11px] leading-[normal] font-semibold tracking-[0.4px] uppercase">
      {label}
      <span className="text-fg-secondary ml-2.5 inline-block text-sm leading-6 font-semibold tracking-[0.1px] tabular-nums">
        {value}
      </span>
    </span>
  );
  const className =
    "box-border relative top-0.5 inline-flex h-7 items-center rounded-lg px-2 py-0.5 text-left leading-[14px]";
  if (!onClick) return <span className={className}>{content}</span>;
  return (
    <button
      type="button"
      className={twMerge(className, "hover:bg-surface-hover")}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

const pieceClass =
  "box-border flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center border border-stroke-tertiary bg-surface px-3 text-sm leading-[normal] text-fg-subtle hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-surface";

export function TimerToolbar({
  view,
  onViewChange,
  periodLabel,
  periodSuffix,
  onClearPeriod,
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
  /** Grey week tag after the label, e.g. "W41" (rendered "· W41"). */
  periodSuffix?: string | null;
  /** When set, a "Clear and reset to default" X sits between the label and the next arrow. */
  onClearPeriod?: () => void;
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
    <section className="bg-surface">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-5 py-4 2xl:flex-nowrap">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5 2xl:flex-nowrap">
          <div className="relative max-w-full min-w-0 shrink-0">
            <div className="timer-date-control min-w-0">
              <button
                type="button"
                className={twMerge(pieceClass, "rounded-l-lg [border-right-style:none]")}
                onClick={onPrevious}
                disabled={previousDisabled}
                aria-label="Select previous period"
              >
                <ChevronLeft
                  width={11}
                  height={14}
                  strokeWidth={2.5}
                  className="shrink-0"
                  aria-hidden="true"
                />
              </button>
              <div className="border-stroke-tertiary bg-surface box-border flex h-9 min-w-0 flex-1 items-center justify-center border-y [border-right-style:none] [border-left-style:none] text-sm leading-[14px] 2xl:w-[250px] 2xl:flex-none">
                <button
                  ref={periodButtonRef}
                  type="button"
                  className="text-fg hover:bg-surface-hover box-border inline-flex h-full min-w-0 flex-1 items-center justify-center gap-2 pr-2 text-sm leading-[normal] font-medium"
                  onClick={onPeriodClick}
                  title={periodTitle ?? "Jump to current period"}
                  aria-expanded={periodPopover ? Boolean(periodExpanded) : undefined}
                  aria-haspopup={periodPopover ? "dialog" : undefined}
                  aria-controls={periodPopover ? "timer-date-range-popover" : undefined}
                >
                  <CalendarDays size={14} className="shrink-0" aria-hidden="true" />
                  <span className="text-center">{periodLabel}</span>
                  {periodSuffix ? (
                    <span className="text-fg-subtle shrink-0">· {periodSuffix}</span>
                  ) : null}
                </button>
                {onClearPeriod ? (
                  <button
                    type="button"
                    className="text-fg-muted hover:bg-surface-hover hover:text-fg grid h-9 w-[19px] shrink-0 place-items-center rounded-lg"
                    onClick={onClearPeriod}
                    aria-label="Clear and reset to default"
                    title="Clear and reset to default"
                  >
                    <X size={10} strokeWidth={1.6} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                className={twMerge(pieceClass, "rounded-r-lg [border-left-style:none]")}
                onClick={onNext}
                disabled={nextDisabled}
                aria-label="Select following period"
              >
                <ChevronRight
                  width={11}
                  height={14}
                  strokeWidth={2.5}
                  className="shrink-0"
                  aria-hidden="true"
                />
              </button>
            </div>
            {periodPopover}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {showTodayTotal && todayTotal !== undefined ? (
              <TotalChip label="Today" value={todayTotal} onClick={onTodayClick} />
            ) : null}
            <TotalChip label="Week total" value={weekTotal} onClick={onWeekClick} />
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 2xl:shrink-0 2xl:flex-nowrap">
          {trailing}
          <div className="timer-view-switch" role="radiogroup" aria-label="Timer view">
            {VIEWS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={view === id}
                onClick={() => onViewChange(id)}
              >
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
