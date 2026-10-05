import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { Plus, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { overlapDuration } from "@/domain/dates/time";
import { useMe } from "@/web/app/context";
import { Button, EmptyState, ErrorState, Modal } from "@/web/components/ui";
import { EntryEditor } from "@/web/features/time/entry-editor";
import {
  addCalendarDays,
  TIME_ENTRY_LIST_LIMIT,
  zonedDayStartIso,
} from "@/web/features/timer/list-date-range";
import { useNow } from "@/web/hooks/use-now";
import { apiRequest } from "@/web/lib/api";
import { formatCompactDuration, formatHoursLabel } from "@/web/lib/format";
import type { Project, Tag, TimeEntry } from "@/web/types";

interface TimesheetRow {
  key: string;
  projectId: string | null;
  projectName: string;
  projectColor: string | null;
  description: string;
  byDay: Map<string, { ms: number; entries: TimeEntry[] }>;
  totalMs: number;
}

export function TimesheetView({
  weekStart,
  memberId,
  timezone,
}: {
  weekStart: string;
  memberId: string;
  timezone?: string;
}) {
  const me = useMe();
  const zone = timezone ?? me.member.timezone;
  const startDate = weekStart;
  return (
    <TimesheetWeek
      key={`${memberId}:${startDate}:${zone}`}
      startDate={startDate}
      memberId={memberId}
      timezone={zone}
    />
  );
}

function TimesheetWeek({
  startDate,
  memberId,
  timezone,
}: {
  startDate: string;
  memberId: string;
  timezone: string;
}) {
  const me = useMe();
  const now = useNow();
  const queryClient = useQueryClient();
  const [draftRows, setDraftRows] = useState<
    Array<{ key: string; projectId: string; description: string }>
  >([]);
  const [cellValues, setCellValues] = useState<Record<string, string>>({});
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [choosingEntries, setChoosingEntries] = useState<TimeEntry[]>([]);
  const pending = useRef(false);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addCalendarDays(startDate, index)),
    [startDate],
  );
  const dayRanges = useMemo(
    () =>
      weekDays.map((day) => ({
        day,
        start: Date.parse(zonedDayStartIso(day, timezone)),
        end: Date.parse(zonedDayStartIso(addCalendarDays(day, 1), timezone)),
      })),
    [weekDays, timezone],
  );
  const range = useMemo(
    () => ({
      start: zonedDayStartIso(startDate, timezone),
      end: zonedDayStartIso(addCalendarDays(startDate, 7), timezone),
    }),
    [startDate, timezone],
  );
  const dayLabel = (day: string) => formatInTimeZone(`${day}T12:00:00Z`, "UTC", "EEE");

  const projects = useQuery({
    queryKey: ["projects", "active"],
    queryFn: () => apiRequest<{ projects: Project[] }>("/projects?status=active"),
    select: (data) => ({
      ...data,
      projects: data.projects.filter((project) => project.client_status !== "archived"),
    }),
  });
  const tags = useQuery({
    queryKey: ["tags", "active"],
    queryFn: () => apiRequest<{ tags: Tag[] }>("/tags?status=active"),
  });
  const entries = useQuery({
    queryKey: ["time-entries", "timesheet", range, memberId],
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(TIME_ENTRY_LIST_LIMIT),
        start: range.start,
        end: range.end,
        ...(me.permissions.view_team ? { member_id: memberId } : {}),
      });
      return apiRequest<{ entries: TimeEntry[] }>(`/time-entries?${params}`);
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: {
      description: string;
      project_id: string | null;
      started_at: string;
      stopped_at: string;
    }) =>
      apiRequest("/time-entries", {
        method: "POST",
        body: JSON.stringify({
          ...(me.permissions.view_team ? { member_id: memberId } : {}),
          ...body,
          tag_ids: [],
          billable:
            (me.workspace.members_can_set_billable || me.member.role !== "member") &&
            Boolean(
              projects.data?.projects.find((project) => project.id === body.project_id)
                ?.billable_default,
            ),
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
      ]);
    },
  });

  const rows = useMemo(() => {
    const map = new Map<string, TimesheetRow>();
    for (const entry of entries.data?.entries ?? []) {
      const projectId = entry.project?.id ?? null;
      const description = entry.description.trim();
      const key = `${projectId ?? "none"}::${description}`;
      const startedAt = Date.parse(entry.started_at);
      const stoppedAt = entry.running
        ? now
        : entry.stopped_at
          ? Date.parse(entry.stopped_at)
          : startedAt + entry.duration_ms;
      const existing =
        map.get(key) ??
        ({
          key,
          projectId,
          projectName: entry.project?.name ?? "Without project",
          projectColor: entry.project?.color ?? null,
          description,
          byDay: new Map<string, { ms: number; entries: TimeEntry[] }>(),
          totalMs: 0,
        } satisfies TimesheetRow);
      for (const { day, start, end } of dayRanges) {
        const ms = overlapDuration(startedAt, stoppedAt, start, end);
        if (ms <= 0) continue;
        const dayBucket = existing.byDay.get(day) ?? { ms: 0, entries: [] as TimeEntry[] };
        dayBucket.ms += ms;
        dayBucket.entries.push(entry);
        existing.byDay.set(day, dayBucket);
        existing.totalMs += ms;
      }
      if (existing.byDay.size > 0) map.set(key, existing);
    }
    const fromEntries = [...map.values()].sort((left, right) =>
      left.projectName.localeCompare(right.projectName),
    );
    const drafts: TimesheetRow[] = draftRows.map((draft) => {
      const project = projects.data?.projects.find((item) => item.id === draft.projectId);
      return {
        key: draft.key,
        projectId: draft.projectId || null,
        projectName: project?.name ?? "Without project",
        projectColor: project?.color ?? null,
        description: draft.description,
        byDay: new Map<string, { ms: number; entries: TimeEntry[] }>(),
        totalMs: 0,
      };
    });
    return [...fromEntries, ...drafts];
  }, [draftRows, entries.data?.entries, dayRanges, now, projects.data?.projects]);

  const dayTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const day of weekDays) {
      const key = day;
      totals.set(key, 0);
    }
    for (const row of rows) {
      for (const [day, bucket] of row.byDay) {
        totals.set(day, (totals.get(day) ?? 0) + bucket.ms);
      }
    }
    return totals;
  }, [rows, weekDays]);

  const grandTotal = [...dayTotals.values()].reduce((sum, value) => sum + value, 0);

  const commitCell = async (row: TimesheetRow, day: string, rawValue: string): Promise<void> => {
    if (pending.current || !rawValue.trim()) return;
    const cellKey = `${row.key}:${day}`;
    const value = rawValue.trim();
    const clock = /^(\d+):([0-5]\d)$/.exec(value);
    const ms = clock
      ? Math.round((Number(clock[1]) * 60 + Number(clock[2])) * 60_000)
      : /^\d+(?:\.\d+)?$/.test(value)
        ? Math.round(Number(value) * 3_600_000)
        : NaN;
    if (!Number.isFinite(ms) || ms <= 0 || ms > 7 * 24 * 3_600_000) {
      setCellErrors((current) => ({
        ...current,
        [cellKey]: "Enter positive hours (1.5 or 1:30), up to 168 hours. Minutes must be 00–59.",
      }));
      return;
    }
    pending.current = true;
    setCellErrors((current) => ({ ...current, [cellKey]: "" }));
    try {
      const startedAt = fromZonedTime(`${day}T09:00:00`, timezone);
      await createMutation.mutateAsync({
        description: row.description,
        project_id: row.projectId,
        started_at: startedAt.toISOString(),
        stopped_at: new Date(startedAt.getTime() + ms).toISOString(),
      });
      setDraftRows((current) => current.filter((item) => item.key !== row.key));
      setCellValues((current) => ({ ...current, [cellKey]: "" }));
    } catch (error) {
      setCellErrors((current) => ({
        ...current,
        [cellKey]: error instanceof Error ? error.message : "Could not save hours. Try again.",
      }));
    } finally {
      pending.current = false;
    }
  };

  if (entries.isLoading) {
    return (
      <div className="space-y-2 p-4">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-12 animate-pulse rounded-md bg-white/5" />
        ))}
      </div>
    );
  }

  if (entries.error) {
    return (
      <div className="p-4">
        <ErrorState message={entries.error.message} onRetry={() => void entries.refetch()} />
      </div>
    );
  }

  return (
    <section className="min-h-[calc(100vh-220px)] max-w-full min-w-0 bg-[#212121] px-4 py-4 md:px-5">
      {rows.length === 0 ? (
        <EmptyState
          title="No timesheet rows this week"
          description="Add a row and enter hours for each weekday."
        />
      ) : null}

      {(entries.data?.entries.length ?? 0) >= TIME_ENTRY_LIST_LIMIT ? (
        <p role="status" className="mb-3 text-sm text-amber-300">
          This week reached the 5,000-entry limit. Totals may be incomplete; use reports for the
          full history.
        </p>
      ) : null}
      {projects.error || tags.error ? (
        <p role="alert" className="mb-3 text-sm text-red-300">
          {projects.error?.message ?? tags.error?.message}
        </p>
      ) : null}
      <div
        className="max-w-full min-w-0 overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Weekly timesheet"
      >
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-[10px] font-bold tracking-[0.12em] text-slate-500 uppercase">
              <th className="sticky left-0 z-10 bg-[#212121] px-2 py-2 text-left">Project</th>
              {weekDays.map((day) => (
                <th key={day} className="px-1 py-2 text-center tabular-nums">
                  {dayLabel(day)}
                </th>
              ))}
              <th className="px-2 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="group">
                <td className="sticky left-0 z-10 border-b border-white/8 bg-[#212121] px-2 py-2">
                  {draftRows.some((draft) => draft.key === row.key) ? (
                    <div className="flex min-w-48 items-start gap-2">
                      <div className="space-y-1">
                        <select
                          aria-label="Draft row project"
                          disabled={createMutation.isPending}
                          className="h-8 w-full rounded border border-white/12 bg-[#1b1b1b] px-2 text-slate-200"
                          value={row.projectId ?? ""}
                          onChange={(event) =>
                            setDraftRows((current) =>
                              current.map((draft) =>
                                draft.key === row.key
                                  ? { ...draft, projectId: event.target.value }
                                  : draft,
                              ),
                            )
                          }
                        >
                          <option value="">Without project</option>
                          {(projects.data?.projects ?? []).map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label="Draft row description"
                          maxLength={500}
                          disabled={createMutation.isPending}
                          placeholder="Description"
                          className="h-8 w-full rounded border border-white/12 bg-[#1b1b1b] px-2 text-slate-200"
                          value={row.description}
                          onChange={(event) =>
                            setDraftRows((current) =>
                              current.map((draft) =>
                                draft.key === row.key
                                  ? { ...draft, description: event.target.value }
                                  : draft,
                              ),
                            )
                          }
                        />
                      </div>
                      <Button
                        variant="ghost"
                        aria-label="Remove draft row"
                        disabled={createMutation.isPending}
                        onClick={() =>
                          setDraftRows((current) =>
                            current.filter((draft) => draft.key !== row.key),
                          )
                        }
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex min-w-48 items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-slate-600"
                        style={row.projectColor ? { backgroundColor: row.projectColor } : undefined}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-100">{row.projectName}</p>
                        {row.description ? (
                          <p className="truncate text-xs text-slate-500">{row.description}</p>
                        ) : null}
                      </div>
                    </div>
                  )}
                </td>
                {weekDays.map((day) => {
                  const dayKey = day;
                  const bucket = row.byDay.get(dayKey);
                  const value = bucket?.ms ? formatCompactDuration(bucket.ms) : "";
                  return (
                    <td key={dayKey} className="border-b border-white/8 px-1 py-1.5">
                      {bucket?.entries.length ? (
                        <button
                          type="button"
                          className="h-9 w-full rounded-md border border-white/12 bg-[#1b1b1b] px-2 text-center text-sm text-slate-200 tabular-nums hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-slate-400"
                          aria-label={`Edit ${row.projectName} ${dayLabel(day)} ${bucket.entries.length} ${bucket.entries.length === 1 ? "entry" : "entries"}`}
                          onClick={() =>
                            bucket.entries.length === 1
                              ? setEditingEntry(bucket.entries[0] ?? null)
                              : setChoosingEntries(bucket.entries)
                          }
                        >
                          {value}
                        </button>
                      ) : (
                        <input
                          className="h-9 w-full rounded-md border border-white/12 bg-[#1b1b1b] px-2 text-center text-sm text-slate-200 tabular-nums outline-none placeholder:text-slate-600 focus:border-slate-400"
                          value={cellValues[`${row.key}:${dayKey}`] ?? ""}
                          onChange={(event) =>
                            setCellValues((current) => ({
                              ...current,
                              [`${row.key}:${dayKey}`]: event.target.value,
                            }))
                          }
                          placeholder="-"
                          aria-label={`${row.projectName} ${dayLabel(day)}`}
                          aria-invalid={Boolean(cellErrors[`${row.key}:${dayKey}`])}
                          aria-describedby={
                            cellErrors[`${row.key}:${dayKey}`]
                              ? `error-${encodeURIComponent(row.key)}-${dayKey}`
                              : undefined
                          }
                          disabled={createMutation.isPending}
                          onBlur={(event) => void commitCell(row, day, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                            if (event.key === "Escape") {
                              setCellValues((current) => ({
                                ...current,
                                [`${row.key}:${dayKey}`]: "",
                              }));
                              setCellErrors((current) => ({
                                ...current,
                                [`${row.key}:${dayKey}`]: "",
                              }));
                            }
                          }}
                        />
                      )}
                      {cellErrors[`${row.key}:${dayKey}`] ? (
                        <p
                          id={`error-${encodeURIComponent(row.key)}-${dayKey}`}
                          role="alert"
                          className="mt-1 max-w-36 text-xs text-red-300"
                        >
                          {cellErrors[`${row.key}:${dayKey}`]}
                        </p>
                      ) : null}
                    </td>
                  );
                })}
                <td className="border-b border-white/8 px-2 py-2 text-right text-slate-300 tabular-nums">
                  {formatHoursLabel(row.totalMs)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky left-0 bg-[#212121] px-2 py-3 text-xs font-bold tracking-wider text-slate-400 uppercase">
                Total
              </td>
              {weekDays.map((day) => {
                const dayKey = day;
                return (
                  <td
                    key={dayKey}
                    className="px-1 py-3 text-center text-xs text-slate-400 tabular-nums"
                  >
                    {formatHoursLabel(dayTotals.get(dayKey) ?? 0)}
                  </td>
                );
              })}
              <td className="px-2 py-3 text-right text-sm font-bold text-slate-200 tabular-nums">
                {formatHoursLabel(grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          className="min-h-8"
          onClick={() =>
            setDraftRows((current) => [
              ...current,
              {
                key: `draft-${crypto.randomUUID()}`,
                projectId: projects.data?.projects[0]?.id ?? "",
                description: "",
              },
            ])
          }
        >
          <Plus size={14} /> Add row
        </Button>
      </div>
      <Modal
        open={choosingEntries.length > 0}
        onOpenChange={(open) => {
          if (!open) setChoosingEntries([]);
        }}
        title="Choose an entry to edit"
        description="Each entry keeps its own project, tags, and time range."
      >
        <div className="space-y-2">
          {choosingEntries.map((entry) => (
            <Button
              key={entry.id}
              variant="secondary"
              className="w-full justify-between"
              onClick={() => {
                setChoosingEntries([]);
                setEditingEntry(entry);
              }}
            >
              <span>
                {formatInTimeZone(entry.started_at, timezone, "HH:mm")} –{" "}
                {entry.stopped_at
                  ? formatInTimeZone(entry.stopped_at, timezone, "HH:mm")
                  : "Running"}
              </span>
              <span>
                {formatCompactDuration(
                  entry.running
                    ? Math.max(0, now - new Date(entry.started_at).getTime())
                    : entry.duration_ms,
                )}
              </span>
            </Button>
          ))}
        </div>
      </Modal>
      <EntryEditor
        open={Boolean(editingEntry)}
        onOpenChange={(open) => {
          if (!open) setEditingEntry(null);
        }}
        entry={editingEntry}
        targetMemberId={memberId}
        projects={projects.data?.projects ?? []}
        tags={tags.data?.tags ?? []}
      />
    </section>
  );
}
