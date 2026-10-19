import { describe, expect, it } from "vitest";

import { averageDailyDurationMs, trackedDayCount } from "@/domain/reports/averages";
import type { ReportRow } from "@/domain/reports/reporting";

function row(startIso: string, durationMs = 3_600_000): ReportRow {
  const clippedStart = Date.parse(startIso);
  return {
    id: startIso,
    date: startIso.slice(0, 10),
    memberId: "member",
    memberName: "Member",
    clientId: null,
    clientName: "No client",
    projectId: null,
    projectName: "No project",
    projectColor: null,
    projectBudgetMinutes: null,
    description: "Work",
    tags: [],
    startedAt: clippedStart,
    stoppedAt: clippedStart + durationMs,
    clippedStart,
    clippedStop: clippedStart + durationMs,
    rawDurationMs: durationMs,
    roundedDurationMs: durationMs,
    billable: false,
    rateMinor: null,
    currency: null,
    amountMinor: null,
    running: false,
  };
}

describe("average daily hours", () => {
  it("divides by days with tracked time, not by every day in the range", () => {
    // Toggl: 17:15:00 tracked on 2 days of a month-long range is 8.625 hours per tracked day.
    const total = (17 * 60 + 15) * 60_000;
    expect(averageDailyDurationMs(total, 2)).toBe(total / 2);
    expect(averageDailyDurationMs(total, 2) / 3_600_000).toBeCloseTo(8.625);
  });

  it("is zero for an empty range instead of dividing by zero", () => {
    expect(trackedDayCount([], "Asia/Karachi")).toBe(0);
    expect(averageDailyDurationMs(0, 0)).toBe(0);
    expect(averageDailyDurationMs(1_000, 0)).toBe(0);
  });

  it("counts several entries on one member-local day once", () => {
    const rows = [
      row("2026-10-05T04:00:00.000Z"),
      row("2026-10-05T09:00:00.000Z"),
      row("2026-10-06T04:00:00.000Z"),
    ];
    expect(trackedDayCount(rows, "Asia/Karachi")).toBe(2);
  });

  it("attributes days in the member zone, not UTC", () => {
    // 19:30Z on Oct 4 is already Oct 5 in Karachi (UTC+5): one local day, two UTC days.
    const rows = [row("2026-10-04T19:30:00.000Z"), row("2026-10-05T10:00:00.000Z")];
    expect(trackedDayCount(rows, "Asia/Karachi")).toBe(1);
    expect(trackedDayCount(rows, "UTC")).toBe(2);
  });

  it("handles the 25-hour fall-back DST day in America/New_York", () => {
    const rows = [
      row("2026-11-01T03:30:00.000Z"), // Oct 31 23:30 EDT
      row("2026-11-01T05:30:00.000Z"), // Nov 1 01:30 EDT (first)
      row("2026-11-01T06:30:00.000Z"), // Nov 1 01:30 EST (repeated hour)
      row("2026-11-02T04:30:00.000Z"), // Nov 1 23:30 EST, already Nov 2 in UTC
      row("2026-11-02T05:15:00.000Z"), // Nov 2 00:15 EST
    ];
    expect(trackedDayCount(rows, "America/New_York")).toBe(3);
  });

  it("handles the 23-hour spring-forward DST day in America/New_York", () => {
    const rows = [
      row("2026-03-08T04:59:00.000Z"), // Mar 7 23:59 EST
      row("2026-03-08T05:00:00.000Z"), // Mar 8 00:00 EST
      row("2026-03-08T06:59:00.000Z"), // Mar 8 01:59 EST
      row("2026-03-08T07:00:00.000Z"), // Mar 8 03:00 EDT
      row("2026-03-09T03:59:00.000Z"), // Mar 8 23:59 EDT
      row("2026-03-09T04:00:00.000Z"), // Mar 9 00:00 EDT
    ];
    expect(trackedDayCount(rows, "America/New_York")).toBe(3);
  });

  it("ignores rows without clipped duration", () => {
    expect(trackedDayCount([row("2026-10-05T04:00:00.000Z", 0)], "Asia/Karachi")).toBe(0);
  });
});
