import { useEffect, useRef, useState } from "react";

import type { WeekStartsOn } from "@/domain/dates/calendar";
import { TimerCalendar } from "@/web/features/timer/timer-calendar";
import { dateLabel, TimeField } from "@/web/features/timer/timer-time-field";
import { formatClock12, localFields, localInstant } from "@/web/features/timer/timer-time-fields";
import {
  useDismissPopover,
  useEscapeToClose,
  useRestoreFocus,
} from "@/web/features/timer/use-dismiss-popover";
import type { TimeEntry } from "@/web/types";

const fieldClass =
  "h-[35px] w-full rounded-lg border border-control bg-surface px-3 text-sm font-medium text-fg outline-none placeholder:text-fg-subtle focus:border-fg-muted disabled:bg-transparent disabled:text-fg-subtle";

/**
 * Click the running duration to adjust the start of the running entry. START edits the clock time
 * (committed on blur or Enter) and the calendar below edits the date; STOP is read-only while the
 * timer runs. Changes are saved on the running entry through the entry PATCH endpoint.
 */
export function RunningDuration({
  entry,
  duration,
  now,
  timezone,
  weekStartsOn,
  onChangeStart,
}: {
  entry: TimeEntry;
  duration: string;
  now: number;
  timezone: string;
  weekStartsOn: WeekStartsOn;
  onChangeStart: (iso: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
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
  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const start = localFields(entry.started_at, timezone);
  const today = localFields(now, timezone).date;
  const save = async (date: string, time: string) => {
    if (savingRef.current) return;
    const instant = localInstant(date, time, timezone);
    if (Number.isNaN(instant)) return;
    if (instant > Date.now()) {
      setError("The start of a running timer can't be in the future.");
      return;
    }
    if (date === start.date && time === start.time) return;
    setError(null);
    savingRef.current = true;
    setSaving(true);
    try {
      await onChangeStart(new Date(instant).toISOString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The start time could not be saved.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div ref={root} className="relative w-[95px] shrink-0">
      <button
        ref={trigger}
        type="button"
        className="timer-duration timer-tip text-fg hover:bg-surface-hover mx-auto block h-[31px] w-[83px] rounded-lg text-center text-lg font-semibold tabular-nums"
        data-tip="Adjust duration"
        aria-label={`Running time ${duration}. Adjust start time`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        {duration}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Adjust start time"
          className="timer-popover absolute top-6 right-0 z-50 w-[min(92vw,340px)] sm:-right-[67px]"
        >
          <div className="flex gap-0 px-2.5 pt-3">
            <label className="relative block min-w-0 flex-1 px-[5px] pb-[15px]">
              <span className="text-fg mt-0.5 block h-[14px] text-[11px] leading-[14px] font-semibold tracking-[0.4px] uppercase">
                Start
              </span>
              <TimeField
                className={`${fieldClass} mt-[3px] pr-[60px]`}
                aria-label="Start time"
                value={start.time}
                commitOn="blur"
                disabled={saving}
                onCommit={(time) => void save(start.date, time)}
              />
              <span className="text-accent-fg pointer-events-none absolute right-[18px] bottom-[26px] text-sm leading-4 font-medium">
                {dateLabel(start.date, today)}
              </span>
            </label>
            <label className="block min-w-0 flex-1 px-[5px] pb-[15px]">
              <span className="text-fg mt-0.5 block h-[14px] text-[11px] leading-[14px] font-semibold tracking-[0.4px] uppercase">
                Stop
              </span>
              <input
                className={`${fieldClass} mt-[3px]`}
                aria-label="Stop time"
                disabled
                placeholder={formatClock12(localFields(now, timezone).time)}
              />
            </label>
          </div>
          {error ? (
            <p role="alert" className="text-error-fg px-[15px] pb-2 text-xs font-medium">
              {error}
            </p>
          ) : null}
          <div className="mt-4">
            <TimerCalendar
              value={start.date}
              today={today}
              weekStartsOn={weekStartsOn}
              disableFuture
              disabled={saving}
              onSelect={(date) => void save(date, start.time)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
