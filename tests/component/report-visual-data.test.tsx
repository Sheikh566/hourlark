import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDayPoints, buildSlices, niceTicks } from "@/web/features/reports/report-charts";
import { ReportBreakdown } from "@/web/features/reports/report-breakdown";
import { ReportDetailedTable } from "@/web/features/reports/report-detailed-table";
import type { DetailedRow, SummaryGroup, SummaryReport } from "@/web/features/reports/report-types";
import { formatAxisHours, formatDecimalHours, formatReportDuration } from "@/web/lib/format";

const group = (key: string, duration: number): SummaryGroup => ({
  key,
  label: key,
  rawDurationMs: duration,
  roundedDurationMs: duration,
  billableDurationMs: 0,
  nonBillableDurationMs: duration,
  percentOfTotal: 50,
});

afterEach(cleanup);
describe("report presentation data", () => {
  it("fills zero days, including DST dates, without changing tracked durations", () => {
    expect(buildDayPoints([group("2026-11-01", 3_600_000)], "2026-10-31", "2026-11-02")).toEqual([
      { key: "2026-10-31", durationMs: 0 },
      { key: "2026-11-01", durationMs: 3_600_000 },
      { key: "2026-11-02", durationMs: 0 },
    ]);
    expect(buildDayPoints([], "2024-01-01", "2025-12-31")).toHaveLength(731);
    expect(niceTicks(17 * 3_600_000)).toEqual([0, 210, 420, 630, 840, 1050].map((m) => m * 60_000));
  });

  it("uses project colors and excludes zero-duration slices", () => {
    expect(
      buildSlices([group("p1", 60_000), group("p2", 0)], "project", new Map([["p1", "#123456"]])),
    ).toEqual([{ key: "p1", label: "p1", durationMs: 60_000, percent: 100, color: "#123456" }]);
    expect(formatReportDuration(0)).toBe("-");
    expect(formatReportDuration(3_661_000)).toBe("1:01:01");
    expect(formatDecimalHours(31_050_000)).toBe("8.63");
    expect(formatAxisHours(12_600_000)).toBe("3h 30");
  });

  it("expands aligned child rows, sorts the complete breakdown and retains totals", async () => {
    const report: SummaryReport = {
      generated_at: "2026-11-01T00:00:00Z",
      timezone: "UTC",
      totals: {
        tracked_duration_ms: 120_000,
        billable_duration_ms: 0,
        non_billable_duration_ms: 120_000,
      },
      groups: [
        { ...group("Zulu", 60_000), children: [group("Member", 60_000)] },
        group("Alpha", 60_000),
      ],
    };
    render(
      <ReportBreakdown
        report={report}
        groupBy="project"
        secondary="member"
        colors={new Map()}
        onGroupChange={vi.fn()}
        onSecondaryChange={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Expand Zulu" }));
    expect(screen.getByRole("row", { name: /Member 0:01:00 50%/ })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Sort by project | member" }));
    expect(within(screen.getAllByRole("row")[1] ?? document.body).getByText("Alpha")).toBeVisible();
    expect(screen.getByRole("row", { name: "Total 0:02:00 100%" })).toBeVisible();
  });

  it("selects only the current page, formats both time lines, and keeps server sorting and pagination", async () => {
    const row: DetailedRow = {
      id: "r1",
      date: "2026-11-01",
      member: { id: "m1", name: "Member" },
      client: { id: null, name: "No client" },
      project: { id: null, name: "No project", color: null },
      description: "Work",
      tags: [],
      local_start: "2026-11-01 13:05",
      local_stop: "2026-11-01 13:35",
      raw_duration_ms: 1_800_000,
      rounded_duration_ms: 1_800_000,
      billable: false,
      running: false,
    };
    const onSort = vi.fn(),
      onNext = vi.fn();
    render(
      <ReportDetailedTable
        rows={[row]}
        loading={false}
        periodLabel="this month"
        sort="started_desc"
        onSortChange={onSort}
        hasPrevious={false}
        hasNext
        onFirstPage={vi.fn()}
        onNextPage={onNext}
      />,
    );
    expect(screen.getByText("1:05 PM - 1:35 PM")).toBeVisible();
    expect(screen.getByText("01/11/2026")).toBeVisible();
    expect(screen.getByText("0:30:00")).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Select all entries on this page" }));
    expect(screen.getByRole("checkbox", { name: "Select Work" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Select Work" }));
    expect(
      screen.getByRole("checkbox", { name: "Select all entries on this page" }),
    ).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Sort by time | date" }));
    expect(onSort).toHaveBeenCalledWith("started_asc");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(onNext).toHaveBeenCalledOnce();
  });
});
