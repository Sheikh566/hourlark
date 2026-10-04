import { describe, expect, it } from "vitest";

import {
  ALL_DATES_SELECTION,
  EPOCH_START_ISO,
  isTimeEntryListCapped,
  listPeriodLabel,
  monthCalendarDays,
  selectionFromInclusiveDates,
  selectionFromPreset,
  shiftSelection,
  TIME_ENTRY_LIST_LIMIT,
  timeEntryListCapMessage,
  toApiRange,
} from "@/web/features/timer/list-date-range";

describe("list date range", () => {
  it("uses member-local day bounds in Asia/Karachi", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const today = selectionFromPreset("today", now, "Asia/Karachi", 1);
    expect(today).toEqual({ preset: "today", startDate: "2026-07-30", endDate: "2026-07-30" });
    expect(toApiRange(today, now, "Asia/Karachi")).toEqual({
      start: "2026-07-29T19:00:00.000Z",
      end: "2026-07-30T19:00:00.000Z",
    });
  });

  it("honors Sunday week start in Asia/Karachi", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const week = selectionFromPreset("this_week", now, "Asia/Karachi", 0);
    expect(week).toEqual({
      preset: "this_week",
      startDate: "2026-07-26",
      endDate: "2026-08-01",
    });
    expect(toApiRange(week, now, "Asia/Karachi")).toEqual({
      start: "2026-07-25T19:00:00.000Z",
      end: "2026-08-01T19:00:00.000Z",
    });
  });

  it("uses exclusive API ends across America/New_York spring DST", () => {
    const now = new Date("2026-03-08T12:00:00.000Z");
    const today = selectionFromPreset("today", now, "America/New_York", 0);
    expect(toApiRange(today, now, "America/New_York")).toEqual({
      start: "2026-03-08T05:00:00.000Z",
      end: "2026-03-09T04:00:00.000Z",
    });
  });

  it("uses exclusive API ends across America/New_York fall DST", () => {
    const now = new Date("2026-11-01T12:00:00.000Z");
    const today = selectionFromPreset("today", now, "America/New_York", 0);
    expect(toApiRange(today, now, "America/New_York")).toEqual({
      start: "2026-11-01T04:00:00.000Z",
      end: "2026-11-02T05:00:00.000Z",
    });
  });

  it("keeps a custom inclusive end exclusive in the API across DST", () => {
    const now = new Date("2026-03-08T12:00:00.000Z");
    const custom = selectionFromInclusiveDates(
      "2026-03-07",
      "2026-03-08",
      now,
      "America/New_York",
      0,
    );
    expect(custom).toEqual({
      preset: "custom",
      startDate: "2026-03-07",
      endDate: "2026-03-08",
    });
    expect(toApiRange(custom, now, "America/New_York")).toEqual({
      start: "2026-03-07T05:00:00.000Z",
      end: "2026-03-09T04:00:00.000Z",
    });
    expect(listPeriodLabel(custom)).toBe("Mar 7 – Mar 8");
  });

  it("requests epoch through the next member-local day for All dates", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    expect(toApiRange(ALL_DATES_SELECTION, now, "Asia/Karachi")).toEqual({
      start: EPOCH_START_ISO,
      end: "2026-07-30T19:00:00.000Z",
    });
    expect(listPeriodLabel(ALL_DATES_SELECTION)).toBe("All dates");
  });

  it("shifts a bounded period by its inclusive length and can become yesterday", () => {
    const now = new Date("2026-10-04T12:00:00.000Z");
    const today = selectionFromPreset("today", now, "Asia/Karachi", 0);
    expect(shiftSelection(today, -1, now, "Asia/Karachi", 0)).toEqual({
      preset: "yesterday",
      startDate: "2026-10-03",
      endDate: "2026-10-03",
    });
    const thirty = selectionFromPreset("last_30_days", now, "Asia/Karachi", 0);
    expect(thirty.startDate).toBe("2026-09-05");
    expect(shiftSelection(thirty, -1, now, "Asia/Karachi", 0)).toEqual({
      preset: "custom",
      startDate: "2026-08-06",
      endDate: "2026-09-04",
    });
    expect(shiftSelection(ALL_DATES_SELECTION, -1, now, "Asia/Karachi", 0)).toEqual(
      ALL_DATES_SELECTION,
    );
  });

  it("builds a Sunday-start calendar grid and reports the list cap", () => {
    const days = monthCalendarDays(2026, 10, 0);
    expect(days[0]).toBe("2026-09-27");
    expect(days[7]).toBe("2026-10-04");
    expect(isTimeEntryListCapped(4999)).toBe(false);
    expect(isTimeEntryListCapped(TIME_ENTRY_LIST_LIMIT)).toBe(true);
    expect(timeEntryListCapMessage(TIME_ENTRY_LIST_LIMIT)).toMatch(/incomplete/i);
  });
});
