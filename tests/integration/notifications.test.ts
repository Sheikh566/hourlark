import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deleteSubscriptionsById, listSubscriptions } from "@/db/repositories/notifications";
import { runNotificationSweep } from "@/worker/services/notifications";

import { adminId, apiRequest, memberId, seedApiFixture, workspaceId } from "./api-fixture";

const HOUR = 60 * 60 * 1000;
// Monday 26 October 2026, 17:00 UTC. Fixture members use the UTC timezone.
const mondayFive = Date.UTC(2026, 9, 26, 17, 0);

async function insertEntry(member: string, startedAt: number, stoppedAt: number | null) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO time_entries (id, workspace_id, member_id, started_at, stopped_at,
      created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, workspaceId, member, startedAt, stoppedAt, member, member, startedAt, startedAt)
    .run();
  return id;
}

async function notificationsFor(member: string) {
  const result = await env.DB.prepare(
    "SELECT kind, dedupe_key, body, created_at FROM notifications WHERE member_id = ? ORDER BY created_at",
  )
    .bind(member)
    .all<{ kind: string; dedupe_key: string; body: string; created_at: number }>();
  return result.results;
}

async function setPreferences(member: string, values: Record<string, number>) {
  const defaults = {
    long_timer_enabled: 1,
    long_timer_minutes: 480,
    reminder_enabled: 1,
    reminder_time_minutes: 1020,
    reminder_threshold_minutes: 240,
    reminder_weekdays: 31,
  };
  const row = { ...defaults, ...values };
  await env.DB.prepare(
    `INSERT INTO notification_preferences (member_id, workspace_id, long_timer_enabled,
      long_timer_minutes, reminder_enabled, reminder_time_minutes, reminder_threshold_minutes,
      reminder_weekdays, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
  )
    .bind(
      member,
      workspaceId,
      row.long_timer_enabled,
      row.long_timer_minutes,
      row.reminder_enabled,
      row.reminder_time_minutes,
      row.reminder_threshold_minutes,
      row.reminder_weekdays,
    )
    .run();
}

async function disableReminders() {
  for (const member of [adminId, memberId]) await setPreferences(member, { reminder_enabled: 0 });
}

beforeEach(async () => {
  await seedApiFixture();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("long-running timer", () => {
  beforeEach(disableReminders);

  it("notifies once per entry after the threshold, even when sweeps repeat", async () => {
    const entryId = await insertEntry(memberId, mondayFive - 8 * HOUR, null);

    await runNotificationSweep(env, mondayFive - 1);
    expect(await notificationsFor(memberId)).toEqual([]);

    expect((await runNotificationSweep(env, mondayFive)).created).toBe(1);
    expect((await runNotificationSweep(env, mondayFive + 5 * 60_000)).created).toBe(0);
    expect(await notificationsFor(memberId)).toEqual([
      expect.objectContaining({
        kind: "long_running_timer",
        dedupe_key: entryId,
        body: "Your timer has been running for 8h.",
      }),
    ]);
  });

  it("honours a custom threshold and the toggle", async () => {
    await env.DB.prepare("DELETE FROM notification_preferences").run();
    await setPreferences(memberId, { reminder_enabled: 0, long_timer_minutes: 120 });
    await setPreferences(adminId, { reminder_enabled: 0, long_timer_enabled: 0 });
    await insertEntry(memberId, mondayFive - 2 * HOUR, null);
    await insertEntry(adminId, mondayFive - 20 * HOUR, null);

    await runNotificationSweep(env, mondayFive);

    expect(await notificationsFor(memberId)).toHaveLength(1);
    expect(await notificationsFor(adminId)).toEqual([]);
  });

  it("skips stopped, deleted, and inactive members' timers", async () => {
    await insertEntry(memberId, mondayFive - 10 * HOUR, mondayFive - HOUR);
    const deleted = await insertEntry(adminId, mondayFive - 10 * HOUR, null);
    await env.DB.prepare("UPDATE time_entries SET deleted_at = 1 WHERE id = ?").bind(deleted).run();

    await runNotificationSweep(env, mondayFive);
    expect(await notificationsFor(memberId)).toEqual([]);
    expect(await notificationsFor(adminId)).toEqual([]);

    await insertEntry(memberId, mondayFive - 9 * HOUR, null);
    await env.DB.prepare("UPDATE members SET status = 'inactive' WHERE id = ?")
      .bind(memberId)
      .run();
    await runNotificationSweep(env, mondayFive);
    expect(await notificationsFor(memberId)).toEqual([]);
  });
});

describe("tracking reminder", () => {
  beforeEach(async () => {
    // The admin keeps defaults; isolate the member under test.
    await setPreferences(adminId, { reminder_enabled: 0 });
  });

  it("fires at the reminder time when under the threshold, once per local day", async () => {
    await insertEntry(memberId, mondayFive - 3 * HOUR, mondayFive - 2 * HOUR);

    await runNotificationSweep(env, mondayFive - 60_000);
    expect(await notificationsFor(memberId)).toEqual([]);

    await runNotificationSweep(env, mondayFive);
    await runNotificationSweep(env, mondayFive + HOUR);
    expect(await notificationsFor(memberId)).toEqual([
      expect.objectContaining({
        kind: "tracking_reminder",
        dedupe_key: "2026-10-26",
        body: "You've tracked 1h today (goal 4h).",
      }),
    ]);

    // Tuesday is a new local day.
    await runNotificationSweep(env, mondayFive + 24 * HOUR);
    expect((await notificationsFor(memberId)).map((row) => row.dedupe_key)).toEqual([
      "2026-10-26",
      "2026-10-27",
    ]);
  });

  it("counts running time and only today's share of an entry crossing midnight", async () => {
    // 22:00 Sunday to 03:00 Monday contributes 3h; a timer running since 16:00 adds 1h.
    await insertEntry(memberId, mondayFive - 19 * HOUR, mondayFive - 14 * HOUR);
    await insertEntry(memberId, mondayFive - HOUR, null);

    await runNotificationSweep(env, mondayFive);
    expect(await notificationsFor(memberId)).toEqual([]);
  });

  it("counts a timer that started before the look-back window", async () => {
    await setPreferences(memberId, { long_timer_enabled: 0 });
    await insertEntry(memberId, mondayFive - 50 * HOUR, null);

    await runNotificationSweep(env, mondayFive);
    expect(await notificationsFor(memberId)).toEqual([]);
  });

  it("catches up after a missed run but never fires for an ended day", async () => {
    await runNotificationSweep(env, mondayFive + 6 * HOUR + 59 * 60_000);
    expect(await notificationsFor(memberId)).toHaveLength(1);

    await env.DB.prepare("DELETE FROM notifications").run();
    // 00:10 Tuesday: Monday's reminder is gone, Tuesday's is not due until 17:00.
    await runNotificationSweep(env, mondayFive + 7 * HOUR + 10 * 60_000);
    expect(await notificationsFor(memberId)).toEqual([]);
  });

  it("uses the member's timezone and weekdays", async () => {
    await env.DB.prepare("UPDATE members SET timezone = 'Asia/Karachi' WHERE id = ?")
      .bind(memberId)
      .run();

    // 12:00 UTC is 17:00 in Karachi (UTC+5).
    await runNotificationSweep(env, Date.UTC(2026, 9, 26, 11, 55));
    expect(await notificationsFor(memberId)).toEqual([]);
    await runNotificationSweep(env, Date.UTC(2026, 9, 26, 12, 0));
    expect(await notificationsFor(memberId)).toHaveLength(1);

    // Saturday is off by default.
    await runNotificationSweep(env, Date.UTC(2026, 9, 31, 12, 0));
    expect(await notificationsFor(memberId)).toHaveLength(1);
  });

  it("respects a DST change in the member's timezone", async () => {
    await env.DB.prepare("UPDATE members SET timezone = 'Europe/London' WHERE id = ?")
      .bind(memberId)
      .run();
    // London leaves BST on 25 October 2026; on Monday 26th 17:00 local is 17:00 UTC.
    await runNotificationSweep(env, Date.UTC(2026, 9, 26, 16, 0));
    expect(await notificationsFor(memberId)).toEqual([]);
    await runNotificationSweep(env, Date.UTC(2026, 9, 26, 17, 0));
    expect(await notificationsFor(memberId)).toHaveLength(1);
  });

  it("fires at the local reminder time on the day the clocks change", async () => {
    await env.DB.prepare("UPDATE members SET timezone = 'Europe/London' WHERE id = ?")
      .bind(memberId)
      .run();
    // Sunday 29 March 2026: BST starts, so 17:00 local is 16:00 UTC. Sundays must be enabled.
    await setPreferences(memberId, { reminder_weekdays: 127, long_timer_enabled: 0 });
    await runNotificationSweep(env, Date.UTC(2026, 2, 29, 15, 55));
    expect(await notificationsFor(memberId)).toEqual([]);
    await runNotificationSweep(env, Date.UTC(2026, 2, 29, 16, 0));
    expect(await notificationsFor(memberId)).toHaveLength(1);
  });
});

describe("delivery and retention", () => {
  const vapid = {
    VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "",
    VAPID_SUBJECT: "mailto:ops@example.com",
  };

  beforeEach(async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
    ])) as CryptoKeyPair;
    const raw = new Uint8Array(
      (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
    );
    vapid.VAPID_PUBLIC_KEY = btoa(String.fromCharCode(...raw))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    vapid.VAPID_PRIVATE_KEY =
      ((await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey).d ?? "";
    const browser = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const browserKey = new Uint8Array(
      (await crypto.subtle.exportKey("raw", browser.publicKey)) as ArrayBuffer,
    );
    const encode = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
    await env.DB.batch(
      ["https://fcm.googleapis.com/fcm/send/live", "https://fcm.googleapis.com/fcm/send/gone"].map(
        (endpoint) =>
          env.DB.prepare(
            `INSERT INTO push_subscriptions (id, workspace_id, member_id, endpoint, p256dh, auth,
              created_at) VALUES (?, ?, ?, ?, ?, ?, 0)`,
          ).bind(
            crypto.randomUUID(),
            workspaceId,
            memberId,
            endpoint,
            encode(browserKey),
            encode(crypto.getRandomValues(new Uint8Array(16))),
          ),
      ),
    );
    await setPreferences(adminId, { reminder_enabled: 0 });
  });

  it("pushes new notifications and deletes subscriptions the push service dropped", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(new Response(null, { status: url.endsWith("/gone") ? 410 : 201 }));
    });

    const result = await runNotificationSweep({ ...env, ...vapid }, mondayFive);

    expect(result).toMatchObject({ created: 1, pushed: 1, expiredSubscriptions: 1 });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.get("Content-Encoding")).toBe("aes128gcm");
    expect(headers.get("Authorization")).toMatch(/^vapid t=.+, k=/);
    const remaining = await env.DB.prepare("SELECT endpoint FROM push_subscriptions").all();
    expect(remaining.results).toEqual([{ endpoint: "https://fcm.googleapis.com/fcm/send/live" }]);

    // A repeated sweep creates nothing, so it pushes nothing.
    fetchMock.mockClear();
    await runNotificationSweep({ ...env, ...vapid }, mondayFive + 5 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("looks up and deletes subscriptions past D1's 100-parameter limit", async () => {
    const ids = Array.from({ length: 150 }, () => crypto.randomUUID());
    await env.DB.batch(
      ids.flatMap((id, index) => [
        env.DB.prepare(
          `INSERT INTO members (id, workspace_id, email, email_normalized, display_name, role,
            status, timezone, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'Bulk', 'member', 'active', 'UTC', 0, 0)`,
        ).bind(id, workspaceId, `bulk${index}@example.com`, `bulk${index}@example.com`),
        env.DB.prepare(
          `INSERT INTO push_subscriptions (id, workspace_id, member_id, endpoint, p256dh, auth,
            created_at) VALUES (?, ?, ?, ?, 'k', 'a', 0)`,
        ).bind(id, workspaceId, id, `https://fcm.googleapis.com/fcm/send/bulk-${index}`),
      ]),
    );

    expect(await listSubscriptions(env.DB, ids)).toHaveLength(150);
    await deleteSubscriptionsById(env.DB, ids);
    expect(await listSubscriptions(env.DB, ids)).toEqual([]);
  });

  it("does not follow push service redirects", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));
    await runNotificationSweep({ ...env, ...vapid }, mondayFive);
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it("keeps the inbox working without VAPID keys", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await runNotificationSweep(env, mondayFive);
    expect(result).toMatchObject({ created: 1, pushed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prunes notifications older than 30 days", async () => {
    await env.DB.prepare(
      `INSERT INTO notifications (id, workspace_id, member_id, kind, dedupe_key, title, body,
        created_at) VALUES (?, ?, ?, 'test', 'old', 't', 'b', ?), (?, ?, ?, 'test', 'new', 't', 'b', ?)`,
    )
      .bind(
        crypto.randomUUID(),
        workspaceId,
        adminId,
        mondayFive - 31 * 24 * HOUR,
        crypto.randomUUID(),
        workspaceId,
        adminId,
        mondayFive - 29 * 24 * HOUR,
      )
      .run();

    expect((await runNotificationSweep(env, mondayFive)).pruned).toBe(1);
    expect((await notificationsFor(adminId)).map((row) => row.dedupe_key)).toEqual(["new"]);
  });
});

