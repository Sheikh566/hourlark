import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest, memberId, seedApiFixture, workspaceId } from "./api-fixture";

describe("member week hours", () => {
  beforeEach(seedApiFixture);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clips an entry that crosses Monday midnight to the current week", async () => {
    const now = Date.parse("2026-10-05T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const startedAt = Date.parse("2026-10-04T17:00:00.000Z");
    const stoppedAt = Date.parse("2026-10-04T21:00:00.000Z");
    await env.DB.prepare(
      `INSERT INTO time_entries (
         id, workspace_id, member_id, description, started_at, stopped_at,
         created_by, updated_by, created_at, updated_at
       ) VALUES ('crossing-monday', ?, ?, 'Overnight', ?, ?, ?, ?, ?, ?)`,
    )
      .bind(workspaceId, memberId, startedAt, stoppedAt, memberId, memberId, startedAt, stoppedAt)
      .run();

    const response = await apiRequest("/members");
    expect(response.status).toBe(200);
    const body = await response.json<{ members: Array<{ id: string; week_tracked_ms: number }> }>();
    expect(body.members.find((member) => member.id === memberId)?.week_tracked_ms).toBe(
      2 * 3_600_000,
    );
  });
});
