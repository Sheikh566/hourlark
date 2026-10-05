import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { adminId, apiRequest, clientId, memberId, projectId, seedApiFixture } from "./api-fixture";

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

const projectBody = {
  version: 1,
  client_id: clientId,
  color: "#123456",
  billable_default: false,
  currency: "USD",
  visibility: "all" as const,
};

async function patchProject(body: Record<string, unknown>, db = env.DB): Promise<Response> {
  return apiRequest(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(body) }, db);
}

async function snapshot() {
  return {
    project: await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first(),
    assignments: (
      await env.DB.prepare("SELECT * FROM project_members WHERE project_id = ? ORDER BY member_id")
        .bind(projectId)
        .all()
    ).results,
    audit: (
      await env.DB.prepare("SELECT * FROM audit_logs WHERE target_id = ? ORDER BY id")
        .bind(projectId)
        .all()
    ).results,
    checks: (await env.DB.prepare("SELECT * FROM member_update_checks").all()).results,
  };
}

describe("atomic project updates", () => {
  beforeEach(async () => {
    await seedApiFixture();
    await env.DB.prepare("INSERT INTO project_members VALUES (?, ?, ?)")
      .bind(projectId, adminId, Date.now())
      .run();
  });

  it("leaves the winner's assignments and writes no loser audit after a stale batch", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
    let winnerState: Awaited<ReturnType<typeof snapshot>> | undefined;
    try {
      const db = beforeBatch(async () => {
        const winner = await patchProject({
          ...projectBody,
          name: "Winner project",
          member_ids: [memberId],
        });
        expect(winner.status).toBe(200);
        winnerState = await snapshot();
      });
      const loser = await patchProject(
        { ...projectBody, name: "Loser project", member_ids: [adminId] },
        db,
      );
      expect(loser.status).toBe(409);
      await expect(loser.json()).resolves.toMatchObject({ error: { code: "project_conflict" } });
      expect(await snapshot()).toEqual(winnerState);
      expect(winnerState?.project).toMatchObject({ name: "Winner project", version: 2 });
      expect(winnerState?.assignments).toEqual([
        expect.objectContaining({ project_id: projectId, member_id: memberId }),
      ]);
      expect(winnerState?.audit).toHaveLength(1);
      expect(winnerState?.checks).toEqual([]);
    } finally {
      clock.mockRestore();
    }
  });
});
