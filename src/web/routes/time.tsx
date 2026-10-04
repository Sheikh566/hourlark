import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, addWeeks, getISOWeek, startOfDay, startOfWeek, subDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { Copy, MoreHorizontal, Play, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { useMe } from "@/web/app/context";
import { Badge, Button, EmptyState, ErrorState, Select } from "@/web/components/ui";
import { InlineEntryEditor } from "@/web/features/time/inline-entry-editor";
import { CalendarView } from "@/web/routes/calendar";
import { TimerToolbar, WorkspaceStripe, type TimerView } from "@/web/features/timer/timer-toolbar";
import { TimesheetView } from "@/web/features/timer/timesheet-view";
import { useNow } from "@/web/hooks/use-now";
import { ApiClientError, apiRequest, idempotencyKey } from "@/web/lib/api";
import { formatClockDuration } from "@/web/lib/format";
import { broadcastTimerChange } from "@/web/lib/timer";
import type { Member, Project, Tag, TimeEntry } from "@/web/types";

function parseView(value: string | null): TimerView {
  if (value === "calendar" || value === "timesheet" || value === "list") return value;
  return "list";
}

export function TimePage() {
  const me = useMe();
  const now = useNow();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseView(searchParams.get("view"));
  const [anchor, setAnchor] = useState(new Date());
  const [memberId, setMemberId] = useState(me.member.id);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [undoEntry, setUndoEntry] = useState<TimeEntry | null>(null);
  const [calendarMode, setCalendarMode] = useState<"week" | "day">("week");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const weekStartsOn = me.workspace.week_start === "monday" ? 1 : 0;
  const weekStart = startOfWeek(anchor, { weekStartsOn });
  const listAllDates = view === "list";

  const setView = (next: TimerView) => {
    const params = new URLSearchParams(searchParams);
    if (next === "list") params.delete("view");
    else params.set("view", next);
    setSearchParams(params, { replace: true });
  };

  const listRange = useMemo(() => {
    if (listAllDates) {
      const end = addDays(startOfDay(new Date()), 1);
      const start = subDays(end, 60);
      return {
        start: fromZonedTime(
          formatInTimeZone(start, me.member.timezone, "yyyy-MM-dd'T'00:00:00"),
          me.member.timezone,
        ).toISOString(),
        end: fromZonedTime(
          formatInTimeZone(end, me.member.timezone, "yyyy-MM-dd'T'00:00:00"),
          me.member.timezone,
        ).toISOString(),
      };
    }
    const periodEnd = addDays(weekStart, 7);
    return {
      start: fromZonedTime(
        formatInTimeZone(weekStart, me.member.timezone, "yyyy-MM-dd'T'00:00:00"),
        me.member.timezone,
      ).toISOString(),
      end: fromZonedTime(
        formatInTimeZone(periodEnd, me.member.timezone, "yyyy-MM-dd'T'00:00:00"),
        me.member.timezone,
      ).toISOString(),
    };
  }, [listAllDates, me.member.timezone, weekStart]);

  const weekRange = useMemo(() => {
    const periodEnd = addDays(weekStart, 7);
    return {
      start: fromZonedTime(
        formatInTimeZone(weekStart, me.member.timezone, "yyyy-MM-dd'T'00:00:00"),
        me.member.timezone,
      ).toISOString(),
      end: fromZonedTime(
        formatInTimeZone(periodEnd, me.member.timezone, "yyyy-MM-dd'T'00:00:00"),
        me.member.timezone,
      ).toISOString(),
    };
  }, [me.member.timezone, weekStart]);

  const projects = useQuery({
    queryKey: ["projects", "active"],
    queryFn: () => apiRequest<{ projects: Project[] }>("/projects?status=active"),
  });
  const tags = useQuery({
    queryKey: ["tags", "active"],
    queryFn: () => apiRequest<{ tags: Tag[] }>("/tags?status=active"),
  });
  const members = useQuery({
    queryKey: ["members"],
    queryFn: () => apiRequest<{ members: Member[] }>("/members"),
    enabled: me.permissions.view_team,
  });
  const entries = useQuery({
    queryKey: ["time-entries", "timer-list", listRange, memberId],
    queryFn: () => {
      const params = new URLSearchParams({
        start: listRange.start,
        end: listRange.end,
        ...(me.permissions.view_team ? { member_id: memberId } : {}),
      });
      return apiRequest<{ entries: TimeEntry[]; generated_at: string }>(`/time-entries?${params}`);
    },
    enabled: view === "list",
  });
  const weekEntries = useQuery({
    queryKey: ["time-entries", "timer-week", weekRange, memberId],
    queryFn: () => {
      const params = new URLSearchParams({
        start: weekRange.start,
        end: weekRange.end,
        ...(me.permissions.view_team ? { member_id: memberId } : {}),
      });
      return apiRequest<{ entries: TimeEntry[] }>(`/time-entries?${params}`);
    },
  });

  const durationFor = (entry: TimeEntry) =>
    entry.running ? Math.max(0, now - new Date(entry.started_at).getTime()) : entry.duration_ms;

  const todayKey = formatInTimeZone(new Date(), me.member.timezone, "yyyy-MM-dd");
  const todayTotal = (weekEntries.data?.entries ?? [])
    .filter(
      (entry) => formatInTimeZone(entry.started_at, me.member.timezone, "yyyy-MM-dd") === todayKey,
    )
    .reduce((sum, entry) => sum + durationFor(entry), 0);
  const weekTotal = (weekEntries.data?.entries ?? []).reduce(
    (sum, entry) => sum + durationFor(entry),
    0,
  );

  const deleteMutation = useMutation({
    mutationFn: async (entry: TimeEntry) => {
      try {
        return await apiRequest(`/time-entries/${entry.id}`, { method: "DELETE" });
      } catch (error) {
        if (error instanceof ApiClientError && error.code === "override_reason_required") {
          const reason = window.prompt("This entry is locked. Enter an audit reason to override:");
          if (reason?.trim()) {
            return apiRequest(
              `/time-entries/${entry.id}?override_reason=${encodeURIComponent(reason.trim())}`,
              { method: "DELETE" },
            );
          }
        }
        throw error;
      }
    },
    onSuccess: async (_, entry) => {
      setUndoEntry(entry);
      await queryClient.invalidateQueries({ queryKey: ["time-entries"] });
    },
  });
  const restoreMutation = useMutation({
    mutationFn: async (entry: TimeEntry) => {
      try {
        return await apiRequest(`/time-entries/${entry.id}/restore`, {
          method: "POST",
          body: "{}",
        });
      } catch (error) {
        if (error instanceof ApiClientError && error.code === "override_reason_required") {
          const reason = window.prompt("This entry is locked. Enter an audit reason to override:");
          if (reason?.trim()) {
            return apiRequest(
              `/time-entries/${entry.id}/restore?override_reason=${encodeURIComponent(reason.trim())}`,
              { method: "POST", body: "{}" },
            );
          }
        }
        throw error;
      }
    },
    onSuccess: async () => {
      setUndoEntry(null);
      await queryClient.invalidateQueries({ queryKey: ["time-entries"] });
    },
  });
  const continueMutation = useMutation({
    mutationFn: (entry: TimeEntry) =>
      apiRequest(`/time-entries/${entry.id}/continue`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: "{}",
      }),
    onSuccess: async () => {
      broadcastTimerChange();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["timer"] }),
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
      ]);
    },
  });
  const duplicateMutation = useMutation({
    mutationFn: (entry: TimeEntry) =>
      apiRequest<{ entry: TimeEntry }>("/time-entries", {
        method: "POST",
        body: JSON.stringify({
          ...(me.permissions.view_team ? { member_id: entry.member.id } : {}),
          description: entry.description,
          project_id: entry.project?.id ?? null,
          tag_ids: entry.tags.map((tag) => tag.id),
          started_at: entry.started_at,
          stopped_at: entry.stopped_at ?? new Date().toISOString(),
          billable: entry.billable,
        }),
      }),
    onSuccess: async ({ entry }) => {
      await queryClient.invalidateQueries({ queryKey: ["time-entries"] });
      setEditingEntryId(entry.id);
    },
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, TimeEntry[]>();
    for (const entry of entries.data?.entries ?? []) {
      const day = formatInTimeZone(entry.started_at, me.member.timezone, "yyyy-MM-dd");
      groups.set(day, [...(groups.get(day) ?? []), entry]);
    }
    return [...groups.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [entries.data, me.member.timezone]);

  const periodLabel = view === "list" ? "All dates" : `This week · W${getISOWeek(weekStart)}`;

  const onPrevious = () => {
    if (view === "list") return;
    setAnchor(addWeeks(anchor, -1));
  };
  const onNext = () => {
    if (view === "list") return;
    setAnchor(addWeeks(anchor, 1));
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <h1 className="sr-only">Timer</h1>
      <TimerToolbar
        view={view}
        onViewChange={setView}
        periodLabel={periodLabel}
        onPrevious={onPrevious}
        onNext={onNext}
        onPeriodClick={() => setAnchor(new Date())}
        previousDisabled={view === "list"}
        nextDisabled={view === "list"}
        showTodayTotal={view === "list"}
        todayTotal={formatClockDuration(todayTotal)}
        weekTotal={formatClockDuration(weekTotal)}
        trailing={
          <>
            {view === "calendar" ? (
              <Select
                className="h-8 min-h-8 w-28 text-xs"
                value={calendarMode}
                onChange={(event) => setCalendarMode(event.target.value as "week" | "day")}
                aria-label="Calendar density"
              >
                <option value="week">Week view</option>
                <option value="day">Day view</option>
              </Select>
            ) : null}
            {me.permissions.view_team ? (
              <Select
                className="h-8 min-h-8 min-w-40 text-xs"
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
                aria-label="Timer member"
              >
                {(members.data?.members ?? []).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.display_name}
                  </option>
                ))}
              </Select>
            ) : null}
          </>
        }
      />
      <WorkspaceStripe label={me.workspace.company_name} />

      {view === "calendar" ? (
        <CalendarView weekStart={weekStart} memberId={memberId} calendarMode={calendarMode} />
      ) : null}
      {view === "timesheet" ? <TimesheetView weekStart={weekStart} memberId={memberId} /> : null}
      {view === "list" ? (
        <section className="min-h-[calc(100vh-210px)] bg-[#141a13]">
          {entries.isLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-14 animate-pulse rounded-md bg-white/5" />
              ))}
            </div>
          ) : entries.error ? (
            <div className="p-4">
              <ErrorState message={entries.error.message} onRetry={() => void entries.refetch()} />
            </div>
          ) : grouped.length === 0 ? (
            <EmptyState
              title="No time recorded yet"
              description="Start the timer above, or switch to Calendar and drag a time range."
            />
          ) : (
            grouped.map(([day, dayEntries]) => {
              const dayTotal = dayEntries.reduce((sum, entry) => sum + durationFor(entry), 0);
              const isToday = day === todayKey;
              const allSelected = dayEntries.every((entry) => selectedIds.has(entry.id));
              return (
                <section key={day} aria-labelledby={`day-${day}`}>
                  <div className="flex items-center gap-3 border-y border-white/8 bg-[#111710] px-4 py-2.5 md:px-5">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => {
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          if (allSelected) dayEntries.forEach((entry) => next.delete(entry.id));
                          else dayEntries.forEach((entry) => next.add(entry.id));
                          return next;
                        });
                      }}
                      aria-label={`Select all entries for ${day}`}
                    />
                    <h2 id={`day-${day}`} className="flex-1 text-sm font-bold text-slate-200">
                      {isToday
                        ? "Today"
                        : formatInTimeZone(`${day}T12:00:00Z`, me.member.timezone, "EEEE, MMMM d")}
                    </h2>
                    <span className="font-mono text-sm font-semibold text-slate-300">
                      {formatClockDuration(dayTotal)}
                    </span>
                  </div>
                  {dayEntries.map((entry) =>
                    editingEntryId === entry.id ? (
                      <InlineEntryEditor
                        key={entry.id}
                        entry={entry}
                        projects={projects.data?.projects ?? []}
                        tags={tags.data?.tags ?? []}
                        onCancel={() => setEditingEntryId(null)}
                        onSaved={() => setEditingEntryId(null)}
                      />
                    ) : (
                      <article
                        key={entry.id}
                        className={`group grid min-h-[56px] items-center gap-2 border-b border-white/7 px-4 py-2 transition hover:bg-white/[0.035] md:grid-cols-[auto_minmax(260px,1fr)_minmax(70px,auto)_minmax(150px,auto)_auto] md:px-5 ${
                          entry.running ? "bg-frosted-mint-950/30" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(entry.id)}
                          onChange={() => toggleSelected(entry.id)}
                          aria-label={`Select ${entry.description || "time entry"}`}
                        />
                        <div className="flex min-w-0 items-center gap-4">
                          <button
                            type="button"
                            className={`max-w-[55%] min-w-0 shrink truncate rounded-sm text-left text-sm ${
                              entry.description
                                ? "hover:text-frosted-mint-300 font-semibold text-slate-100"
                                : "text-slate-500 hover:text-slate-300"
                            }`}
                            onClick={() => setEditingEntryId(entry.id)}
                            title="Edit description"
                          >
                            {entry.description || "Add description"}
                          </button>
                          <button
                            type="button"
                            className="flex max-w-[40%] min-w-0 shrink items-center gap-2 rounded-sm text-left text-sm"
                            onClick={() => setEditingEntryId(entry.id)}
                            title="Edit project"
                          >
                            <span
                              className="h-2 w-2 shrink-0 rounded-full bg-slate-600"
                              style={
                                entry.project?.color
                                  ? { backgroundColor: entry.project.color }
                                  : undefined
                              }
                            />
                            <span
                              className={
                                entry.project?.name
                                  ? "text-frosted-mint-300 truncate"
                                  : "truncate text-slate-500"
                              }
                            >
                              {entry.project?.name ?? "+ Add project"}
                            </span>
                          </button>
                        </div>
                        <div className="hidden min-w-0 md:block">
                          {entry.tags.length ? (
                            <button
                              type="button"
                              className="flex max-w-full flex-wrap gap-1 rounded-sm text-left"
                              onClick={() => setEditingEntryId(entry.id)}
                              aria-label={`Edit tags for ${entry.description || "time entry"}`}
                            >
                              {entry.tags.map((tag) => (
                                <Badge key={tag.id} color={tag.color}>
                                  {tag.name}
                                </Badge>
                              ))}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="text-xs text-slate-600 hover:text-slate-400"
                              onClick={() => setEditingEntryId(entry.id)}
                            >
                              —
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          className="rounded-sm text-left font-mono text-xs text-slate-500 md:text-right"
                          onClick={() => setEditingEntryId(entry.id)}
                          title="Edit date, times, and duration"
                        >
                          <span>
                            {formatInTimeZone(entry.started_at, me.member.timezone, "h:mm a")} –{" "}
                            {entry.stopped_at
                              ? formatInTimeZone(entry.stopped_at, me.member.timezone, "h:mm a")
                              : "running"}
                          </span>
                          <strong
                            className={`ml-3 text-sm ${
                              entry.running ? "text-light-green-400" : "text-slate-200"
                            }`}
                          >
                            {formatClockDuration(durationFor(entry))}
                          </strong>
                        </button>
                        <div className="flex justify-end gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                          <Button
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => continueMutation.mutate(entry)}
                            title="Continue"
                            aria-label="Continue time entry"
                          >
                            <Play size={14} />
                          </Button>
                          <div className="relative">
                            <details className="group/menu">
                              <summary className="grid h-8 w-8 list-none place-items-center rounded-lg text-slate-400 hover:bg-white/7 hover:text-slate-100 [&::-webkit-details-marker]:hidden">
                                <MoreHorizontal size={14} />
                                <span className="sr-only">More actions</span>
                              </summary>
                              <div className="timer-popover absolute top-9 right-0 z-20 w-40 p-1">
                                {!entry.running ? (
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-slate-300 hover:bg-white/8"
                                    onClick={() => duplicateMutation.mutate(entry)}
                                  >
                                    <Copy size={13} /> Duplicate
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-red-300 hover:bg-white/8"
                                  onClick={() => deleteMutation.mutate(entry)}
                                >
                                  <Trash2 size={13} /> Delete
                                </button>
                              </div>
                            </details>
                          </div>
                        </div>
                      </article>
                    ),
                  )}
                </section>
              );
            })
          )}
        </section>
      ) : null}

      {undoEntry ? (
        <div className="fixed right-4 bottom-4 z-30 flex items-center gap-3 rounded-xl border border-white/10 bg-[#171d16] px-4 py-3 text-sm text-white shadow-xl">
          Entry deleted.
          <Button
            variant="accent"
            className="min-h-8 py-1"
            onClick={() => restoreMutation.mutate(undoEntry)}
          >
            <RotateCcw size={14} /> Undo
          </Button>
        </div>
      ) : null}
    </>
  );
}
