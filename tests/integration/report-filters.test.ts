import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { reportQuerySchema } from "@/worker/schemas";

import {
  adminId,
  apiRequest,
  clientId,
  memberId,
  otherProjectId,
  projectId,
  seedApiFixture,
  workspaceId,
} from "./api-fixture";

const inactiveId = "00000000-0000-4000-8000-000000000103";
const archivedClientId = "00000000-0000-4000-8000-000000000202";
const archivedClientProjectId = "00000000-0000-4000-8000-000000000303";
const tagId = "00000000-0000-4000-8000-000000000401";
const otherTagId = "00000000-0000-4000-8000-000000000402";
const startedAt = Date.UTC(2026, 0, 1);
const query = {
  start: new Date(startedAt).toISOString(),
  end: new Date(startedAt + 86_400_000).toISOString(),
  timezone: "UTC",
};

async function reportIds(filters: Record<string, string>, email = "admin@example.com") {
  const response = await apiRequest(
    `/reports/detailed?${new URLSearchParams({ ...query, ...filters })}`,
    {},
    env.DB,
    email,
  );
  expect(response.status).toBe(200);
  const { entries } = await response.json<{ entries: Array<{ id: string }> }>();
  return entries.map((entry) => entry.id).sort();
}

describe("report filter semantics", () => {
  beforeEach(async () => {
    await seedApiFixture();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO members (id, workspace_id, email, email_normalized, display_name,
          role, status, timezone, created_at, updated_at)
         VALUES (?, ?, 'inactive@example.com', 'inactive@example.com', 'Inactive',
           'member', 'inactive', 'UTC', ?, ?)`,
      ).bind(inactiveId, workspaceId, startedAt, startedAt),
      env.DB.prepare(
        `INSERT INTO clients (id, workspace_id, name, status, currency, created_at, updated_at)
         VALUES (?, ?, 'Archived client', 'archived', 'USD', ?, ?)`,
      ).bind(archivedClientId, workspaceId, startedAt, startedAt),
      env.DB.prepare(
        `INSERT INTO projects (id, workspace_id, client_id, name, color, currency,
          created_at, updated_at) VALUES (?, ?, ?, 'Archived client project', '#123456',
          'USD', ?, ?)`,
      ).bind(archivedClientProjectId, workspaceId, archivedClientId, startedAt, startedAt),
      env.DB.prepare("UPDATE projects SET status = 'archived' WHERE id = ?").bind(otherProjectId),
      ...[tagId, otherTagId].map((id) =>
        env.DB.prepare(
          `INSERT INTO tags (id, workspace_id, name, normalized_name, color, created_at, updated_at)
           VALUES (?, ?, ?, ?, '#123456', ?, ?)`,
        ).bind(id, workspaceId, id, id, startedAt, startedAt),
      ),
      ...[
        ["alpha", adminId, projectId, clientId, "Alpha"],
        ["beta", memberId, otherProjectId, clientId, "alpha beta"],
        ["inactive", inactiveId, archivedClientProjectId, archivedClientId, "ALPHA"],
        ["whitespace", memberId, null, null, " \t\n\r\u00a0"],
        ["literal", adminId, projectId, clientId, "100%_ready\\done"],
        ["blank", adminId, null, null, ""],
      ].map(([id, owner, project, client, description]) =>
        env.DB.prepare(
          `INSERT INTO time_entries (id, workspace_id, member_id, project_id, client_id,
            description, started_at, stopped_at, created_by, updated_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          workspaceId,
          owner,
          project,
          client,
          description,
          startedAt,
          startedAt + 60_000,
          owner,
          owner,
          startedAt,
          startedAt,
        ),
      ),
      ...[
        ["alpha", tagId],
        ["alpha", otherTagId],
        ["beta", otherTagId],
        ["literal", tagId],
      ].map(([entryId, id]) =>
        env.DB.prepare(
          "INSERT INTO time_entry_tags (time_entry_id, tag_id, created_at) VALUES (?, ?, ?)",
        ).bind(entryId, id, startedAt),
      ),
    ]);
  });

  it("ORs each multiselect, ANDs dimensions, and deduplicates selections", async () => {
    const filters = {
      member_ids: `${adminId},${memberId},${adminId}`,
      client_ids: `${clientId},${archivedClientId}`,
      filter_project_ids: `${projectId},${otherProjectId}`,
      tag_ids: `${tagId},${otherTagId}`,
    };
    expect(await reportIds(filters)).toEqual(["alpha", "beta", "literal"]);
    expect(await reportIds({ ...filters, tag_ids: otherTagId })).toEqual(["alpha", "beta"]);
    expect(await reportIds({ ...filters, client_ids: archivedClientId })).toEqual([]);
    expect(reportQuerySchema.parse({ ...query, ...filters }).member_ids).toEqual([
      adminId,
      memberId,
    ]);
  });

  it.each([
    [{ client_condition: "is_empty" }, ["blank", "whitespace"]],
    [{ project_condition: "is_empty" }, ["blank", "whitespace"]],
    [{ tag_condition: "is_empty" }, ["blank", "inactive", "whitespace"]],
    [{ member_condition: "is_active" }, ["alpha", "beta", "blank", "literal", "whitespace"]],
    [{ member_condition: "is_archived" }, ["inactive"]],
    [{ client_condition: "is_active" }, ["alpha", "beta", "literal"]],
    [{ client_condition: "is_archived" }, ["inactive"]],
    [{ project_condition: "is_active" }, ["alpha", "inactive", "literal"]],
    [{ project_condition: "is_archived" }, ["beta"]],
    [{ search: "ALpHa", description_condition: "contains" }, ["alpha", "beta", "inactive"]],
    [{ search: "ALpHa", description_condition: "is" }, ["alpha", "inactive"]],
    [{ search: "ignored", description_condition: "is_empty" }, ["blank", "whitespace"]],
    [{ search: "%_ready\\", description_condition: "contains" }, ["literal"]],
    [{ search: "%", description_condition: "is" }, []],
  ] satisfies Array<[Record<string, string>, string[]]>)(
    "matches empty/status/description predicate %j",
    async (filters, expected) => {
      expect(await reportIds(filters)).toEqual(expected);
    },
  );

  it("keeps singular filters and report-only behavior separate from the entry list", async () => {
    expect(
      await reportIds({ member_id: memberId, client_id: clientId, tag_id: otherTagId }),
    ).toEqual(["beta"]);
    expect(await reportIds({ project_id: projectId, search: "Alpha" })).toEqual(["alpha"]);
    const response = await apiRequest(
      `/time-entries?${new URLSearchParams({ ...query, member_condition: "is_archived" })}`,
    );
    const { entries } = await response.json<{ entries: unknown[] }>();
    expect(response.status).toBe(200);
    expect(entries).toHaveLength(6);
  });

  it("keeps summary, daily grouping, and CSV selections consistent with detailed", async () => {
    const filters = { filter_project_ids: `${projectId},${otherProjectId}`, tag_ids: otherTagId };
    const expected = await reportIds(filters);
    expect(expected).toEqual(["alpha", "beta"]);
    for (const groupBy of ["project", "day"]) {
      const summary = await apiRequest(
        `/reports/summary?${new URLSearchParams({ ...query, ...filters, group_by: groupBy })}`,
      );
      expect(summary.status).toBe(200);
      await expect(summary.json()).resolves.toMatchObject({
        totals: { tracked_duration_ms: expected.length * 60_000 },
      });
    }
    const csv = await apiRequest("/exports/csv", {
      method: "POST",
      body: JSON.stringify({ ...query, ...filters }),
    });
    expect(csv.status).toBe(200);
    const ids = (await csv.text())
      .trim()
      .split("\r\n")
      .slice(1)
      .map((line) => line.split(",")[0]?.slice(1, -1))
      .sort();
    expect(ids).toEqual(expected);
  });

  it.each<Record<string, string>>([
    { member_ids: "invalid" },
    { client_ids: `${clientId},invalid` },
    { filter_project_ids: `${projectId},` },
    { tag_ids: "" },
    { member_ids: Array.from({ length: 201 }, () => memberId).join(",") },
    { member_condition: "is_empty" },
    { tag_condition: "is_archived" },
    { description_condition: "is_not" },
  ])("rejects invalid/unsupported report filters %j", async (filters) => {
    const response = await apiRequest(
      `/reports/detailed?${new URLSearchParams({ ...query, ...filters })}`,
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "validation_failed" } });
  });

  it("preserves member isolation for selections and entity status conditions", async () => {
    const email = "member@example.com";
    expect(await reportIds({ member_ids: memberId }, email)).toEqual(["beta", "whitespace"]);
    expect(await reportIds({ project_condition: "is_archived" }, email)).toEqual(["beta"]);
    expect(await reportIds({ member_condition: "is_archived" }, email)).toEqual([]);
    const forbiddenFilters: Array<Record<string, string>> = [
      { member_ids: `${memberId},${adminId}` },
      { member_id: adminId },
      { member_ids: inactiveId, member_condition: "is_archived" },
    ];
    for (const filters of forbiddenFilters) {
      const response = await apiRequest(
        `/reports/detailed?${new URLSearchParams({ ...query, ...filters })}`,
        {},
        env.DB,
        email,
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "member_time_forbidden" },
      });
    }
  });
});
