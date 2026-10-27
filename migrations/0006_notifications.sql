-- Basic notifications: a long-running timer warning and a daily tracking reminder, evaluated by
-- the scheduled handler. Members without a preferences row use the defaults in
-- src/domain/notifications/schedule.ts, so existing members need no backfill.
CREATE TABLE notification_preferences (
  member_id TEXT PRIMARY KEY REFERENCES members(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  long_timer_enabled INTEGER NOT NULL CHECK (long_timer_enabled IN (0, 1)),
  long_timer_minutes INTEGER NOT NULL CHECK (long_timer_minutes BETWEEN 60 AND 1440),
  reminder_enabled INTEGER NOT NULL CHECK (reminder_enabled IN (0, 1)),
  -- Minutes after local midnight in the member's timezone.
  reminder_time_minutes INTEGER NOT NULL CHECK (reminder_time_minutes BETWEEN 0 AND 1439),
  reminder_threshold_minutes INTEGER NOT NULL CHECK (reminder_threshold_minutes BETWEEN 15 AND 1440),
  -- Bit 0 is Monday through bit 6 for Sunday.
  reminder_weekdays INTEGER NOT NULL CHECK (reminder_weekdays BETWEEN 0 AND 127),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL CHECK (kind IN ('long_running_timer', 'tracking_reminder', 'test')),
  -- The running entry ID, the member's local date, or the minute of a test send. Makes retried
  -- or overlapping sweeps idempotent.
  dedupe_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  UNIQUE (member_id, kind, dedupe_key)
);

CREATE INDEX notifications_member_created ON notifications(member_id, created_at DESC);
CREATE INDEX notifications_member_unread ON notifications(member_id) WHERE read_at IS NULL;
CREATE INDEX notifications_created ON notifications(created_at);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX push_subscriptions_member ON push_subscriptions(member_id);
