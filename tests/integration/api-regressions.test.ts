import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  clientId,
  memberId,
  otherProjectId,
  projectId,
  seedApiFixture,
  workspaceId,
} from "./api-fixture";

// Small API regressions share one file: each Workers test file pays its own runtime startup.

describe("project client state", () => {
  beforeEach(seedApiFixture);

  const body = {
    version: 1,
    client_id: clientId,
    name: "Updated name",
    color: "#123456",
    billable_default: false,
    currency: "USD",
    visibility: "all",
    member_ids: [],
  };
  it("can edit a project's metadata while retaining its archived client", async () => {
    await env.DB.prepare("UPDATE clients SET status = 'archived' WHERE id = ?")
      .bind(clientId)
      .run();
    const result = await apiRequest(`/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    expect(result.status).toBe(200);
    expect(
      await env.DB.prepare("SELECT name, client_id FROM projects WHERE id = ?")
        .bind(projectId)
        .first(),
    ).toMatchObject({ name: "Updated name", client_id: clientId });
  });
  it("still rejects a new association to an archived client", async () => {
    const archivedId = "00000000-0000-4000-8000-000000000299";
    await env.DB.prepare(
      "INSERT INTO clients (id,workspace_id,name,status,currency,created_at,updated_at) VALUES (?,?,'Archived','archived','USD',0,0)",
    )
      .bind(archivedId, workspaceId)
      .run();
    const result = await apiRequest(`/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify({ ...body, client_id: archivedId }),
    });
    expect(result.status).toBe(422);
    expect(
      await env.DB.prepare("SELECT client_id FROM projects WHERE id = ?").bind(projectId).first(),
    ).toMatchObject({ client_id: clientId });
  });
});

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
