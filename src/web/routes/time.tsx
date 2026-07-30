import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, addWeeks, startOfDay, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  List,
  Play,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { useMe } from "@/web/app/context";
import { Badge, Button, EmptyState, ErrorState, Input, Select } from "@/web/components/ui";
import { InlineEntryEditor } from "@/web/features/time/inline-entry-editor";
import { useNow } from "@/web/hooks/use-now";
import { ApiClientError, apiRequest, idempotencyKey } from "@/web/lib/api";
import { formatDuration } from "@/web/lib/format";
import { broadcastTimerChange } from "@/web/lib/timer";
import type { Client, Member, Project, Tag, TimeEntry } from "@/web/types";

export function TimePage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const now = useNow();
  const [anchor, setAnchor] = useState(new Date());
  const [rangeMode, setRangeMode] = useState<"day" | "week">("week");
  const [search, setSearch] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterBillable, setFilterBillable] = useState("");
  const [memberId, setMemberId] = useState(me.member.id);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [undoEntry, setUndoEntry] = useState<TimeEntry | null>(null);

  const periodStart =
    rangeMode === "week"
      ? startOfWeek(anchor, {
          weekStartsOn: me.workspace.week_start === "monday" ? 1 : 0,
        })
      : startOfDay(anchor);
  const periodEnd = addDays(periodStart, rangeMode === "week" ? 7 : 1);
  const range = {
    start: fromZonedTime(
      formatInTimeZone(periodStart, me.member.timezone, "yyyy-MM-dd'T'00:00:00"),
      me.member.timezone,
    ).toISOString(),
    end: fromZonedTime(
      formatInTimeZone(periodEnd, me.member.timezone, "yyyy-MM-dd'T'00:00:00"),
      me.member.timezone,
    ).toISOString(),
  };
  const rangeLabel =
    rangeMode === "week"
      ? `${formatInTimeZone(periodStart, me.member.timezone, "MMM d")} – ${formatInTimeZone(
          addDays(periodEnd, -1),
          me.member.timezone,
          "MMM d, yyyy",
        )}`
      : formatInTimeZone(periodStart, me.member.timezone, "EEEE, MMM d, yyyy");

  const projects = useQuery({
    queryKey: ["projects", "active"],
    queryFn: () => apiRequest<{ projects: Project[] }>("/projects?status=active"),
  });
  const members = useQuery({
    queryKey: ["members"],
    queryFn: () => apiRequest<{ members: Member[] }>("/members"),
    enabled: me.permissions.view_team,
  });
  const clients = useQuery({
    queryKey: ["clients", "active"],
    queryFn: () => apiRequest<{ clients: Client[] }>("/clients?status=active"),
  });
  const tags = useQuery({
    queryKey: ["tags", "active"],
    queryFn: () => apiRequest<{ tags: Tag[] }>("/tags?status=active"),
  });
  const entries = useQuery({
    queryKey: [
      "time-entries",
      range,
      search,
      filterProject,
      filterClient,
      filterTag,
      filterBillable,
      memberId,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        start: range.start,
        end: range.end,
        ...(search ? { search } : {}),
        ...(filterProject ? { project_id: filterProject } : {}),
        ...(filterClient ? { client_id: filterClient } : {}),
        ...(filterTag ? { tag_id: filterTag } : {}),
        ...(filterBillable ? { billable: filterBillable } : {}),
        ...(me.permissions.view_team ? { member_id: memberId } : {}),
      });
      return apiRequest<{ entries: TimeEntry[]; generated_at: string }>(`/time-entries?${params}`);
    },
  });

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
          ...(me.permissions.financial &&
          entry.rate_minor !== null &&
          entry.rate_minor !== undefined
            ? {
                rate_minor: entry.rate_minor,
                rate_currency: entry.rate_currency ?? me.workspace.currency,
              }
            : {}),
        }),
      }),
    onSuccess: async ({ entry }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
      ]);
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
  const durationFor = (entry: TimeEntry) =>
    entry.running ? Math.max(0, now - new Date(entry.started_at).getTime()) : entry.duration_ms;
  const total = (entries.data?.entries ?? []).reduce((sum, entry) => sum + durationFor(entry), 0);
  const activeFilterCount = [search, filterProject, filterClient, filterTag, filterBillable].filter(
    Boolean,
  ).length;

  return (
    <>
      <section className="border-b border-white/10 bg-[#111710]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-5">
          <div className="flex min-w-0 items-center gap-1">
            <h1 className="mr-3 hidden text-sm font-bold text-slate-100 lg:block">Time</h1>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={() =>
                setAnchor(rangeMode === "week" ? addWeeks(anchor, -1) : addDays(anchor, -1))
              }
            >
              <ChevronLeft size={16} />
              <span className="sr-only">Previous range</span>
            </Button>
            <button
              type="button"
              className="hover:border-frosted-mint-700 min-w-44 rounded-md border border-white/15 bg-white/3 px-3 py-2 text-left text-sm font-semibold text-slate-200"
              onClick={() => setAnchor(new Date())}
              title="Return to today"
            >
              {rangeLabel}
            </button>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={() =>
                setAnchor(rangeMode === "week" ? addWeeks(anchor, 1) : addDays(anchor, 1))
              }
            >
              <ChevronRight size={16} />
              <span className="sr-only">Next range</span>
            </Button>
            <Select
              className="ml-1 h-9 min-h-9 w-24"
              value={rangeMode}
              onChange={(event) => setRangeMode(event.target.value as typeof rangeMode)}
              aria-label="Time range mode"
            >
              <option value="week">Week</option>
              <option value="day">Day</option>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden text-right md:block">
              <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                Range total
              </p>
              <p className="text-frosted-mint-300 font-mono text-sm font-bold">
                {formatDuration(total)}
              </p>
            </div>
            {me.permissions.view_team ? (
              <Select
                className="h-9 min-h-9 min-w-44"
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
                aria-label="Time list member"
              >
                {(members.data?.members ?? []).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.display_name}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 px-4 py-2 md:px-5">
          <div className="flex items-center gap-2">
            <span className="text-light-green-400 text-[10px] font-black tracking-[0.12em] uppercase">
              {me.workspace.company_name}
            </span>
          </div>
          <div className="flex shrink-0 overflow-hidden rounded-md border border-white/15">
            <Link
              to="/calendar"
              className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-slate-400 hover:bg-white/6 hover:text-white"
            >
              <CalendarDays size={14} /> Calendar
            </Link>
            <span className="bg-frosted-mint-900 text-frosted-mint-200 flex shrink-0 items-center gap-1.5 border-l border-white/10 px-3 py-1.5 text-xs font-semibold whitespace-nowrap">
              <List size={14} /> Time entries
            </span>
          </div>
        </div>

        <div className="grid gap-2 border-t border-white/8 px-4 py-2.5 md:grid-cols-2 md:px-5 xl:grid-cols-5">
          <div className="relative">
            <Search className="absolute top-2.5 left-3 text-slate-600" size={15} />
            <Input
              className="h-9 min-h-9 pl-9"
              placeholder="Search descriptions"
              aria-label="Search time descriptions"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select
            className="h-9 min-h-9"
            value={filterProject}
            onChange={(event) => setFilterProject(event.target.value)}
            aria-label="Filter by project"
          >
            <option value="">All projects</option>
            {(projects.data?.projects ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
          <Select
            className="h-9 min-h-9"
            value={filterClient}
            onChange={(event) => setFilterClient(event.target.value)}
            aria-label="Filter by client"
          >
            <option value="">All clients</option>
            {(clients.data?.clients ?? []).map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
          <Select
            className="h-9 min-h-9"
            value={filterTag}
            onChange={(event) => setFilterTag(event.target.value)}
            aria-label="Filter by tag"
          >
            <option value="">All tags</option>
            {(tags.data?.tags ?? []).map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
          <Select
            className="h-9 min-h-9"
            value={filterBillable}
            onChange={(event) => setFilterBillable(event.target.value)}
            aria-label={`Filter by billing status; ${activeFilterCount} filters active`}
          >
            <option value="">All billing states</option>
            <option value="true">Billable</option>
            <option value="false">Non-billable</option>
          </Select>
        </div>
      </section>

      <section className="min-h-[calc(100vh-230px)] bg-[#141a13]">
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
            title="No time recorded in this range"
            description="Start the timer above, or drag across a time range in Calendar."
            action={
              <Link
                to="/calendar"
                className="border-frosted-mint-800 hover:border-frosted-mint-600 inline-flex min-h-9 items-center gap-2 rounded-lg border bg-white/4 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/8"
              >
                <CalendarDays size={15} /> Open Calendar
              </Link>
            }
          />
        ) : (
          grouped.map(([day, dayEntries]) => {
            const dayTotal = dayEntries.reduce((sum, entry) => sum + durationFor(entry), 0);
            const isToday = day === formatInTimeZone(new Date(), me.member.timezone, "yyyy-MM-dd");
            return (
              <section key={day} aria-labelledby={`day-${day}`}>
                <div className="flex items-center justify-between border-y border-white/8 bg-[#111710] px-5 py-2.5">
                  <h2 id={`day-${day}`} className="text-sm font-bold text-slate-200">
                    {isToday
                      ? "Today"
                      : formatInTimeZone(`${day}T12:00:00Z`, me.member.timezone, "EEEE, MMMM d")}
                  </h2>
                  <span className="font-mono text-sm font-bold text-slate-300">
                    {formatDuration(dayTotal)}
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
                      className={`group grid min-h-[58px] items-center gap-3 border-b border-white/7 px-5 py-2.5 transition hover:bg-white/[0.035] md:grid-cols-[minmax(180px,1fr)_240px_175px_auto] ${
                        entry.running ? "bg-frosted-mint-950/30" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <button
                          type="button"
                          className="hover:text-frosted-mint-300 block max-w-full truncate rounded-sm text-left text-sm font-semibold text-slate-100"
                          onClick={() => setEditingEntryId(entry.id)}
                          title="Edit description"
                        >
                          {entry.description || "No description"}
                        </button>
                        {entry.tags.length ? (
                          <button
                            type="button"
                            className="mt-1 flex max-w-full flex-wrap gap-1 rounded-sm text-left"
                            onClick={() => setEditingEntryId(entry.id)}
                            aria-label={`Edit tags for ${entry.description || "time entry"}`}
                          >
                            {entry.tags.map((tag) => (
                              <Badge key={tag.id} color={tag.color}>
                                {tag.name}
                              </Badge>
                            ))}
                          </button>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-2 rounded-sm text-left text-sm"
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
                        <span className="text-frosted-mint-300 truncate">
                          {entry.project?.name ?? "No project"}
                        </span>
                        {entry.client?.name ? (
                          <span className="truncate text-xs text-slate-600">
                            {entry.client.name}
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className="rounded-sm font-mono text-xs text-slate-500 md:text-right"
                        onClick={() => setEditingEntryId(entry.id)}
                        title="Edit date, times, and duration"
                      >
                        {formatInTimeZone(entry.started_at, me.member.timezone, "HH:mm")} –{" "}
                        {entry.stopped_at
                          ? formatInTimeZone(entry.stopped_at, me.member.timezone, "HH:mm")
                          : "running"}
                        <strong
                          className={`ml-3 text-sm ${
                            entry.running ? "text-light-green-400" : "text-slate-200"
                          }`}
                        >
                          {formatDuration(durationFor(entry))}
                        </strong>
                      </button>
                      <div className="flex justify-end gap-0.5 opacity-70 transition group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => continueMutation.mutate(entry)}
                          title="Continue"
                        >
                          <Play size={14} />
                        </Button>
                        {!entry.running ? (
                          <Button
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => duplicateMutation.mutate(entry)}
                            title="Duplicate and edit inline"
                            disabled={duplicateMutation.isPending}
                          >
                            <Copy size={14} />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          className="h-8 w-8 p-0 text-red-400"
                          onClick={() => deleteMutation.mutate(entry)}
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </article>
                  ),
                )}
              </section>
            );
          })
        )}
      </section>

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
