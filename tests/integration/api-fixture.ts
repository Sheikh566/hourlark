import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";

import app from "@/worker/index";

export const workspaceId = "00000000-0000-4000-8000-000000000001";
export const adminId = "00000000-0000-4000-8000-000000000101";
export const memberId = "00000000-0000-4000-8000-000000000102";
export const clientId = "00000000-0000-4000-8000-000000000201";
export const projectId = "00000000-0000-4000-8000-000000000301";
export const otherProjectId = "00000000-0000-4000-8000-000000000302";
const origin = "https://time.test";

export async function seedApiFixture(): Promise<void> {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  const now = Date.now();
  await env.DB.batch([
    ...[
      { id: adminId, email: "admin@iomechs.com", role: "admin" },
      { id: memberId, email: "member@iomechs.com", role: "member" },
    ].map(({ id, email, role }) =>
      env.DB.prepare(
        `INSERT INTO members (id, workspace_id, email, email_normalized, display_name,
          role, status, timezone, last_seen_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 'UTC', ?, ?, ?)`,
      ).bind(id, workspaceId, email, email, role, role, now, now, now),
    ),
    env.DB.prepare(
      `INSERT INTO clients (id, workspace_id, name, currency, created_at, updated_at)
       VALUES (?, ?, 'Test client', 'USD', ?, ?)`,
    ).bind(clientId, workspaceId, now, now),
    ...[projectId, otherProjectId].map((id) =>
      env.DB.prepare(
        `INSERT INTO projects (id, workspace_id, client_id, name, color, currency,
          created_at, updated_at) VALUES (?, ?, ?, ?, '#123456', 'USD', ?, ?)`,
      ).bind(id, workspaceId, clientId, id, now, now),
    ),
  ]);
}

export async function apiRequest(
  path: string,
  init: RequestInit = {},
  db = env.DB,
  email = "admin@iomechs.com",
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Dev-User-Email", email);
  if (init.method && init.method !== "GET") {
    const me = await app.fetch(new Request(`${origin}/api/v1/me`, { headers }), { ...env, DB: db });
    const { csrf_token } = await me.json<{ csrf_token: string }>();
    headers.set("Origin", origin);
    headers.set("Sec-Fetch-Site", "same-origin");
    headers.set("X-CSRF-Token", csrf_token);
    headers.set("Content-Type", "application/json");
  }
  return app.fetch(new Request(`${origin}/api/v1${path}`, { ...init, headers }), {
    ...env,
    DB: db,
  });
}