describe("notification API", () => {
  it("returns defaults, saves with optimistic versions, and rejects stale writes", async () => {
    const initial = await apiRequest(
      "/notifications/preferences",
      {},
      env.DB,
      "member@example.com",
    );
    expect(await initial.json()).toEqual({
      preferences: {
        long_timer_enabled: true,
        long_timer_minutes: 480,
        reminder_enabled: true,
        reminder_time_minutes: 1020,
        reminder_threshold_minutes: 240,
        reminder_weekdays: 31,
        version: 0,
      },
      push: { available: false, public_key: null },
    });

    const body = {
      long_timer_enabled: false,
      long_timer_minutes: 360,
      reminder_enabled: true,
      reminder_time_minutes: 960,
      reminder_threshold_minutes: 300,
      reminder_weekdays: 127,
    };
    const saved = await apiRequest(
      "/notifications/preferences",
      { method: "PUT", body: JSON.stringify({ ...body, version: 0 }) },
      env.DB,
      "member@example.com",
    );
    expect(saved.status).toBe(200);
    expect((await saved.json<{ preferences: unknown }>()).preferences).toEqual({
      ...body,
      version: 1,
    });

    const stale = await apiRequest(
      "/notifications/preferences",
      { method: "PUT", body: JSON.stringify({ ...body, version: 0 }) },
      env.DB,
      "member@example.com",
    );
    expect(stale.status).toBe(409);

    const invalid = await apiRequest(
      "/notifications/preferences",
      { method: "PUT", body: JSON.stringify({ ...body, long_timer_minutes: 30, version: 1 }) },
      env.DB,
      "member@example.com",
    );
    expect(invalid.status).toBe(422);
  });

  it("lists, counts, and marks only the caller's notifications", async () => {
    vi.spyOn(Date, "now").mockReturnValue(mondayFive);
    const test = await apiRequest(
      "/notifications/test",
      { method: "POST" },
      env.DB,
      "member@example.com",
    );
    expect(test.status).toBe(201);
    const again = await apiRequest(
      "/notifications/test",
      { method: "POST" },
      env.DB,
      "member@example.com",
    );
    expect(again.status).toBe(429);

    const timer = await apiRequest("/timer", {}, env.DB, "member@example.com");
    expect(await timer.json()).toMatchObject({ unread_notifications: 1 });
    const adminTimer = await apiRequest("/timer");
    expect(await adminTimer.json()).toMatchObject({ unread_notifications: 0 });

    const list = await apiRequest("/notifications", {}, env.DB, "member@example.com");
    const { notifications } = await list.json<{ notifications: { id: string; read_at: null }[] }>();
    expect(notifications).toEqual([
      expect.objectContaining({ kind: "test", title: "Test notification", read_at: null }),
    ]);

    const id = notifications[0]?.id ?? "";
    // Another member cannot mark it read.
    await apiRequest(`/notifications/${id}/read`, { method: "POST" });
    expect(
      await (await apiRequest("/notifications", {}, env.DB, "member@example.com")).json(),
    ).toMatchObject({ unread_count: 1 });

    const read = await apiRequest(
      `/notifications/${id}/read`,
      { method: "POST" },
      env.DB,
      "member@example.com",
    );
    expect(await read.json()).toEqual({ unread_count: 0 });
  });

  it("marks everything read", async () => {
    await env.DB.prepare(
      `INSERT INTO notifications (id, workspace_id, member_id, kind, dedupe_key, title, body,
        created_at) VALUES (?, ?, ?, 'test', 'a', 't', 'b', 1), (?, ?, ?, 'test', 'b', 't', 'b', 2)`,
    )
      .bind(crypto.randomUUID(), workspaceId, adminId, crypto.randomUUID(), workspaceId, adminId)
      .run();
    const response = await apiRequest("/notifications/read-all", { method: "POST" });
    expect(await response.json()).toEqual({ unread_count: 0 });
    expect(await (await apiRequest("/timer")).json()).toMatchObject({ unread_notifications: 0 });
  });

  it("refuses push subscriptions while VAPID is not configured", async () => {
    const response = await apiRequest("/notifications/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
      }),
    });
    expect(response.status).toBe(503);
  });
});

