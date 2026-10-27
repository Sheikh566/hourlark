import {
  defaultNotificationPreferences,
  type NotificationKind,
  type NotificationPreferences,
} from "@/domain/notifications/schedule";

export interface NotificationPreferencesRow {
  long_timer_enabled: number;
  long_timer_minutes: number;
  reminder_enabled: number;
  reminder_time_minutes: number;
  reminder_threshold_minutes: number;
  reminder_weekdays: number;
  version: number;
}

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  created_at: number;
  read_at: number | null;
}

export interface PushSubscriptionRow {
  id: string;
  member_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface NewNotification {
  workspaceId: string;
  memberId: string;
  kind: NotificationKind;
  dedupeKey: string;
  title: string;
  body: string;
}

const preferenceColumns = `long_timer_enabled, long_timer_minutes, reminder_enabled,
  reminder_time_minutes, reminder_threshold_minutes, reminder_weekdays`;

export function toPreferences(row: NotificationPreferencesRow | null): NotificationPreferences {
  if (!row) return { ...defaultNotificationPreferences };
  return {
    long_timer_enabled: row.long_timer_enabled === 1,
    long_timer_minutes: row.long_timer_minutes,
    reminder_enabled: row.reminder_enabled === 1,
    reminder_time_minutes: row.reminder_time_minutes,
    reminder_threshold_minutes: row.reminder_threshold_minutes,
    reminder_weekdays: row.reminder_weekdays,
  };
}

/** Returns the stored preferences, or the defaults with version 0 when none are stored. */
export async function loadPreferences(
  db: D1Database,
  memberId: string,
): Promise<{ preferences: NotificationPreferences; version: number }> {
  const row = await db
    .prepare(
      `SELECT ${preferenceColumns}, version FROM notification_preferences WHERE member_id = ?`,
    )
    .bind(memberId)
    .first<NotificationPreferencesRow>();
  return { preferences: toPreferences(row), version: row?.version ?? 0 };
}

/**
 * Writes preferences when `expectedVersion` matches (0 inserts the first row). Returns false on a
 * concurrent change.
 */
export async function savePreferences(
  db: D1Database,
  workspaceId: string,
  memberId: string,
  preferences: NotificationPreferences,
  expectedVersion: number,
  now = Date.now(),
): Promise<boolean> {
  const values = [
    preferences.long_timer_enabled ? 1 : 0,
    preferences.long_timer_minutes,
    preferences.reminder_enabled ? 1 : 0,
    preferences.reminder_time_minutes,
    preferences.reminder_threshold_minutes,
    preferences.reminder_weekdays,
  ];
  const result =
    expectedVersion === 0
      ? await db
          .prepare(
            `INSERT INTO notification_preferences (member_id, workspace_id, ${preferenceColumns},
              created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (member_id) DO NOTHING`,
          )
          .bind(memberId, workspaceId, ...values, now, now)
          .run()
      : await db
          .prepare(
            `UPDATE notification_preferences SET long_timer_enabled = ?, long_timer_minutes = ?,
              reminder_enabled = ?, reminder_time_minutes = ?, reminder_threshold_minutes = ?,
              reminder_weekdays = ?, updated_at = ?, version = version + 1
             WHERE member_id = ? AND version = ?`,
          )
          .bind(...values, now, memberId, expectedVersion)
          .run();
  return result.meta.changes === 1;
}

export async function countUnread(db: D1Database, memberId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS unread FROM notifications WHERE member_id = ? AND read_at IS NULL")
    .bind(memberId)
    .first<{ unread: number }>();
  return row?.unread ?? 0;
}

export async function listNotifications(
  db: D1Database,
  memberId: string,
  limit = 50,
): Promise<NotificationRow[]> {
  const result = await db
    .prepare(
      `SELECT id, kind, title, body, created_at, read_at FROM notifications
       WHERE member_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(memberId, limit)
    .all<NotificationRow>();
  return result.results;
}

/** Marks one notification (or all when `id` is null) read; returns how many changed. */
export async function markRead(
  db: D1Database,
  memberId: string,
  id: string | null,
  now = Date.now(),
): Promise<number> {
  const statement = id
    ? db
        .prepare(
          "UPDATE notifications SET read_at = ? WHERE member_id = ? AND id = ? AND read_at IS NULL",
        )
        .bind(now, memberId, id)
    : db
        .prepare("UPDATE notifications SET read_at = ? WHERE member_id = ? AND read_at IS NULL")
        .bind(now, memberId);
  return (await statement.run()).meta.changes;
}

function insertNotificationStatement(
  db: D1Database,
  notification: NewNotification,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO notifications (id, workspace_id, member_id, kind, dedupe_key, title, body,
        created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (member_id, kind, dedupe_key) DO NOTHING
       RETURNING id`,
    )
    .bind(
      crypto.randomUUID(),
      notification.workspaceId,
      notification.memberId,
      notification.kind,
      notification.dedupeKey,
      notification.title,
      notification.body,
      now,
    );
}

/**
 * Inserts notifications, skipping any whose dedupe key already exists, and returns only the ones
 * created by this call so a retried sweep never notifies twice.
 */
export async function insertNotifications(
  db: D1Database,
  notifications: NewNotification[],
  now = Date.now(),
): Promise<NewNotification[]> {
  if (notifications.length === 0) return [];
  const results = await db.batch<{ id: string }>(
    notifications.map((notification) => insertNotificationStatement(db, notification, now)),
  );
  return notifications.filter((_, index) => (results[index]?.results.length ?? 0) > 0);
}

export async function pruneNotifications(db: D1Database, before: number): Promise<number> {
  const result = await db
    .prepare("DELETE FROM notifications WHERE created_at < ?")
    .bind(before)
    .run();
  return result.meta.changes;
}

/** D1 binds at most 100 parameters per query, so `IN (...)` lists are split into chunks. */
const MAX_BOUND_PARAMETERS = 100;

function chunks<T>(values: T[]): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += MAX_BOUND_PARAMETERS) {
    output.push(values.slice(index, index + MAX_BOUND_PARAMETERS));
  }
  return output;
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}

