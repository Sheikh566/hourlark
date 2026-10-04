import { describe, expect, it } from "vitest";

import {
  compareStartedAtDesc,
  groupSessionsByDay,
  latestSession,
  sessionGroupBounds,
  sessionGroupDuration,
  sessionMatchKey,
} from "@/web/features/timer/session-groups";
import type { Tag, TimeEntry } from "@/web/types";

const timezone = "Asia/Karachi";

function tag(id: string, name = id): Tag {
  return { id, name, color: "#21de47", status: "active" };
}

function entry(overrides: Partial<TimeEntry> & Pick<TimeEntry, "id">): TimeEntry {
  return {
    member: { id: "member-1", name: "Member" },
    project: null,
    client: null,
    description: "Shared work",
    tags: [],
    started_at: "2026-10-04T04:00:00.000Z",
    stopped_at: "2026-10-04T05:00:00.000Z",
    duration_ms: 3_600_000,
    running: false,
    billable: false,
    deleted_at: null,
    created_at: "2026-10-04T05:00:00.000Z",
    updated_at: "2026-10-04T05:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("session grouping keys", () => {
  it("matches member, exact description, project including null, billable, and sorted tag IDs", () => {
    const left = entry({
      id: "a",
      tags: [tag("tag-b"), tag("tag-a")],
    });
    const right = entry({
      id: "b",
      started_at: "2026-10-04T06:00:00.250Z",
      stopped_at: "2026-10-04T06:30:00.000Z",
      tags: [tag("tag-a"), tag("tag-b")],
    });
    expect(sessionMatchKey(left)).toBe(sessionMatchKey(right));
  });

  it("does not match different billable, tags, projects, descriptions, or members", () => {
    const base = entry({ id: "base" });
    expect(sessionMatchKey(entry({ id: "billable", billable: true }))).not.toBe(
      sessionMatchKey(base),
    );
    expect(sessionMatchKey(entry({ id: "tags", tags: [tag("other")] }))).not.toBe(
      sessionMatchKey(base),
    );
    expect(
      sessionMatchKey(
        entry({
          id: "project",
          project: { id: "project-1", name: "Ops", color: "#21de47" },
        }),
      ),
    ).not.toBe(sessionMatchKey(base));
    expect(sessionMatchKey(entry({ id: "desc", description: "Other" }))).not.toBe(
      sessionMatchKey(base),
    );
    expect(
      sessionMatchKey(entry({ id: "member", member: { id: "member-2", name: "Other" } })),
    ).not.toBe(sessionMatchKey(base));
  });
});

describe("session grouping days and timezone", () => {
  it("groups within the viewer timezone local date and keeps other days distinct", () => {
    const sameLocalDay = entry({
      id: "late-utc",
      started_at: "2026-10-03T20:00:00.000Z",
      stopped_at: "2026-10-03T21:00:00.000Z",
    });
    const nextLocalDay = entry({
      id: "next-day",
      started_at: "2026-10-04T19:00:00.100Z",
      stopped_at: "2026-10-04T20:00:00.000Z",
    });
    const previousLocalDay = entry({
      id: "previous-day",
      started_at: "2026-10-03T18:00:00.000Z",
      stopped_at: "2026-10-03T18:30:00.000Z",
    });

    const days = groupSessionsByDay(
      [entry({ id: "today" }), sameLocalDay, nextLocalDay, previousLocalDay],
      timezone,
    );
    expect(days.map((item) => item.day)).toEqual(["2026-10-05", "2026-10-04", "2026-10-03"]);
    const today = days.find((item) => item.day === "2026-10-04");
    expect(today?.groups).toHaveLength(1);
    expect(today?.groups[0]?.entries.map((item) => item.id).sort()).toEqual(["late-utc", "today"]);
    expect(days.find((item) => item.day === "2026-10-03")?.groups[0]?.entries).toHaveLength(1);
    expect(days.find((item) => item.day === "2026-10-05")?.groups[0]?.entries).toHaveLength(1);
  });

  it("includes running sessions, sorts groups by newest started_at, and preserves fractional seconds", () => {
    const older = entry({
      id: "older",
      started_at: "2026-10-04T04:00:00.100Z",
      stopped_at: "2026-10-04T05:00:00.000Z",
    });
    const running = entry({
      id: "running",
      started_at: "2026-10-04T06:00:00.900Z",
      stopped_at: null,
      duration_ms: 0,
      running: true,
      description: "Other",
    });
    const newerMatch = entry({
      id: "newer",
      started_at: "2026-10-04T06:00:00.400Z",
      stopped_at: "2026-10-04T07:00:00.000Z",
    });

    const [day] = groupSessionsByDay([older, running, newerMatch], timezone);
    expect(day?.groups.map((group) => group.entries[0]?.id)).toEqual(["running", "newer"]);
    expect(day?.groups[1]?.entries.map((item) => item.id)).toEqual(["newer", "older"]);
    expect(compareStartedAtDesc(newerMatch, older)).toBeLessThan(0);
    expect(latestSession([older, newerMatch])?.id).toBe("newer");
  });
});

describe("session group live durations", () => {
  it("sums session durations instead of using the elapsed span", () => {
    const morning = entry({
      id: "morning",
      started_at: "2026-10-04T04:00:00.000Z",
      stopped_at: "2026-10-04T05:00:00.000Z",
      duration_ms: 3_600_000,
    });
    const running = entry({
      id: "running",
      started_at: "2026-10-04T11:30:00.000Z",
      stopped_at: null,
      duration_ms: 0,
      running: true,
    });
    const now = Date.parse("2026-10-04T12:00:00.000Z");
    expect(sessionGroupDuration([morning, running], now)).toBe(5_400_000);
    expect(sessionGroupBounds([morning, running])).toEqual({
      startedAt: "2026-10-04T04:00:00.000Z",
      stoppedAt: null,
      running: true,
    });
  });
});
