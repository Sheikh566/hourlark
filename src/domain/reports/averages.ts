import { formatInTimeZone } from "date-fns-tz";

interface TrackedRow {
  clippedStart: number;
  rawDurationMs: number;
}

/**
 * Number of member-local calendar days that have tracked time. Rows are attributed to the day
 * their clipped start falls on, the same attribution the "day" grouping (and so the Duration by
 * day chart) uses, so the average always matches the bars that are drawn.
 */
export function trackedDayCount(rows: TrackedRow[], timezone: string): number {
  const days = new Set<string>();
  for (const row of rows) {
    if (row.rawDurationMs > 0) days.add(formatInTimeZone(row.clippedStart, timezone, "yyyy-MM-dd"));
  }
  return days.size;
}

/**
 * Average daily duration like Toggl: the total divided by the days that have tracked time, not by
 * every calendar day in the range. An empty range averages to zero.
 */
export function averageDailyDurationMs(totalDurationMs: number, trackedDays: number): number {
  return trackedDays > 0 ? totalDurationMs / trackedDays : 0;
}
