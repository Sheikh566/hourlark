import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

const origin = "https://time.test";
const adminEmail = "sheikh.abdullah@iomechs.com";

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Dev-User-Email", adminEmail);
  return exports.default.fetch(
    new Request(`${origin}/api/v1${path}`, {
      ...init,
      headers,
    }),
  );
}

describe("timer API", () => {
  let csrfToken = "";

  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT INTO members (
        id, workspace_id, email, email_normalized, display_name, role, status, timezone,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'admin', 'active', ?, ?, ?)`,
    )
      .bind(
        "00000000-0000-4000-8000-000000000101",
        "00000000-0000-4000-8000-000000000001",
        adminEmail,
        adminEmail,
        "Sheikh Abdullah",
        "Asia/Karachi",
        1_785_369_600_000,
        1_785_369_600_000,
      )
      .run();
    const meResponse = await request("/me");
    expect(meResponse.status).toBe(200);
    const me = await meResponse.json<{ csrf_token: string }>();
    csrfToken = me.csrf_token;
  });

  it("uses authoritative time and returns the original result for an idempotent retry", async () => {
    const key = "start-timer-test-key";
    const start = () =>
      request("/timer/start", {
        method: "POST",
        headers: {
          Origin: origin,
          "Sec-Fetch-Site": "same-origin",
          "X-CSRF-Token": csrfToken,
          "Idempotency-Key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description: "Integration test",
          project_id: null,
          tag_ids: [],
          billable: false,
        }),
      });

    const firstResponse = await start();
    const retryResponse = await start();
    expect(firstResponse.status).toBe(200);
    expect(retryResponse.status).toBe(200);
    const first = await firstResponse.json<{
      entry: { id: string; started_at: string; running: boolean };
      server_now: string;
    }>();
    const retry = await retryResponse.json<typeof first>();
    expect(retry).toEqual(first);
    expect(first.entry.running).toBe(true);
    expect(first.entry.started_at).toBe(first.server_now);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM time_entries WHERE stopped_at IS NULL",
    ).first<{ count: number }>();
    expect(count?.count).toBe(1);

    const stopResponse = await request("/timer/stop", {
      method: "POST",
      headers: {
        Origin: origin,
        "Sec-Fetch-Site": "same-origin",
        "X-CSRF-Token": csrfToken,
        "Idempotency-Key": "stop-timer-test-key",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(stopResponse.status).toBe(200);
    const stopped = await stopResponse.json<{
      entry: { id: string; stopped_at: string };
      server_now: string;
    }>();
    expect(stopped.entry.id).toBe(first.entry.id);
    expect(stopped.entry.stopped_at).toBe(stopped.server_now);
  });

  it("rejects a state-changing request without same-origin CSRF proof", async () => {
    const response = await request("/timer/start", {
      method: "POST",
      headers: {
        "Idempotency-Key": "missing-csrf-test-key",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "csrf_origin_invalid" },
    });
  });
});
