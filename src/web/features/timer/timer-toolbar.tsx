import { CalendarDays, ChevronLeft, ChevronRight, List, Table2 } from "lucide-react";
import { twMerge } from "tailwind-merge";

export type TimerView = "calendar" | "list" | "timesheet";

const VIEWS: Array<{ id: TimerView; label: string; icon: typeof List }> = [
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "list", label: "List view", icon: List },
  { id: "timesheet", label: "Timesheet", icon: Table2 },
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
  trailing?: React.ReactNode;
}) {
  return (
    <section className="border-b border-white/10 bg-[#111710]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 md:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-white/6 hover:text-white disabled:opacity-30"
              onClick={onPrevious}
              disabled={previousDisabled}
              aria-label="Select previous period"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="inline-flex min-h-8 items-center gap-2 rounded-md border border-white/12 bg-white/4 px-2.5 text-sm font-semibold text-slate-100 hover:bg-white/7"
              onClick={onPeriodClick}
              title="Jump to current period"
            >
              <CalendarDays size={14} className="text-slate-400" />
              {periodLabel}
            </button>
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-white/6 hover:text-white disabled:opacity-30"
              onClick={onNext}
              disabled={nextDisabled}
              aria-label="Select following period"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="flex items-center gap-4 text-xs font-semibold tracking-wide text-slate-400 uppercase">
            {showTodayTotal && todayTotal !== undefined ? (
              <span>
                Today{" "}
                <span className="ml-1 font-mono text-slate-200 normal-case">{todayTotal}</span>
              </span>
            ) : null}
            <span>
              Week total{" "}
              <span className="ml-1 font-mono text-slate-200 normal-case">{weekTotal}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {trailing}
          <div
            className="flex overflow-hidden rounded-md border border-white/12"
            role="radiogroup"
            aria-label="Timer view"
          >
            {VIEWS.map(({ id, label, icon: Icon }) => {
              const active = view === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={twMerge(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition",
                    active
                      ? "bg-frosted-mint-700 text-white"
                      : "border-l border-white/10 text-slate-400 first:border-l-0 hover:bg-white/6 hover:text-white",
                  )}
                  onClick={() => onViewChange(id)}
                >
                  <Icon size={13} aria-hidden />
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

export function WorkspaceStripe({ label }: { label: string }) {
  return (
    <div className="px-4 pt-3 md:px-5">
      <p className="text-frosted-mint-400 text-[10px] font-black tracking-[0.14em] uppercase">
        {label}
      </p>
      <div className="from-frosted-mint-500 via-frosted-mint-600/70 mt-1.5 h-px bg-gradient-to-r to-transparent" />
    </div>
  );
}
