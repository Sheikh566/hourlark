import { addDays, addSeconds } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

import { localDateTimeToEpoch } from "@/domain/dates/time";

/** Local wall-clock value in the member timezone, `yyyy-MM-ddTHH:mm:ss`. */
export type LocalDateTime = string;

const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)$/;

export function toLocalDateTime(date: Date | string, timezone: string): LocalDateTime {
  return formatInTimeZone(new Date(date), timezone, "yyyy-MM-dd'T'HH:mm:ss");
}

export function parseLocalDateTime(value: string, timezone: string): Date | null {
  if (!LOCAL_DATE_TIME.test(value)) return null;
  try {
    const epoch = localDateTimeToEpoch(value, timezone);
    if (!Number.isFinite(epoch)) return null;
    const date = new Date(epoch);
    const normalized = value.length === 16 ? `${value}:00` : value;
    // DST gaps must not silently move a typed wall time to a different hour.
    return toLocalDateTime(date, timezone) === normalized ? date : null;
  } catch {
    return null;
  }
}

export function datePart(value: LocalDateTime): string {
  return value.slice(0, 10);
}

export function timePart(value: LocalDateTime): string {
  const time = value.includes("T") ? value.slice(value.indexOf("T") + 1) : "";
  return /^\d{2}:\d{2}(?::\d{2})?$/.test(time) ? time : "";
}

export function withTime(value: LocalDateTime, time: string): LocalDateTime {
  return `${datePart(value)}T${time}`;
}

export function withDate(value: LocalDateTime, date: string): LocalDateTime {
  return `${date}T${timePart(value) || "00:00:00"}`;
}

/** Adds whole calendar days to a local value without crossing through UTC. */
export function addLocalDays(value: LocalDateTime, days: number): LocalDateTime {
  const [year, month, day] = datePart(value).split("-").map(Number);
  const shifted = addDays(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)), days);
  const date = shifted.toISOString().slice(0, 10);
  return withDate(value, date);
}

/** Toggl style 12-hour label, `3:05 PM`, from a local `HH:mm[:ss]` time. */
export function formatClockTime(time: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(time);
  if (!match) return "";
  const hours = Number(match[1]);
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 === 0 ? 12 : hours % 12}:${match[2]} ${suffix}`;
}

/**
 * Parses typed times such as `3:30 PM`, `3pm`, `330p`, `15:30` or `0930` into `HH:mm:00`.
 * Returns null when the text is not a time of day.
 */
export function parseClockTime(raw: string): string | null {
  const text = raw.trim().toLowerCase().replace(/\./g, "");
  const match = /^(\d{1,2})(?::?(\d{2}))?(?::(\d{2}))?\s*([ap])?m?$/.exec(text);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const meridiem = match[4];
  if (minutes > 59 || seconds > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === "p" ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Replaces the time of `stop`, keeping its date; when that lands at or before `start` the stop is
 * moved to the following day so `11:30 PM` -> `12:10 AM` reads as crossing midnight.
 */
export function stopWithTime(
  stop: LocalDateTime,
  start: LocalDateTime,
  time: string,
  timezone: string,
): LocalDateTime {
  const candidate = withTime(stop, time);
  const startInstant = parseLocalDateTime(start, timezone);
  const candidateInstant = parseLocalDateTime(candidate, timezone);
  if (startInstant && candidateInstant && candidateInstant <= startInstant) {
    const next = addLocalDays(candidate, 1);
    const nextInstant = parseLocalDateTime(next, timezone);
    // 11:30 PM -> 12:10 AM is the next morning. A same-day stop before the start
    // (11:00 -> 10:00) is a 23-hour span, so it stays and save reports the error.
    const overnight =
      nextInstant !== null &&
      nextInstant > startInstant &&
      nextInstant.getTime() - startInstant.getTime() <= 12 * 3_600_000;
    if (overnight) return next;
  }
  return candidate;
}

export function stopFromDuration(
  start: LocalDateTime,
  seconds: number,
  timezone: string,
): LocalDateTime | null {
  const startInstant = parseLocalDateTime(start, timezone);
  if (!startInstant) return null;
  return toLocalDateTime(addSeconds(startInstant, seconds), timezone);
}

export function durationSecondsBetween(
  start: LocalDateTime,
  stop: LocalDateTime,
  timezone: string,
): number | null {
  const startInstant = parseLocalDateTime(start, timezone);
  const stopInstant = parseLocalDateTime(stop, timezone);
  if (!startInstant || !stopInstant) return null;
  const seconds = Math.round((stopInstant.getTime() - startInstant.getTime()) / 1000);
  return seconds > 0 ? seconds : null;
}
