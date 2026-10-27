import {
  deleteSubscriptionsById,
  insertNotifications,
  listRunningTimers,
  listSubscriptions,
  listSweepMembers,
  loadReminderState,
  pruneNotifications,
  REMINDER_LOOKBACK_MS,
  toPreferences,
  type NewNotification,
  type NotificationPreferencesRow,
  type ReminderCheck,
} from "@/db/repositories/notifications";
import { overlapDuration } from "@/domain/dates/time";
import {
  isLongRunning,
  isReminderDue,
  localDay,
  longRunningMessage,
  NOTIFICATION_RETENTION_MS,
  trackingReminderMessage,
} from "@/domain/notifications/schedule";
import { vapidKeys } from "@/worker/env";
import { sendPush } from "@/worker/services/web-push";

export interface SweepResult {
  created: number;
  pushed: number;
  expiredSubscriptions: number;
  pruned: number;
}

/**
 * Sends each new notification to every device the member subscribed. Push services answer 404 or
 * 410 for subscriptions the browser dropped; those rows are deleted.
 */
export async function deliverPushes(
  env: Env,
  notifications: NewNotification[],
): Promise<{ pushed: number; expired: number }> {
  const keys = vapidKeys(env);
  if (!keys || notifications.length === 0) return { pushed: 0, expired: 0 };
  const subscriptions = await listSubscriptions(env.DB, [
    ...new Set(notifications.map((notification) => notification.memberId)),
  ]);
  const sends = notifications.flatMap((notification) =>
    subscriptions
      .filter((subscription) => subscription.member_id === notification.memberId)
      .map((subscription) => ({ notification, subscription })),
  );
  const outcomes = await Promise.allSettled(
    sends.map(({ notification, subscription }) =>
      sendPush(
        subscription,
        { title: notification.title, body: notification.body, tag: notification.kind },
        keys,
      ),
    ),
  );
  const expired = new Set<string>();
  let pushed = 0;
  sends.forEach(({ subscription }, index) => {
    const outcome = outcomes[index];
    if (!outcome) return;
    if (outcome.status === "rejected") {
      console.warn("push_send_failed", { subscription: subscription.id });
      return;
    }
    if (outcome.value === 404 || outcome.value === 410) expired.add(subscription.id);
    else if (outcome.value >= 200 && outcome.value < 300) pushed += 1;
    else
      console.warn("push_send_rejected", { subscription: subscription.id, status: outcome.value });
  });
  await deleteSubscriptionsById(env.DB, [...expired]);
  return { pushed, expired: expired.size };
}

/** One scheduled run: evaluate both notification rules for every active member. */
export async function runNotificationSweep(env: Env, now = Date.now()): Promise<SweepResult> {
  const [members, running] = await Promise.all([
    listSweepMembers(env.DB),
    listRunningTimers(env.DB),
  ]);
  const runningByMember = new Map(running.map((entry) => [entry.member_id, entry]));
  const candidates: NewNotification[] = [];
  const checks: (ReminderCheck & { threshold: number; runningOverlap: number })[] = [];

  for (const member of members) {
    const preferences = toPreferences(
      member.has_preferences ? (member as NotificationPreferencesRow) : null,
    );
    const timer = runningByMember.get(member.id);
    if (timer && isLongRunning(preferences, timer.started_at, now)) {
      candidates.push({
        workspaceId: member.workspace_id,
        memberId: member.id,
        kind: "long_running_timer",
        dedupeKey: timer.id,
        ...longRunningMessage(now - timer.started_at),
      });
    }

    let day;
    try {
      day = localDay(now, member.timezone);
    } catch {
      continue;
    }
    if (!isReminderDue(preferences, day)) continue;
    // A timer started before the query's look-back window still counts toward today.
    const runningOverlap =
      timer && timer.started_at < day.start - REMINDER_LOOKBACK_MS
        ? overlapDuration(timer.started_at, now, day.start, now)
        : 0;
    checks.push({
      workspaceId: member.workspace_id,
      memberId: member.id,
      date: day.date,
      dayStart: day.start,
      threshold: preferences.reminder_threshold_minutes,
      runningOverlap,
    });
  }

  const states = await loadReminderState(env.DB, checks, now);
  checks.forEach((check, index) => {
    const state = states[index];
    if (!state) return;
    const trackedMs = state.trackedMs + check.runningOverlap;
    if (state.sent || trackedMs >= check.threshold * 60_000) return;
    candidates.push({
      workspaceId: check.workspaceId,
      memberId: check.memberId,
      kind: "tracking_reminder",
      dedupeKey: check.date,
      ...trackingReminderMessage(trackedMs, check.threshold),
    });
  });

  const created = await insertNotifications(env.DB, candidates, now);
  const delivery = await deliverPushes(env, created);
  const pruned = await pruneNotifications(env.DB, now - NOTIFICATION_RETENTION_MS);
  return {
    created: created.length,
    pushed: delivery.pushed,
    expiredSubscriptions: delivery.expired,
    pruned,
  };
}
