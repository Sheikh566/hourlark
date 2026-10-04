import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  adminId,
  apiRequest,
  clientId,
  projectId,
  seedApiFixture,
  workspaceId,
} from "./api-fixture";

const start = Date.UTC(2026, 0, 1);
const query = {
  start: new Date(start).toISOString(),
  end: new Date(start + 7 * 86_400_000).toISOString(),
  timezone: "UTC",
};

describe("report completeness", () => {
  beforeEach(async () => {
    await seedApiFixture();
    await env.DB.prepare(
      `WITH RECURSIVE entries(n) AS (
         SELECT 1 UNION ALL SELECT n + 1 FROM entries WHERE n < 5001
       )
       INSERT INTO time_entries (id, workspace_id, member_id, project_id, client_id,
         description, started_at, stopped_at, billable, rate_minor, rate_currency,
         rate_source, created_by, updated_by, created_at, updated_at)
       SELECT 'report-' || n, ?, ?, ?, ?, 'Report entry', ? + n * 60000,
         ? + (n + 1) * 60000, 1, 6000, 'USD', 'entry', ?, ?, ?, ? FROM entries`,
    )
      .bind(workspaceId, adminId, projectId, clientId, start, start, adminId, adminId, start, start)
      .run();
  });

  it.each(["/reports/summary", "/reports/detailed", "/exports/csv", "/exports/pdf"])(
    "rejects overflow in %s instead of returning partial data",
    async (path) => {
      const response = path.startsWith("/reports/")
        ? await apiRequest(`${path}?${new URLSearchParams(query)}`)
        : await apiRequest(path, {
            method: "POST",
            body: JSON.stringify({ ...query, client_id: clientId }),
          });
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "report_too_large", max_entries: 5000 },
      });
    },
  );

  it("includes every duration and amount at the 5,000-entry boundary", async () => {
    await env.DB.prepare("UPDATE time_entries SET deleted_at = ? WHERE id = 'report-5001'")
      .bind(start)
      .run();
    const response = await apiRequest(`/reports/summary?${new URLSearchParams(query)}`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      totals: {
        tracked_duration_ms: 5000 * 60_000,
        billable_duration_ms: 5000 * 60_000,
        amounts: { USD: 500_000 },
      },
    });
    const csv = await apiRequest("/exports/csv", {
      method: "POST",
      body: JSON.stringify(query),
    });
    expect(csv.status).toBe(200);
    expect((await csv.text()).trim().split("\r\n")).toHaveLength(5001);
    const pdf = await apiRequest("/exports/pdf", {
      method: "POST",
      body: JSON.stringify({ ...query, client_id: clientId }),
    });
    expect(pdf.status).toBe(422);
    await expect(pdf.json()).resolves.toMatchObject({ error: { code: "pdf_too_large" } });
  });

  it("allows a filtered range and a member's own report despite workspace overflow", async () => {
    const filtered = await apiRequest(
      `/reports/summary?${new URLSearchParams({
        ...query,
        end: new Date(start + 61 * 60_000).toISOString(),
      })}`,
    );
    expect(filtered.status).toBe(200);
    await expect(filtered.json()).resolves.toMatchObject({
      totals: { tracked_duration_ms: 60 * 60_000, amounts: { USD: 6000 } },
    });
    const own = await apiRequest(
      `/reports/summary?${new URLSearchParams(query)}`,
      {},
      env.DB,
      "member@iomechs.com",
    );
    expect(own.status).toBe(200);
    await expect(own.json()).resolves.toMatchObject({ totals: { tracked_duration_ms: 0 } });
  });
});
