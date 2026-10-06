import { addCalendarDays } from "@/domain/dates/calendar";
import { localDateTimeToEpoch } from "@/domain/dates/time";

export type TimerMode = "timer" | "manual";

const TIMER_MODE_KEY = "hourlark.timer-mode";
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function readTimerMode(): TimerMode {
  try {
    return window.localStorage.getItem(TIMER_MODE_KEY) === "manual" ? "manual" : "timer";
  } catch {
    return "timer";
  }
}

export function storeTimerMode(mode: TimerMode) {
  try {
    window.localStorage.setItem(TIMER_MODE_KEY, mode);
  } catch {
    // Mode memory is a convenience; the bar still works without storage.
  }
}

/**
 * Resolves Toggl-style manual entry fields into instants. Like Toggl, an end time
 * earlier than the start time means the entry finishes on the following day.
 */
export function manualEntryRange(
  date: string,
  startTime: string,
  endTime: string,
  timeZone: string,
): { started_at: string; stopped_at: string } | { error: string } {
  if (!DATE_PATTERN.test(date)) return { error: "Enter a valid date." };
  if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime))
    return { error: "Enter valid start and end times." };
  const start = localDateTimeToEpoch(`${date}T${startTime}`, timeZone);
  const endDate = endTime < startTime ? addCalendarDays(date, 1) : date;
  const stop = localDateTimeToEpoch(`${endDate}T${endTime}`, timeZone);
  if (!(stop > start)) return { error: "End must be after start." };
  return { started_at: new Date(start).toISOString(), stopped_at: new Date(stop).toISOString() };
}