export async function listSubscriptions(
  db: D1Database,
  memberIds: string[],
): Promise<PushSubscriptionRow[]> {
  if (memberIds.length === 0) return [];
  const results = await db.batch<PushSubscriptionRow>(
    chunks(memberIds).map((chunk) =>
      db
        .prepare(
          `SELECT id, member_id, endpoint, p256dh, auth FROM push_subscriptions
           WHERE member_id IN (${placeholders(chunk)})`,
        )
        .bind(...chunk),
    ),
  );
  return results.flatMap((result) => result.results);
}

export async function deleteSubscriptionsById(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(
    chunks(ids).map((chunk) =>
      db
        .prepare(`DELETE FROM push_subscriptions WHERE id IN (${placeholders(chunk)})`)
        .bind(...chunk),
    ),
  );
}

export async function findSubscriptionByEndpoint(
  db: D1Database,
  endpoint: string,
): Promise<PushSubscriptionRow | null> {
  return db
    .prepare(
      "SELECT id, member_id, endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = ?",
    )
    .bind(endpoint)
    .first<PushSubscriptionRow>();
}

export interface SweepMemberRow extends Partial<NotificationPreferencesRow> {
  id: string;
  workspace_id: string;
  timezone: string;
  has_preferences: number;
}

export async function listSweepMembers(db: D1Database): Promise<SweepMemberRow[]> {
  const result = await db
    .prepare(
      `SELECT m.id, m.workspace_id, m.timezone, p.member_id IS NOT NULL AS has_preferences,
        p.long_timer_enabled, p.long_timer_minutes, p.reminder_enabled, p.reminder_time_minutes,
        p.reminder_threshold_minutes, p.reminder_weekdays
       FROM members m
       LEFT JOIN notification_preferences p ON p.member_id = m.id
       WHERE m.status = 'active'`,
    )
    .all<SweepMemberRow>();
  return result.results;
}

export async function listRunningTimers(
  db: D1Database,
): Promise<{ id: string; member_id: string; started_at: number }[]> {
  // Served by the partial one_running_timer_per_member index.
  const result = await db
    .prepare(
      `SELECT id, member_id, started_at FROM time_entries
       WHERE stopped_at IS NULL AND deleted_at IS NULL`,
    )
    .all<{ id: string; member_id: string; started_at: number }>();
  return result.results;
}

/** Longest stopped entry the reminder looks back for when it started before local midnight. */
export const REMINDER_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export interface ReminderCheck {
  workspaceId: string;
  memberId: string;
  date: string;
  dayStart: number;
}

/**
 * For each member, whether today's reminder was already sent and how much time they tracked from
 * local midnight until `now` (running time included). The `started_at` lower bound keeps the read
 * on the member's recent rows; a running timer older than that is added by the caller.
 */
export async function loadReminderState(
  db: D1Database,
  checks: ReminderCheck[],
  now: number,
): Promise<{ sent: boolean; trackedMs: number }[]> {
  if (checks.length === 0) return [];
  const statements = checks.flatMap((check) => [
    db
      .prepare(
        `SELECT 1 AS sent FROM notifications
         WHERE member_id = ? AND kind = 'tracking_reminder' AND dedupe_key = ?`,
      )
      .bind(check.memberId, check.date),
    db
      .prepare(
        `SELECT COALESCE(SUM(MIN(COALESCE(stopped_at, ?1), ?1) - MAX(started_at, ?2)), 0)
           AS tracked
         FROM time_entries
         WHERE workspace_id = ?3 AND member_id = ?4 AND deleted_at IS NULL
           AND started_at >= ?5 AND started_at < ?1
           AND (stopped_at IS NULL OR stopped_at > ?2)`,
      )
      .bind(
        now,
        check.dayStart,
        check.workspaceId,
        check.memberId,
        check.dayStart - REMINDER_LOOKBACK_MS,
      ),
  ]);
  const results = await db.batch<{ sent?: number; tracked?: number }>(statements);
  return checks.map((_, index) => ({
    sent: (results[index * 2]?.results.length ?? 0) > 0,
    trackedMs: Math.max(0, results[index * 2 + 1]?.results[0]?.tracked ?? 0),
  }));
}
