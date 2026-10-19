import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { adminId, apiRequest, seedApiFixture, workspaceId } from "./api-fixture";

describe("report tracked days", () => {
  beforeEach(seedApiFixture);

  it("counts clipped entries in the requested report zone across fall DST", async () => {
    // Both entries begin before the range. Their clipped starts are the same local day,
    // even though the second 01:30 occurs after the clocks go back.
    const start = Date.parse("2026-11-01T04:00:00Z");
    for (const [index, [from, to]] of [
      ["2026-10-31T22:00:00Z", "2026-11-01T05:30:00Z"],
      ["2026-11-01T02:00:00Z", "2026-11-01T06:30:00Z"],
    ].entries()) {
      await env.DB.prepare(
        `INSERT INTO time_entries (id, workspace_id, member_id, description,
          started_at, stopped_at, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, 'HLTEST clipped report', ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          `average-${index}`,
          workspaceId,
          adminId,
          Date.parse(from ?? ""),
          Date.parse(to ?? ""),
          adminId,
          adminId,
          start,
          start,
        )
        .run();
    }
    const response = await apiRequest(
      `/reports/summary?${new URLSearchParams({
        start: new Date(start).toISOString(),
        end: "2026-11-02T05:00:00.000Z",
        timezone: "America/New_York",
        group_by: "day",
      })}`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totals: { tracked_days: 1, tracked_duration_ms: 4 * 3_600_000 },
      groups: [{ key: "2026-11-01", rawDurationMs: 4 * 3_600_000 }],
    });
  });

  it("returns zero tracked days when no entries overlap the range", async () => {
    const response = await apiRequest(
      `/reports/summary?${new URLSearchParams({
        start: "2026-11-01T04:00:00.000Z",
        end: "2026-11-02T05:00:00.000Z",
        timezone: "America/New_York",
      })}`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totals: { tracked_days: 0, tracked_duration_ms: 0 },
      groups: [],
    });
  });
});
