import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  apiRequest,
  clientId,
  memberId,
  projectId,
  seedApiFixture,
  workspaceId,
} from "./api-fixture";

describe("continue with archived tags", () => {
  beforeEach(seedApiFixture);

  it("continues the entry without tags that were archived after it stopped", async () => {
    const tagId = crypto.randomUUID();
    const entryId = crypto.randomUUID();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tags (
           id, workspace_id, name, normalized_name, color, status, created_at, updated_at
         ) VALUES (?, ?, 'Launch', 'launch', '#112233', 'active', ?, ?)`,
      ).bind(tagId, workspaceId, now, now),
      env.DB.prepare(
        `INSERT INTO time_entries (
           id, workspace_id, member_id, project_id, client_id, description, started_at, stopped_at,
           billable, created_by, updated_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'Kept description', ?, ?, 0, ?, ?, ?, ?)`,
      ).bind(
        entryId,
        workspaceId,
        memberId,
        projectId,
        clientId,
        now - 120_000,
        now - 60_000,
        memberId,
        memberId,
        now,
        now,
      ),
      env.DB.prepare(
        "INSERT INTO time_entry_tags (time_entry_id, tag_id, created_at) VALUES (?, ?, ?)",
      ).bind(entryId, tagId, now),
    ]);
    const archived = await apiRequest(`/tags/${tagId}/archive`, { method: "POST" });
    expect(archived.status).toBe(200);

    const response = await apiRequest(
      `/time-entries/${entryId}/continue`,
      {
        method: "POST",
        headers: { "Idempotency-Key": "continue-archived-tag" },
        body: "{}",
      },
      env.DB,
      "member@iomechs.com",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      entry: { description: "Kept description", tags: [], billable: false },
    });
  });
});
