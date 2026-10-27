import { describe, expect, it } from "vitest";

import {
  defaultNotificationPreferences,
  formatHoursMinutes,
  isReminderDue,
  localDay,
} from "@/domain/notifications/schedule";

describe("localDay", () => {
  it("reports the local date, ISO weekday, and minutes since midnight", () => {
    // 23:30 UTC Sunday is 04:30 Monday in Karachi.
    const day = localDay(Date.UTC(2026, 9, 25, 23, 30), "Asia/Karachi");
    expect(day).toMatchObject({ date: "2026-10-26", weekday: 0, minutes: 270 });
    expect(day.start).toBe(Date.UTC(2026, 9, 25, 19, 0));
    expect(day.end - day.start).toBe(24 * 60 * 60 * 1000);
  });

  it.each([
    // BST starts 29 March 2026 and ends 25 October 2026; 17:00 local is 16:00 / 17:00 UTC.
    ["spring forward", Date.UTC(2026, 2, 29, 16, 0)],
    ["fall back", Date.UTC(2026, 9, 25, 17, 0)],
  ])("reads wall-clock minutes on the %s day", (_, instant) => {
    expect(localDay(instant, "Europe/London").minutes).toBe(17 * 60);
  });

  it("gives a 25-hour day when clocks go back", () => {
    const day = localDay(Date.UTC(2026, 9, 25, 12), "Europe/London");
    expect(day.end - day.start).toBe(25 * 60 * 60 * 1000);
  });
});

describe("isReminderDue", () => {
  const monday = localDay(Date.UTC(2026, 9, 26, 17, 0), "UTC");

  it("is due from the reminder time on enabled weekdays", () => {
    expect(isReminderDue(defaultNotificationPreferences, monday)).toBe(true);
    expect(isReminderDue(defaultNotificationPreferences, { ...monday, minutes: 17 * 60 - 1 })).toBe(
      false,
    );
    expect(
      isReminderDue({ ...defaultNotificationPreferences, reminder_weekdays: 0b1111110 }, monday),
    ).toBe(false);
    expect(
      isReminderDue({ ...defaultNotificationPreferences, reminder_enabled: false }, monday),
    ).toBe(false);
  });
});

describe("formatHoursMinutes", () => {
  it.each([
    [0, "0m"],
    [45, "45m"],
    [60, "1h"],
    [80, "1h 20m"],
    [80.9, "1h 20m"],
  ])("formats %s minutes as %s", (minutes, expected) => {
    expect(formatHoursMinutes(minutes)).toBe(expected);
  });
});
