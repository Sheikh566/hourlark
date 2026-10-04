import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  adminId,
  apiRequest,
  memberId,
  otherProjectId,
  projectId,
  seedApiFixture,
  workspaceId,
} from "./api-fixture";

function beforeBatch(run: () => Promise<void>): D1Database {
  return new Proxy(env.DB, {
    get(target, key) {
      if (key === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          await run();
          return target.batch(statements);
        };
      }
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? (value.bind(target) as unknown) : value;
    },
  });
}

async function patch(id: string, body: Record<string, unknown>, db = env.DB): Promise<Response> {
  return apiRequest(`/members/${id}`, { method: "PATCH", body: JSON.stringify(body) }, db);
}

async function snapshot(id = memberId) {
  return {
    member: await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(id).first(),
    timers: (await env.DB.prepare("SELECT * FROM time_entries WHERE member_id = ?").bind(id).all())
      .results,
    assignments: (
      await env.DB.prepare("SELECT * FROM project_members WHERE member_id = ? ORDER BY project_id")
        .bind(id)
        .all()
    ).results,
    audit: (
      await env.DB.prepare("SELECT * FROM audit_logs WHERE target_id = ? ORDER BY id")
        .bind(id)
        .all()
    ).results,
    checks: (await env.DB.prepare("SELECT * FROM member_update_checks").all()).results,
  };
}

describe("atomic member updates", () => {
  beforeEach(async () => {
    await seedApiFixture();
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO project_members VALUES (?, ?, ?)").bind(projectId, memberId, now),
      env.DB.prepare(
        `INSERT INTO time_entries (id, workspace_id, member_id, description, started_at,
          created_by, updated_by, created_at, updated_at)
         VALUES ('running-member-timer', ?, ?, 'Running', ?, ?, ?, ?, ?)`,
      ).bind(workspaceId, memberId, now - 60_000, adminId, adminId, now, now),
    ]);
  });

  it("preserves the winner's fields, assignments, timer and audit after a stale batch", async () => {
    // Force the winner to commit after the loser's read, even at an identical timestamp.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
    let winnerState: Awaited<ReturnType<typeof snapshot>> | undefined;
    try {
      const db = beforeBatch(async () => {
        const winner = await patch(memberId, {
          version: 1,
          display_name: "Winner",
          project_ids: [otherProjectId],
        });
        expect(winner.status).toBe(200);
        winnerState = await snapshot();
      });
      const loser = await patch(
        memberId,
        { version: 1, display_name: "Loser", status: "inactive", project_ids: [projectId] },
        db,
      );
      expect(loser.status).toBe(409);
      await expect(loser.json()).resolves.toMatchObject({ error: { code: "member_conflict" } });
      expect(await snapshot()).toEqual(winnerState);
      expect(winnerState?.checks).toEqual([]);
      expect(winnerState?.timers[0]).toMatchObject({ stopped_at: null });
    } finally {
      clock.mockRestore();
    }
  });

  it("aborts if the target disappears between the read and the batch", async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO members (id, workspace_id, email, email_normalized, display_name, role,
        status, timezone, last_seen_at, created_at, updated_at)
       VALUES (?, ?, 'temporary@iomechs.com', 'temporary@iomechs.com', 'Temporary',
         'member', 'active', 'UTC', ?, ?, ?)`,
    )
      .bind(id, workspaceId, Date.now(), Date.now(), Date.now())
      .run();
    const db = beforeBatch(async () => {
      await env.DB.prepare("DELETE FROM members WHERE id = ?").bind(id).run();
    });
    const response = await patch(id, { version: 1, project_ids: [] }, db);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "member_conflict" } });
    expect((await snapshot(id)).audit).toEqual([]);
    expect((await snapshot(id)).checks).toEqual([]);
  });

  it.each([{ role: "member" }, { status: "inactive" }])(
    "protects the remaining admin after another admin changes concurrently: %j",
    async (change) => {
      await env.DB.prepare("UPDATE members SET role = 'admin' WHERE id = ?").bind(memberId).run();
      let winnerState: Awaited<ReturnType<typeof snapshot>> | undefined;
      const db = beforeBatch(async () => {
        const winner = await patch(memberId, { version: 1, role: "member" });
        expect(winner.status).toBe(200);
        winnerState = await snapshot(adminId);
      });
      const response = await patch(
        adminId,
        { version: 1, ...change, project_ids: [projectId] },
        db,
      );
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "last_admin_protected" },
      });
      expect(await snapshot(adminId)).toEqual(winnerState);
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM members WHERE role = 'admin' AND status = 'active'",
        ).first(),
      ).toEqual({ count: 1 });
    },
  );

  it("still commits valid deactivation, assignments, timer stop and audit together", async () => {
    const response = await patch(memberId, { version: 1, status: "inactive", project_ids: [] });
    expect(response.status).toBe(200);
    const state = await snapshot();
    expect(state.member).toMatchObject({ status: "inactive", version: 2 });
    expect(state.assignments).toEqual([]);
    expect(state.timers).toHaveLength(1);
    expect(state.timers[0]).toMatchObject({ updated_by: adminId, version: 2 });
    expect(state.timers[0]?.stopped_at).toBeTypeOf("number");
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({ action: "member.deactivated" });
    expect(state.checks).toEqual([]);
  });

  it("allows manager assignment-only updates without granting profile or role access", async () => {
    await env.DB.prepare("UPDATE members SET role = 'manager' WHERE id = ?").bind(memberId).run();
    const response = await apiRequest(
      `/members/${adminId}`,
      { method: "PATCH", body: JSON.stringify({ version: 1, project_ids: [projectId] }) },
      env.DB,
      "member@iomechs.com",
    );
    expect(response.status).toBe(200);
    const assigned = await snapshot(adminId);
    expect(assigned.member).toMatchObject({ role: "admin", version: 2 });
    expect(assigned.assignments).toHaveLength(1);
    expect(assigned.assignments[0]).toMatchObject({ project_id: projectId });
    const forbidden = await apiRequest(
      `/members/${adminId}`,
      { method: "PATCH", body: JSON.stringify({ version: 2, display_name: "Forbidden" }) },
      env.DB,
      "member@iomechs.com",
    );
    expect(forbidden.status).toBe(403);
    expect(await snapshot(adminId)).toEqual(assigned);
  });

  it("rolls back unrelated SQL failures and does not mislabel them as conflicts", async () => {
    const initial = await snapshot();
    const db = new Proxy(env.DB, {
      get(target, key) {
        if (key === "batch") {
          return (statements: D1PreparedStatement[]) =>
            target.batch([
              ...statements,
              target.prepare(
                "UPDATE time_entries SET stopped_at = started_at WHERE id = 'running-member-timer'",
              ),
            ]);
        }
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? (value.bind(target) as unknown) : value;
      },
    });
    const response = await patch(memberId, { version: 1, status: "inactive", project_ids: [] }, db);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "internal_error" } });
    expect(await snapshot()).toEqual(initial);
  });
});
