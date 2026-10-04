import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, eachDayOfInterval, format } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { useMe } from "@/web/app/context";
import { Button, EmptyState, ErrorState } from "@/web/components/ui";
import { useNow } from "@/web/hooks/use-now";
import { apiRequest } from "@/web/lib/api";
import { formatCompactDuration, formatHoursLabel } from "@/web/lib/format";
import type { Project, TimeEntry } from "@/web/types";

interface TimesheetRow {
  key: string;
  projectId: string | null;
  projectName: string;
  projectColor: string | null;
  description: string;
  byDay: Map<string, { ms: number; entries: TimeEntry[] }>;
  totalMs: number;
}

export function TimesheetView({ weekStart, memberId }: { weekStart: Date; memberId: string }) {
  const me = useMe();
  const now = useNow();
  const queryClient = useQueryClient();
  const [draftRows, setDraftRows] = useState<
    Array<{ key: string; projectId: string; description: string }>
  >([]);

  const weekDays = useMemo(
    () => eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) }),
    [weekStart],
  );
  const range = useMemo(() => {
    const start = fromZonedTime(
      formatInTimeZone(weekStart, me.member.timezone, "yyyy-MM-dd'T'00:00:00"),
      me.member.timezone,
    );
    const end = fromZonedTime(
      formatInTimeZone(addDays(weekStart, 7), me.member.timezone, "yyyy-MM-dd'T'00:00:00"),
      me.member.timezone,
    );
    return { start: start.toISOString(), end: end.toISOString() };
  }, [me.member.timezone, weekStart]);

  const projects = useQuery({
    queryKey: ["projects", "active"],
    queryFn: () => apiRequest<{ projects: Project[] }>("/projects?status=active"),
  });
  const entries = useQuery({
    queryKey: ["time-entries", "timesheet", range, memberId],
    queryFn: () => {
      const params = new URLSearchParams({
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
          billable: false,
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
    const durationOf = (entry: TimeEntry) =>
      entry.running ? Math.max(0, now - new Date(entry.started_at).getTime()) : entry.duration_ms;
    const map = new Map<string, TimesheetRow>();
    for (const entry of entries.data?.entries ?? []) {
      const projectId = entry.project?.id ?? null;
      const description = entry.description.trim();
      const key = `${projectId ?? "none"}::${description}`;
      const day = formatInTimeZone(entry.started_at, me.member.timezone, "yyyy-MM-dd");
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
      const dayBucket = existing.byDay.get(day) ?? { ms: 0, entries: [] as TimeEntry[] };
      const ms = durationOf(entry);
      dayBucket.ms += ms;
      dayBucket.entries.push(entry);
      existing.byDay.set(day, dayBucket);
      existing.totalMs += ms;
      map.set(key, existing);
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
  }, [draftRows, entries.data?.entries, me.member.timezone, now, projects.data?.projects]);

  const dayTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const day of weekDays) {
      const key = formatInTimeZone(day, me.member.timezone, "yyyy-MM-dd");
      totals.set(key, 0);
    }
    for (const row of rows) {
      for (const [day, bucket] of row.byDay) {
        totals.set(day, (totals.get(day) ?? 0) + bucket.ms);
      }
    }
    return totals;
  }, [me.member.timezone, rows, weekDays]);

  const grandTotal = [...dayTotals.values()].reduce((sum, value) => sum + value, 0);

  const parseCellDuration = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-") return null;
    if (trimmed.includes(":")) {
      const [hoursPart, minutesPart = "0"] = trimmed.split(":");
      const hours = Number(hoursPart);
      const minutes = Number(minutesPart);
      if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
      return Math.round((hours * 60 + minutes) * 60_000);
    }
    const hours = Number(trimmed);
    if (!Number.isFinite(hours)) return null;
    return Math.round(hours * 3_600_000);
  };

  const commitCell = async (row: TimesheetRow, day: Date, rawValue: string): Promise<void> => {
    const ms = parseCellDuration(rawValue);
    if (ms === null || ms <= 0) return;
    const dayKey = formatInTimeZone(day, me.member.timezone, "yyyy-MM-dd");
    const existing = row.byDay.get(dayKey)?.ms ?? 0;
    if (existing > 0) return;
    const startLocal = `${dayKey}T09:00:00`;
    const startedAt = fromZonedTime(startLocal, me.member.timezone);
    const stoppedAt = new Date(startedAt.getTime() + ms);
    await createMutation.mutateAsync({
      description: row.description,
      project_id: row.projectId,
      started_at: startedAt.toISOString(),
      stopped_at: stoppedAt.toISOString(),
    });
    setDraftRows((current) => current.filter((item) => item.key !== row.key));
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
    <section className="min-h-[calc(100vh-220px)] bg-[#141a13] px-4 py-4 md:px-5">
      {rows.length === 0 ? (
        <EmptyState
          title="No timesheet rows this week"
          description="Add a row and enter hours for each weekday."
        />
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-[10px] font-bold tracking-[0.12em] text-slate-500 uppercase">
              <th className="sticky left-0 z-10 bg-[#141a13] px-2 py-2 text-left">Project</th>
              {weekDays.map((day) => (
                <th key={day.toISOString()} className="px-1 py-2 text-center font-mono">
                  {format(day, "EEE")}
                </th>
              ))}
              <th className="px-2 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="group">
                <td className="sticky left-0 z-10 border-b border-white/8 bg-[#141a13] px-2 py-2">
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
                </td>
                {weekDays.map((day) => {
                  const dayKey = formatInTimeZone(day, me.member.timezone, "yyyy-MM-dd");
                  const bucket = row.byDay.get(dayKey);
                  const value = bucket?.ms ? formatCompactDuration(bucket.ms) : "";
                  return (
                    <td key={dayKey} className="border-b border-white/8 px-1 py-1.5">
                      <input
                        className="focus:border-frosted-mint-600 h-9 w-full rounded-md border border-white/12 bg-[#111710] px-2 text-center font-mono text-sm text-slate-200 outline-none placeholder:text-slate-600"
                        defaultValue={value}
                        placeholder="-"
                        aria-label={`${row.projectName} ${format(day, "EEE")}`}
                        disabled={Boolean(bucket?.ms) || createMutation.isPending}
                        onBlur={(event) => {
                          if (event.target.value !== value) {
                            void commitCell(row, day, event.target.value);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            (event.target as HTMLInputElement).blur();
                          }
                        }}
                      />
                    </td>
                  );
                })}
                <td className="border-b border-white/8 px-2 py-2 text-right font-mono text-slate-300">
                  {formatHoursLabel(row.totalMs)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky left-0 bg-[#141a13] px-2 py-3 text-xs font-bold tracking-wider text-slate-400 uppercase">
                Total
              </td>
              {weekDays.map((day) => {
                const dayKey = formatInTimeZone(day, me.member.timezone, "yyyy-MM-dd");
                return (
                  <td
                    key={dayKey}
                    className="px-1 py-3 text-center font-mono text-xs text-slate-400"
                  >
                    {formatHoursLabel(dayTotals.get(dayKey) ?? 0)}
                  </td>
                );
              })}
              <td className="px-2 py-3 text-right font-mono text-sm font-bold text-slate-200">
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
                key: `draft-${Date.now()}`,
                projectId: projects.data?.projects[0]?.id ?? "",
                description: "",
              },
            ])
          }
        >
          <Plus size={14} /> Add row
        </Button>
        {draftRows.length ? (
          <select
            className="h-8 rounded-md border border-white/12 bg-[#111710] px-2 text-xs text-slate-200"
            value={draftRows[draftRows.length - 1]?.projectId ?? ""}
            onChange={(event) =>
              setDraftRows((current) => {
                const next = [...current];
                const last = next[next.length - 1];
                if (!last) return current;
                next[next.length - 1] = { ...last, projectId: event.target.value };
                return next;
              })
            }
            aria-label="Draft row project"
          >
            <option value="">Without project</option>
            {(projects.data?.projects ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </section>
  );
}
