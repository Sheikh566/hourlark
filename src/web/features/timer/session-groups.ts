import { formatInTimeZone } from "date-fns-tz";

import type { TimeEntry } from "@/web/types";

export interface SessionGroup {
  key: string;
  day: string;
  entries: TimeEntry[];
}

export function sessionMatchKey(entry: TimeEntry): string {
  const tagIds = [...entry.tags.map((tag) => tag.id)].sort();
  return JSON.stringify([
    entry.member.id,
    entry.description,
    entry.project?.id ?? "",
    entry.billable ? "1" : "0",
    tagIds,
  ]);
}

export function localEntryDay(startedAt: string, timezone: string): string {
  return formatInTimeZone(startedAt, timezone, "yyyy-MM-dd");
}

export function compareStartedAtDesc(left: TimeEntry, right: TimeEntry): number {
  const byStart = Date.parse(right.started_at) - Date.parse(left.started_at);
  if (byStart !== 0) return byStart;
  return right.id.localeCompare(left.id);
}

export function sessionGroupDuration(entries: TimeEntry[], now: number): number {
  return entries.reduce((sum, entry) => {
    if (entry.running) return sum + Math.max(0, now - Date.parse(entry.started_at));
    return sum + entry.duration_ms;
  }, 0);
}

export function sessionGroupBounds(entries: TimeEntry[]): {
  startedAt: string;
  stoppedAt: string | null;
  running: boolean;
} {
  const first = entries[0];
  if (!first) return { startedAt: "", stoppedAt: null, running: false };

  let earliestStartedAt = first.started_at;
  let latestStoppedAt: string | null = first.running ? null : first.stopped_at;
  let running = first.running;

  for (const entry of entries.slice(1)) {
    if (Date.parse(entry.started_at) < Date.parse(earliestStartedAt)) {
      earliestStartedAt = entry.started_at;
    }
    running ||= entry.running;
    if (!entry.running && entry.stopped_at) {
      if (!latestStoppedAt || Date.parse(entry.stopped_at) > Date.parse(latestStoppedAt)) {
        latestStoppedAt = entry.stopped_at;
      }
    }
  }

  return {
    startedAt: earliestStartedAt,
    stoppedAt: running ? null : latestStoppedAt,
    running,
  };
}

export function latestSession(entries: TimeEntry[]): TimeEntry | undefined {
  return [...entries].sort(compareStartedAtDesc)[0];
}

export function groupSessionsByDay(
  entries: TimeEntry[],
  timezone: string,
): Array<{ day: string; groups: SessionGroup[] }> {
  const byDay = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const day = localEntryDay(entry.started_at, timezone);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(entry);
    else byDay.set(day, [entry]);
  }

  return [...byDay.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([day, dayEntries]) => {
      const byKey = new Map<string, TimeEntry[]>();
      for (const entry of dayEntries) {
        const match = sessionMatchKey(entry);
        const bucket = byKey.get(match);
        if (bucket) bucket.push(entry);
        else byKey.set(match, [entry]);
      }
      const groups = [...byKey.values()]
        .flatMap((groupEntries) => {
          const first = groupEntries[0];
          if (!first) return [];
          return [
            {
              key: `${day}\u0000${sessionMatchKey(first)}`,
              day,
              entries: [...groupEntries].sort(compareStartedAtDesc),
            },
          ];
        })
        .sort((left, right) => {
          const leftNewest = left.entries[0];
          const rightNewest = right.entries[0];
          if (!leftNewest || !rightNewest) return 0;
          const newest = compareStartedAtDesc(leftNewest, rightNewest);
          if (newest !== 0) return newest;
          return left.key.localeCompare(right.key);
        });
      return { day, groups };
    });
}
