import { formatInTimeZone } from "date-fns-tz";

import { localDateTimeToEpoch } from "@/domain/dates/time";

/** "17:03" -> "5:03 PM" (Toggl shows the workspace's 12-hour clock without a leading zero). */
export function formatClock12(time: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return time;
  const hours = Number(match[1]);
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${match[2]} ${suffix}`;
}

/**
 * Parses what people type into a time field ("9", "9:30", "930", "9:30 pm", "17:05") into "HH:mm".
 * Returns null while the text is not yet a complete time.
 */
export function parseClockInput(text: string): string | null {
  const match = /^(\d{1,2})(?::?(\d{2}))?\s*(?:([ap])(?:\.?m\.?)?)?$/.exec(
    text.trim().toLowerCase(),
  );
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  const meridiem = match[3];
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === "p" ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Member-local calendar date and clock time of an instant. */
export function localFields(
  iso: string | number,
  timeZone: string,
): { date: string; time: string } {
  return {
    date: formatInTimeZone(iso, timeZone, "yyyy-MM-dd"),
    time: formatInTimeZone(iso, timeZone, "HH:mm"),
  };
}

/** Instant (epoch ms) of a member-local date and "HH:mm" time. */
export function localInstant(date: string, time: string, timeZone: string): number {
  return localDateTimeToEpoch(`${date}T${time}`, timeZone);
}
