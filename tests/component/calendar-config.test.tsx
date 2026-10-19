import { afterEach, describe, expect, it } from "vitest";
import {
  clampCalendarZoom,
  eventFillColor,
  pixelsPerHour,
  projectTextColor,
  projectPickerTextColor,
  readCalendarZoom,
  storeCalendarZoom,
} from "@/web/features/time/calendar-config";
import {
  addLocalDays,
  durationSecondsBetween,
  parseClockTime,
  parseLocalDateTime,
  stopFromDuration,
  stopWithTime,
  toLocalDateTime,
} from "@/web/features/time/entry-popover-time";

afterEach(() => localStorage.clear());

describe("calendar measured presentation", () => {
  it("keeps five 60px pitches and persists a clamped browser zoom", () => {
    expect([0, 1, 2, 3, 4].map(pixelsPerHour)).toEqual([30, 60, 120, 240, 720]);
    expect(readCalendarZoom()).toBe(3);
    storeCalendarZoom(100);
    expect(readCalendarZoom()).toBe(4);
    expect(clampCalendarZoom(NaN)).toBe(3);
  });
  it("uses the measured neutral fill and 20 percent project tint", () => {
    expect(eventFillColor(null)).toBe("#343434");
    expect(eventFillColor("#06a893")).toBe("#173733");
    expect(eventFillColor("invalid")).toBe("#343434");
    expect(projectTextColor("#06a893")).toBe("#57efdb");
  });
  it("uses measured project and picker palettes independently", () => {
    const palette = [
      ["#0b83d9", "#31a9ff"],
      ["#9e5bd9", "#c481ff"],
      ["#d94182", "#ff67a8"],
      ["#e36a00", "#ff861c"],
      ["#bf7000", "#f6aa3e"],
      ["#2da608", "#7dee5b"],
      ["#06a893", "#57efdb"],
      ["#c9806b", "#fab29e"],
      ["#465bb3", "#8b9ff2"],
      ["#990099", "#ea5dea"],
      ["#c7af14", "#f9e24a"],
      ["#566614", "#cbd993"],
      ["#d92b2b", "#ff5151"],
      ["#525266", "#c8c8d9"],
      ["#991102", "#ea6d5f"],
    ];
    for (const [stored, expected] of palette) expect(projectTextColor(stored)).toBe(expected);
    expect(projectTextColor(" #06A893 ")).toBe("#57efdb");
    expect(projectPickerTextColor("#9e5bd9")).toBe("#c48bf6");
    expect(projectPickerTextColor("#d92b2b")).toBe("#f66363");
    expect(projectPickerTextColor("#06a893")).toBe("#57efdb");
    expect(projectTextColor("#123456")).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("calendar entry wall times", () => {
  it("parses compact and 24-hour input and rejects impossible times", () => {
    expect(["3pm", "330p", "15:30", "0930", "12:10 AM"].map(parseClockTime)).toEqual([
      "15:00:00",
      "15:30:00",
      "15:30:00",
      "09:30:00",
      "00:10:00",
    ]);
    for (const value of ["", "25:00", "3:60pm", "0am", "13pm", "9:00:99"])
      expect(parseClockTime(value)).toBeNull();
    expect(parseLocalDateTime("2026-02-30T10:00:00", "UTC")).toBeNull();
  });
  it("handles midnight, local-day shifts and DST durations", () => {
    expect(
      stopWithTime("2026-10-14T23:30:00", "2026-10-14T23:00:00", "00:10:00", "Asia/Karachi"),
    ).toBe("2026-10-15T00:10:00");
    expect(addLocalDays("2026-12-31T23:30:00", 1)).toBe("2027-01-01T23:30:00");
    expect(parseLocalDateTime("2026-03-08T02:30:00", "America/New_York")).toBeNull();
    const stop = stopFromDuration("2026-11-01T00:30:00", 3 * 3600, "America/New_York");
    expect(stop).toBe("2026-11-01T02:30:00");
    if (stop === null) throw new Error("Expected a valid stop time");
    expect(durationSecondsBetween("2026-11-01T00:30:00", stop, "America/New_York")).toBe(10800);
    expect(toLocalDateTime("2026-10-14T19:30:00Z", "Asia/Karachi")).toBe("2026-10-15T00:30:00");
  });
});
