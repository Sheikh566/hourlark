import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { apiRequest, memberId, projectId, seedApiFixture, workspaceId } from "./api-fixture";

const member = "member@iomechs.com";

function mutate(
  path: string,
  body: Record<string, unknown>,
  email = member,
  idempotencyKey?: string,
): Promise<Response> {
  return apiRequest(
    path,
    {
      method: path.endsWith("/continue") || path.endsWith("/start") ? "POST" : "PATCH",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(body),
    },
    env.DB,
    email,
  );
}

describe("member billable policy", () => {
  beforeEach(async () => {
    await seedApiFixture();
    await env.DB.batch([
      env.DB.prepare("UPDATE workspaces SET members_can_set_billable = 0 WHERE id = ?").bind(
        workspaceId,
      ),
      env.DB.prepare(
        "UPDATE projects SET billable_default = 1, hourly_rate_minor = 10000 WHERE id = ?",
      ).bind(projectId),
    ]);
  });

  it("starts, edits, and continues time on a billable project without marking it billable", async () => {
    const forbidden = await mutate(
      "/timer/start",
      { description: "Should fail", project_id: projectId, tag_ids: [], billable: true },
      member,
      "billable-forbidden-start",
    );
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({
      error: { code: "billable_change_forbidden" },
    });

    const started = await mutate(
      "/timer/start",
      { description: "Design", project_id: projectId, tag_ids: [] },
      member,
      "billable-allowed-start",
    );
    expect(started.status).toBe(200);
    const running = await started.json<{
      entry: { id: string; version: number; billable: boolean };
    }>();
    expect(running.entry.billable).toBe(false);

    const described = await mutate(`/time-entries/${running.entry.id}`, {
      version: running.entry.version,
      description: "Design review",
    });
    expect(described.status).toBe(200);
    const edited = await described.json<{ entry: { version: number; description: string } }>();
    expect(edited.entry.description).toBe("Design review");

    const promoted = await mutate(`/time-entries/${running.entry.id}`, {
      version: edited.entry.version,
      billable: true,
    });
    expect(promoted.status).toBe(403);

    const continued = await mutate(
      `/time-entries/${running.entry.id}/continue`,
      {},
      member,
      "billable-continue",
    );
    expect(continued.status).toBe(200);
    const next = await continued.json<{ entry: { description: string; billable: boolean } }>();
    expect(next.entry.description).toBe("Design review");
    expect(next.entry.billable).toBe(false);
  });

  it("keeps an already billable entry billable when the member edits the description", async () => {
    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO time_entries (
         id, workspace_id, member_id, project_id, client_id, description, started_at, stopped_at,
         billable, rate_minor, rate_currency, rate_source, created_by, updated_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, 'Billable', ?, ?, 1, 10000, 'USD', 'project', ?, ?, ?, ?)`,
    )
      .bind(
        id,
        workspaceId,
        memberId,
        projectId,
        now - 3_600_000,
        now - 60_000,
        memberId,
        memberId,
        now,
        now,
      )
      .run();

    const response = await mutate(`/time-entries/${id}`, {
      version: 1,
      description: "Still billable",
      billable: true,
    });
    expect(response.status).toBe(200);
    const body = await response.json<{ entry: { description: string; billable: boolean } }>();
    expect(body.entry).toMatchObject({ description: "Still billable", billable: true });
  });
});
