import { useRef, useState } from "react";

import type { WeekStartsOn } from "@/domain/dates/calendar";
import { ArrowRightGlyph } from "@/web/features/timer/timer-glyphs";
import { TimerCalendar } from "@/web/features/timer/timer-calendar";
import { dateLabel, TimeField } from "@/web/features/timer/timer-time-field";
import {
  useDismissPopover,
  useEscapeToClose,
  useRestoreFocus,
} from "@/web/features/timer/use-dismiss-popover";

const fieldClass =
  "h-9 w-full rounded-lg border border-control bg-transparent px-3 text-sm font-medium text-fg outline-none hover:border-fg-muted focus:border-fg-muted disabled:opacity-60";

/**
 * Toggl's manual mode: one start field holding the clock time with the date ("Today") inside it,
 * which opens a month calendar; an arrow; and the stop time. An end time before the start rolls to
 * the next day (see `manualEntryRange`).
 */
export function ManualRangeFields({
  date,
  start,
  end,
  today,
  weekStartsOn,
  disabled,
  onDateChange,
  onStartChange,
  onEndChange,
}: {
  date: string;
  start: string;
  end: string;
  today: string;
  weekStartsOn: WeekStartsOn;
  disabled: boolean;
  onDateChange: (value: string) => void;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const requestClose = (restore: boolean) => {
    setRestoreFocus(restore);
    setOpen(false);
  };
  useDismissPopover(root, () => requestClose(false), undefined, open);
  useEscapeToClose(open, () => requestClose(true));
  useRestoreFocus(open, trigger, restoreFocus, () => setRestoreFocus(false));
  return (
    <div className="manual-range flex min-w-0 shrink-0 items-center sm:ml-[14px]">
      <div ref={root} className="relative h-9 w-[138px] shrink-0">
        <TimeField
          className={`${fieldClass} pr-[58px]`}
          aria-label="Start time"
          value={start}
          commitOn="change"
          disabled={disabled}
          onCommit={onStartChange}
        />
        <button
          ref={trigger}
          type="button"
          className="hover:text-fg absolute top-1 right-[13px] h-7 rounded-md text-sm font-medium text-[#b2b2b2]"
          aria-label="Entry date"
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
        >
          {dateLabel(date, today)}
        </button>
        {open ? (
          <div
            role="dialog"
            aria-label="Choose entry date"
            className="timer-popover absolute top-[calc(100%+5px)] left-1/2 z-50 w-[min(92vw,342px)] -translate-x-1/2"
          >
            <TimerCalendar
              className="px-[23px]"
              bordered={false}
              value={date}
              today={today}
              weekStartsOn={weekStartsOn}
              onSelect={(next) => {
                onDateChange(next);
                requestClose(true);
              }}
            />
          </div>
        ) : null}
      </div>
      <span className="text-fg-muted grid h-9 w-10 shrink-0 place-items-center">
        <ArrowRightGlyph />
      </span>
      <div className="w-[94px] shrink-0">
        <TimeField
          className={fieldClass}
          aria-label="End time"
          value={end}
          commitOn="change"
          disabled={disabled}
          onCommit={onEndChange}
        />
      </div>
    </div>
  );
}
