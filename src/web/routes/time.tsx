import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, addWeeks, startOfDay, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Copy,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useMe } from "@/web/app/context";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
} from "@/web/components/ui";
import { EntryEditor } from "@/web/features/time/entry-editor";
import { useNow } from "@/web/hooks/use-now";
import { ApiClientError, apiRequest, idempotencyKey } from "@/web/lib/api";
import { formatDuration } from "@/web/lib/format";
import type { Client, Member, Project, Tag, TimeEntry } from "@/web/types";

function broadcastTimer(): void {
  const channel = new BroadcastChannel("iomechs-time-timer");
  channel.postMessage({ changed: Date.now() });
  channel.close();
}

export function TimePage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const now = useNow();
  const [anchor, setAnchor] = useState(new Date());
  const [rangeMode, setRangeMode] = useState<"day" | "week">("week");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [billable, setBillable] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterBillable, setFilterBillable] = useState("");
  const [memberId, setMemberId] = useState(me.member.id);
  const [editor, setEditor] = useState<TimeEntry | "new" | null>(null);
  const [duplicate, setDuplicate] = useState<TimeEntry | null>(null);
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
  const recent = useQuery({
    queryKey: ["recent-time"],
    queryFn: () =>
      apiRequest<{
        recent: Array<{
          description: string;
          project_id: string | null;
          project_name: string | null;
          client_name: string | null;
        }>;
      }>("/me/recent"),
  });
  const timer = useQuery({
    queryKey: ["timer"],
    queryFn: () => apiRequest<{ entry: TimeEntry | null; server_now: string }>("/timer"),
    refetchInterval: 30_000,
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

  const startMutation = useMutation({
    mutationFn: () =>
      apiRequest("/timer/start", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({
          description,
          project_id: projectId || null,
          tag_ids: selectedTags,
          billable,
        }),
      }),
    onSuccess: async () => {
      broadcastTimer();
      setDescription("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["timer"] }),
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
      ]);
    },
    onError: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["timer"] }),
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
      ]);
    },
  });
  const stopMutation = useMutation({
    mutationFn: () =>
      apiRequest("/timer/stop", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: "{}",
      }),
    onSuccess: async () => {
      broadcastTimer();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["timer"] }),
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
      ]);
    },
    onError: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["timer"] }),
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
      ]);
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
      broadcastTimer();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["timer"] }),
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
      ]);
    },
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, TimeEntry[]>();
    for (const entry of entries.data?.entries ?? []) {
      if (entry.running) continue;
      const day = formatInTimeZone(entry.started_at, me.member.timezone, "yyyy-MM-dd");
      groups.set(day, [...(groups.get(day) ?? []), entry]);
    }
    return [...groups.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [entries.data, me.member.timezone]);
  const total = (entries.data?.entries ?? []).reduce(
    (sum, entry) =>
      sum + (entry.running ? now - new Date(entry.started_at).getTime() : entry.duration_ms),
    0,
  );
  const activeTimer = timer.data?.entry ?? null;

  return (
    <>
      <PageHeader
        title="Time"
        description="Track, review, and correct your working time."
        actions={
          <>
            {me.permissions.view_team ? (
              <Select
                className="min-w-52"
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
            <Button variant="secondary" onClick={() => setEditor("new")}>
              <CalendarPlus size={16} /> Add manual entry
            </Button>
          </>
        }
      />

      <section className="panel mb-5 overflow-hidden">
        <div className="grid gap-3 p-4 lg:grid-cols-[minmax(220px,1fr)_260px_180px_auto]">
          <Input
            value={activeTimer?.description ?? description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={Boolean(activeTimer)}
            placeholder="What are you working on?"
            aria-label="Timer description"
            className="text-base"
          />
          <Select
            value={activeTimer?.project?.id ?? projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              const project = projects.data?.projects.find(
                (item) => item.id === event.target.value,
              );
              setBillable(project?.billable_default === true || project?.billable_default === 1);
            }}
            disabled={Boolean(activeTimer)}
            aria-label="Timer project"
          >
            <option value="">No project</option>
            {(projects.data?.projects ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.client_name} · {project.name}
              </option>
            ))}
          </Select>
          <Select
            multiple
            value={activeTimer ? activeTimer.tags.map((tag) => tag.id) : selectedTags}
            onChange={(event) =>
              setSelectedTags([...event.target.selectedOptions].map((option) => option.value))
            }
            disabled={Boolean(activeTimer)}
            aria-label="Timer tags"
            className="h-10"
          >
            {(tags.data?.tags ?? []).map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
          {activeTimer ? (
            <Button
              variant="danger"
              className="min-w-40"
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
            >
              <Square size={15} fill="currentColor" />
              {formatDuration(now - new Date(activeTimer.started_at).getTime(), true)}
            </Button>
          ) : (
            <Button
              variant="accent"
              className="min-w-40"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
            >
              <Play size={17} fill="currentColor" /> Start timer
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-xs text-slate-500">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={activeTimer?.billable ?? billable}
              disabled={Boolean(activeTimer) || !me.workspace.members_can_set_billable}
              onChange={(event) => setBillable(event.target.checked)}
            />
            Billable
          </label>
          {activeTimer ? (
            <span>
              Started at {formatInTimeZone(activeTimer.started_at, me.member.timezone, "HH:mm")}
            </span>
          ) : (
            <span>Server time is used when the timer starts and stops.</span>
          )}
          {(startMutation.error ?? stopMutation.error) ? (
            <span className="text-red-600">
              {(startMutation.error ?? stopMutation.error)?.message}
            </span>
          ) : null}
          {!activeTimer && (recent.data?.recent.length ?? 0) > 0 ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 lg:justify-end">
              <span className="mr-1 font-medium text-slate-400">Recent</span>
              {(recent.data?.recent ?? []).slice(0, 5).map((item) => (
                <button
                  key={`${item.description}:${item.project_id ?? ""}`}
                  className="hover:border-frosted-mint-700 hover:text-frosted-mint-700 max-w-48 truncate rounded-md border border-slate-200 bg-white px-2 py-1"
                  title={[item.client_name, item.project_name].filter(Boolean).join(" · ")}
                  onClick={() => {
                    setDescription(item.description);
                    setProjectId(item.project_id ?? "");
                  }}
                >
                  {item.description || item.project_name || "No description"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              className="h-9 w-9 p-0"
              onClick={() =>
                setAnchor(rangeMode === "week" ? addWeeks(anchor, -1) : addDays(anchor, -1))
              }
            >
              <ChevronLeft size={17} />
              <span className="sr-only">Previous week</span>
            </Button>
            <Button variant="secondary" onClick={() => setAnchor(new Date())}>
              Today
            </Button>
            <Button
              variant="ghost"
              className="h-9 w-9 p-0"
              onClick={() =>
                setAnchor(rangeMode === "week" ? addWeeks(anchor, 1) : addDays(anchor, 1))
              }
            >
              <ChevronRight size={17} />
              <span className="sr-only">Next week</span>
            </Button>
            <span className="ml-2 text-sm font-semibold text-slate-700">
              {rangeMode === "week"
                ? `${formatInTimeZone(periodStart, me.member.timezone, "MMM d")} – ${formatInTimeZone(
                    addDays(periodEnd, -1),
                    me.member.timezone,
                    "MMM d, yyyy",
                  )}`
                : formatInTimeZone(periodStart, me.member.timezone, "EEEE, MMM d, yyyy")}
            </span>
            <Select
              className="ml-2 w-24"
              value={rangeMode}
              onChange={(event) => setRangeMode(event.target.value as typeof rangeMode)}
              aria-label="Time range mode"
            >
              <option value="week">Week</option>
              <option value="day">Day</option>
            </Select>
          </div>
          <div className="bg-frosted-mint-50 text-frosted-mint-800 rounded-lg px-3 py-2 text-sm font-semibold">
            Total {formatDuration(total)}
          </div>
        </div>
        <div className="grid gap-2 border-b border-slate-200 p-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="relative">
            <Search className="absolute top-2.5 left-3 text-slate-400" size={16} />
            <Input
              className="pl-9"
              placeholder="Search descriptions"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select value={filterProject} onChange={(event) => setFilterProject(event.target.value)}>
            <option value="">All projects</option>
            {(projects.data?.projects ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
          <Select value={filterClient} onChange={(event) => setFilterClient(event.target.value)}>
            <option value="">All clients</option>
            {(clients.data?.clients ?? []).map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
          <Select value={filterTag} onChange={(event) => setFilterTag(event.target.value)}>
            <option value="">All tags</option>
            {(tags.data?.tags ?? []).map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
          <Select
            value={filterBillable}
            onChange={(event) => setFilterBillable(event.target.value)}
          >
            <option value="">Billable and non-billable</option>
            <option value="true">Billable</option>
            <option value="false">Non-billable</option>
          </Select>
        </div>

        {entries.isLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-16 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : entries.error ? (
          <ErrorState message={entries.error.message} onRetry={() => void entries.refetch()} />
        ) : grouped.length === 0 ? (
          <EmptyState
            title="No time recorded in this range"
            description="Start the timer above or add a manual entry to build your timesheet."
            action={
              <Button variant="secondary" onClick={() => setEditor("new")}>
                <Plus size={16} /> Add time
              </Button>
            }
          />
        ) : (
          grouped.map(([day, dayEntries]) => {
            const dayTotal = dayEntries.reduce((sum, entry) => sum + entry.duration_ms, 0);
            return (
              <div key={day}>
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
                  <h2 className="text-sm font-bold text-slate-700">
                    {formatInTimeZone(`${day}T12:00:00Z`, me.member.timezone, "EEEE, MMMM d")}
                  </h2>
                  <span className="text-sm font-semibold">{formatDuration(dayTotal)}</span>
                </div>
                {dayEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="grid items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(180px,1fr)_220px_130px_auto]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {entry.description || "No description"}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {entry.tags.map((tag) => (
                          <Badge key={tag.id} color={tag.color}>
                            {tag.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      {entry.project?.color ? (
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: entry.project.color }}
                        />
                      ) : null}
                      <span className="truncate text-slate-700">
                        {entry.project?.name ?? "No project"}
                      </span>
                      <span className="truncate text-slate-400">{entry.client?.name}</span>
                    </div>
                    <div className="text-sm text-slate-500 md:text-right">
                      {formatInTimeZone(entry.started_at, me.member.timezone, "HH:mm")}–{" "}
                      {entry.stopped_at
                        ? formatInTimeZone(entry.stopped_at, me.member.timezone, "HH:mm")
                        : "running"}
                      <strong className="ml-2 text-slate-800">
                        {formatDuration(entry.duration_ms)}
                      </strong>
                    </div>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => continueMutation.mutate(entry)}
                        title="Continue"
                      >
                        <Play size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => setDuplicate(entry)}
                        title="Duplicate"
                      >
                        <Copy size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => setEditor(entry)}
                        title="Edit"
                      >
                        <MoreHorizontal size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0 text-red-600"
                        onClick={() => deleteMutation.mutate(entry)}
                        title="Delete"
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </section>

      {undoEntry ? (
        <div className="fixed right-4 bottom-4 z-30 flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl">
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

      <EntryEditor
        open={editor !== null || duplicate !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditor(null);
            setDuplicate(null);
          }
        }}
        entry={editor && editor !== "new" ? editor : null}
        template={duplicate}
        targetMemberId={me.permissions.view_team ? memberId : undefined}
        projects={projects.data?.projects ?? []}
        tags={tags.data?.tags ?? []}
      />
    </>
  );
}
