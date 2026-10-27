import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const notificationKinds = ["long_running_timer", "tracking_reminder", "test"] as const;
export type NotificationKind = (typeof notificationKinds)[number];

export interface NotificationPreferences {
  long_timer_enabled: boolean;
  /** Elapsed minutes after which a running timer is reported once. */
  long_timer_minutes: number;
  reminder_enabled: boolean;
  /** Minutes after local midnight when the tracking reminder becomes due. */
  reminder_time_minutes: number;
  /** The reminder fires when the member tracked less than this on the local day. */
  reminder_threshold_minutes: number;
  /** Bit 0 is Monday through bit 6 for Sunday. */
  reminder_weekdays: number;
}

/** Applied to members without a stored preferences row. */
export const defaultNotificationPreferences: NotificationPreferences = {
  long_timer_enabled: true,
  long_timer_minutes: 8 * 60,
  reminder_enabled: true,
  reminder_time_minutes: 17 * 60,
  reminder_threshold_minutes: 4 * 60,
  reminder_weekdays: 0b0011111,
};

export const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface LocalDay {
  /** Local calendar date, `yyyy-MM-dd`. */
  date: string;
  /** 0 for Monday through 6 for Sunday. */
  weekday: number;
  /** Local wall-clock time as minutes after midnight (17:00 is 1020, also on DST change days). */
  minutes: number;
  /** Epoch milliseconds of local midnight and of the next local midnight (DST-aware). */
  start: number;
  end: number;
}

function nextDate(date: string): string {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function localDay(now: number, timeZone: string): LocalDay {
  const date = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const start = fromZonedTime(`${date}T00:00:00`, timeZone).getTime();
  const end = fromZonedTime(`${nextDate(date)}T00:00:00`, timeZone).getTime();
  return {
    date,
    weekday: Number(formatInTimeZone(now, timeZone, "i")) - 1,
    minutes:
      Number(formatInTimeZone(now, timeZone, "H")) * 60 +
      Number(formatInTimeZone(now, timeZone, "m")),
    start,
    end,
  };
}

export function isWeekdayEnabled(mask: number, weekday: number): boolean {
  return (mask & (1 << weekday)) !== 0;
}

/**
 * The reminder is due from its local time until local midnight, so a missed sweep catches up the
 * same day but never delivers a reminder for a day that has ended.
 */
export function isReminderDue(preferences: NotificationPreferences, day: LocalDay): boolean {
  return (
    preferences.reminder_enabled &&
    isWeekdayEnabled(preferences.reminder_weekdays, day.weekday) &&
    day.minutes >= preferences.reminder_time_minutes
  );
}

export function isLongRunning(
  preferences: NotificationPreferences,
  startedAt: number,
  now: number,
): boolean {
  return (
    preferences.long_timer_enabled && now - startedAt >= preferences.long_timer_minutes * 60_000
  );
}

export function formatHoursMinutes(minutes: number): string {
  const whole = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** Push and inbox text stays generic: no descriptions, projects, or clients on a lock screen. */
export function longRunningMessage(elapsedMs: number): { title: string; body: string } {
  return {
    title: "Your timer is still running",
    body: `Your timer has been running for ${formatHoursMinutes(elapsedMs / 60_000)}.`,
  };
}

export function trackingReminderMessage(
  trackedMs: number,
  thresholdMinutes: number,
): { title: string; body: string } {
  return {
    title: "Time to track your day",
    body: `You've tracked ${formatHoursMinutes(trackedMs / 60_000)} today (goal ${formatHoursMinutes(thresholdMinutes)}).`,
  };
}
