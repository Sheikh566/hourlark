import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export function assertValidTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return timeZone;
  } catch {
    throw new Error("Invalid IANA timezone");
  }
}

export function localDateTimeToEpoch(localDateTime: string, timeZone: string): number {
  assertValidTimeZone(timeZone);
  return fromZonedTime(localDateTime, timeZone).getTime();
}

export function formatLocal(
  epochMs: number,
  timeZone: string,
  pattern = "yyyy-MM-dd HH:mm",
): string {
  return formatInTimeZone(epochMs, timeZone, pattern);
}

/** Inclusive calendar dates for a half-open [start, end) instant range. */
export function formatInclusivePeriod(startIso: string, endIso: string, timeZone: string): string {
  assertValidTimeZone(timeZone);
  const startDate = formatInTimeZone(startIso, timeZone, "yyyy-MM-dd");
  const endDate = formatInTimeZone(Date.parse(endIso) - 1, timeZone, "yyyy-MM-dd");
  return `${startDate} to ${endDate}`;
}

export function overlapDuration(
  entryStart: number,
  entryStop: number,
  rangeStart: number,
  rangeEnd: number,
): number {
  return Math.max(0, Math.min(entryStop, rangeEnd) - Math.max(entryStart, rangeStart));
}

export function roundDuration(
  durationMs: number,
  incrementMinutes: number,
  method: "nearest" | "up" | "down",
): number {
  if (incrementMinutes === 0) return durationMs;
  const incrementMs = incrementMinutes * 60_000;
  const ratio = durationMs / incrementMs;
  const rounded =
    method === "up" ? Math.ceil(ratio) : method === "down" ? Math.floor(ratio) : Math.round(ratio);
  return Math.max(0, rounded * incrementMs);
}

export function amountMinorForDuration(durationMs: number, hourlyRateMinor: number): number {
  return Math.round((durationMs * hourlyRateMinor) / 3_600_000);
}
