import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  apiRequest,
  clientId,
  otherProjectId,
  projectId,
  seedApiFixture,
  workspaceId,
} from "./api-fixture";

const otherClientId = "00000000-0000-4000-8000-000000000202";

describe("project change rate snapshots", () => {
  beforeEach(async () => {
    await seedApiFixture();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO clients (id, workspace_id, name, currency, created_at, updated_at)
         VALUES (?, ?, 'Other client', 'USD', ?, ?)`,
      ).bind(otherClientId, workspaceId, now, now),
      env.DB.prepare(
        "UPDATE projects SET billable_default = 1, hourly_rate_minor = 10000 WHERE id = ?",
      ).bind(projectId),
      env.DB.prepare(
        `UPDATE projects SET client_id = ?, billable_default = 1, hourly_rate_minor = 15000
         WHERE id = ?`,
      ).bind(otherClientId, otherProjectId),
    ]);
  });

  it("moves the client and resolves the new project rate when no explicit rate is sent", async () => {
    const created = await apiRequest("/time-entries", {
      method: "POST",
      body: JSON.stringify({
        description: "Billable work",
        project_id: projectId,
        tag_ids: [],
        billable: true,
        started_at: "2026-10-05T04:00:00.000Z",
        stopped_at: "2026-10-05T05:00:00.000Z",
      }),
    });
    expect(created.status).toBe(201);
    const entry = await created.json<{
      entry: { id: string; version: number; client: { id: string }; rate_minor: number };
    }>();
    expect(entry.entry.client.id).toBe(clientId);
    expect(entry.entry.rate_minor).toBe(10_000);

    await env.DB.prepare("UPDATE projects SET hourly_rate_minor = 99999 WHERE id = ?")
      .bind(projectId)
      .run();
    const described = await apiRequest(`/time-entries/${entry.entry.id}`, {
      method: "PATCH",
      body: JSON.stringify({ version: entry.entry.version, description: "Same project" }),
    });
    expect(described.status).toBe(200);
    const kept = await described.json<{
      entry: { version: number; client: { id: string }; rate_minor: number };
    }>();
    expect(kept.entry.rate_minor).toBe(10_000);
    expect(kept.entry.client.id).toBe(clientId);

    const moved = await apiRequest(`/time-entries/${entry.entry.id}`, {
      method: "PATCH",
      body: JSON.stringify({ version: kept.entry.version, project_id: otherProjectId }),
    });
    expect(moved.status).toBe(200);
    await expect(moved.json()).resolves.toMatchObject({
      entry: {
        client: { id: otherClientId },
        rate_minor: 15_000,
        rate_source: "project",
      },
    });
  });
});