describe("push subscription API", () => {
  const vapidEnv = {
    VAPID_PUBLIC_KEY:
      "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    VAPID_PRIVATE_KEY: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
    VAPID_SUBJECT: "mailto:ops@example.com",
  };
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
    keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
  };

  // apiRequest spreads the module `env`, so tests patch VAPID onto it and remove it afterwards.
  function request(path: string, init: RequestInit, email?: string) {
    return apiRequest(path, init, env.DB, email);
  }

  it("subscribes, rebinds, unsubscribes, and audits each device change", async () => {
    Object.assign(env, vapidEnv);
    try {
      const prefs = await request("/notifications/preferences", {});
      expect(await prefs.json()).toMatchObject({
        push: { available: true, public_key: vapidEnv.VAPID_PUBLIC_KEY },
      });

      const created = await request("/notifications/subscriptions", {
        method: "POST",
        body: JSON.stringify(subscription),
      });
      expect(created.status).toBe(201);

      const rebound = await request(
        "/notifications/subscriptions",
        { method: "POST", body: JSON.stringify(subscription) },
        "member@example.com",
      );
      expect(rebound.status).toBe(200);
      const owner = await env.DB.prepare("SELECT member_id FROM push_subscriptions").first();
      expect(owner).toEqual({ member_id: memberId });

      // The previous owner cannot remove the member's device.
      await request("/notifications/subscriptions", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").first()).toEqual({
        n: 1,
      });

      expect(
        await (
          await request("/notifications/subscriptions/status", {
            method: "POST",
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          })
        ).json(),
      ).toEqual({ subscribed: false });
      expect(
        await (
          await request(
            "/notifications/subscriptions/status",
            { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) },
            "member@example.com",
          )
        ).json(),
      ).toEqual({ subscribed: true });

      const removed = await request(
        "/notifications/subscriptions",
        { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) },
        "member@example.com",
      );
      expect(removed.status).toBe(204);

      const audit = await env.DB.prepare(
        "SELECT action, after_json FROM audit_logs WHERE target_type = 'push_subscription' ORDER BY rowid",
      ).all<{ action: string; after_json: string | null }>();
      expect(audit.results.map((row) => row.action)).toEqual([
        "notification.push_subscribed",
        "notification.push_subscribed",
        "notification.push_unsubscribed",
      ]);
      expect(audit.results.some((row) => row.after_json?.includes("device-1"))).toBe(false);
    } finally {
      for (const key of Object.keys(vapidEnv)) Reflect.deleteProperty(env, key);
    }
  });

  it("rejects endpoints outside the browser push services", async () => {
    Object.assign(env, vapidEnv);
    try {
      const response = await request("/notifications/subscriptions", {
        method: "POST",
        body: JSON.stringify({ ...subscription, endpoint: "https://example.com/hook" }),
      });
      expect(response.status).toBe(422);
    } finally {
      for (const key of Object.keys(vapidEnv)) Reflect.deleteProperty(env, key);
    }
  });
});
