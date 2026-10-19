import { useState } from "react";

import { addCalendarDays, weekdaySunday0, type WeekStartsOn } from "@/domain/dates/calendar";
import { ChevronGlyph } from "@/web/features/timer/timer-glyphs";

const WEEKDAYS_SUNDAY_FIRST = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function parseMonth(date: string) {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function shiftMonth(year: number, month: number, delta: number) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

const monthTitle = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const dayLabel = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Toggl's single-date month calendar: 20px/600 month title with 30px chevron buttons, 12px grey
 * weekday labels and 42px week rows separated by a 1px #4d4d4d rule. The selected day is an accent
 * disc with dark text; today (when not selected) is accent text.
 */
export function TimerCalendar({
  value,
  today,
  weekStartsOn,
  onSelect,
  className = "px-[22px]",
  bordered = true,
  disableFuture = false,
  disabled = false,
}: {
  value: string;
  today: string;
  weekStartsOn: WeekStartsOn;
  onSelect: (date: string) => void;
  className?: string;
  bordered?: boolean;
  /** Dims and disables days after `today` (a running timer cannot start in the future). */
  disableFuture?: boolean;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(() => parseMonth(value));
  const first = `${monthKey(visible.year, visible.month)}-01`;
  const daysInMonth = new Date(Date.UTC(visible.year, visible.month, 0)).getUTCDate();
  const offset = (weekdaySunday0(first) - weekStartsOn + 7) % 7;
  const cells: Array<string | null> = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => addCalendarDays(first, index)),
  ];
  while (cells.length % 7) cells.push(null);
  const rows = Array.from({ length: cells.length / 7 }, (_, row) =>
    cells.slice(row * 7, row * 7 + 7),
  );
  const labels = Array.from(
    { length: 7 },
    (_, index) => WEEKDAYS_SUNDAY_FIRST[(weekStartsOn + index) % 7],
  );
  return (
    <div
      className={`min-h-[360px] pt-[17px] pb-[17px] ${bordered ? "border-stroke border-t" : ""} ${className}`}
    >
      <div className="flex h-8 items-center justify-between">
        <p className="text-fg text-xl leading-8 font-semibold" aria-live="polite">
          {monthTitle.format(Date.UTC(visible.year, visible.month - 1, 1))}
        </p>
        <div className="flex gap-5">
          <button
            type="button"
            className="timer-calendar-nav"
            aria-label="Previous month"
            disabled={disabled}
            onClick={() => setVisible((current) => shiftMonth(current.year, current.month, -1))}
          >
            <ChevronGlyph direction="left" />
          </button>
          <button
            type="button"
            className="timer-calendar-nav"
            aria-label="Next month"
            disabled={disabled}
            onClick={() => setVisible((current) => shiftMonth(current.year, current.month, 1))}
          >
            <ChevronGlyph direction="right" />
          </button>
        </div>
      </div>
      <div className="text-control mt-5 grid grid-cols-7 text-center text-xs leading-3 font-medium">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="mt-[10px]">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="grid h-[42px] grid-cols-7 border-t border-[#4d4d4d]">
            {row.map((date, index) => {
              if (!date) return <span key={`blank-${index}`} />;
              const selected = date === value;
              const isToday = date === today;
              const blocked = disableFuture && date > today;
              return (
                <button
                  key={date}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled || blocked}
                  aria-label={`Choose ${dayLabel.format(Date.parse(`${date}T00:00:00Z`))}`}
                  className="timer-calendar-day group flex h-[41px] justify-center pt-[7px]"
                  onClick={() => onSelect(date)}
                >
                  <span
                    className={`grid h-7 w-7 place-items-center rounded-full text-sm leading-[14px] ${
                      selected
                        ? "bg-accent text-fg-inverted font-semibold"
                        : blocked
                          ? "text-control font-medium"
                          : `group-hover:bg-surface-hover ${isToday ? "text-accent-fg font-semibold" : "text-fg font-medium"}`
                    }`}
                  >
                    {Number(date.slice(8, 10))}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
