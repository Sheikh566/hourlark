import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { ArrowUp, Tags, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { overlapDuration } from "@/domain/dates/time";
import { useMe } from "@/web/app/context";
import { Button, ErrorState, Modal, Select } from "@/web/components/ui";
import { projectTextColor } from "@/web/features/time/calendar-config";
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
  const [sortAscending, setSortAscending] = useState(true);
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
      const key = projectId ?? "none";
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
    const fromEntries = [...map.values()];
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
    return [...fromEntries, ...drafts].sort(
      (left, right) => (sortAscending ? 1 : -1) * left.projectName.localeCompare(right.projectName),
    );
  }, [draftRows, entries.data?.entries, dayRanges, now, projects.data?.projects, sortAscending]);

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
        description: "",
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
    <section
      aria-label="Weekly timesheet view"
      className="bg-surface min-h-[calc(100vh-220px)] max-w-full min-w-0"
    >
      {(entries.data?.entries.length ?? 0) >= TIME_ENTRY_LIST_LIMIT ? (
        <p role="status" className="p-3 text-sm text-amber-300">
          This week reached the 5,000-entry limit. Totals may be incomplete; use reports for the
          full history.
        </p>
      ) : null}
      {projects.error || tags.error ? (
        <p role="alert" className="text-error-fg p-3 text-sm">
          {projects.error?.message ?? tags.error?.message}
        </p>
      ) : null}
      <div
        className="max-w-full min-w-0 overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Weekly timesheet"
      >
        <table className="bg-surface w-full min-w-[1000px] table-fixed border-separate border-spacing-0 text-sm leading-[14px] [box-shadow:inset_0_-1px_0_var(--color-stroke)]">
          <colgroup>
            <col className="w-[25.75%]" />
            <col className="w-[12.875%]" />
            {weekDays.map((day) => (
              <col key={day} />
            ))}
            <col className="w-[116.3px]" />
            <col className="w-[58px]" />
          </colgroup>
          <thead>
            <tr className="text-fg-subtle text-[11px] leading-[11px] font-semibold uppercase [&>th]:h-[50px] [&>th]:cursor-default [&>th]:px-[10px] [&>th]:py-0 [&>th]:font-semibold [&>th]:[box-shadow:inset_0_-1px_0_var(--color-stroke)]">
              <th
                className="!pl-5 text-left"
                aria-sort={sortAscending ? "ascending" : "descending"}
              >
                <button
                  type="button"
                  aria-label="Sort by project"
                  className="text-accent-fg hover:bg-surface-hover -ml-1.5 flex items-center gap-1 rounded-lg px-1 py-0.5 text-left font-semibold tracking-[0.44px] uppercase"
                  onClick={() => setSortAscending((value) => !value)}
                >
                  <span className="text-fg-subtle leading-[16.06px]">Project</span>
                  <ArrowUp
                    width={16}
                    height={12}
                    className={sortAscending ? "" : "rotate-180"}
                    aria-hidden="true"
                  />
                </button>
              </th>
              <th className="text-center" aria-label="Entry details" />
              {weekDays.map((day) => (
                <th key={day} className="text-center">
                  {dayLabel(day)}
                </th>
              ))}
              <th className="text-right">Total</th>
              <th className="text-center" aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isDraft = draftRows.some((draft) => draft.key === row.key);
              const rowEntries = [
                ...new Map(
                  [...row.byDay.values()]
                    .flatMap((bucket) => bucket.entries)
                    .map((entry) => [entry.id, entry]),
                ).values(),
              ];
              const editDetails = () =>
                rowEntries.length === 1
                  ? setEditingEntry(rowEntries[0] ?? null)
                  : setChoosingEntries(rowEntries);
              return (
                <tr key={row.key} className="group hover:bg-surface-hover">
                  <td className="h-[50px] py-0 pr-[10px] pl-5 [box-shadow:inset_0_-1px_0_var(--color-stroke)]">
                    <div className="flex min-w-0 items-center gap-[10px]">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: row.projectColor ?? "#666" }}
                      />
                      <span
                        className="truncate text-sm font-medium"
                        style={{
                          color: row.projectColor ? projectTextColor(row.projectColor) : "#666",
                        }}
                      >
                        {row.projectName}
                      </span>
                    </div>
                  </td>
                  <td className="h-[50px] px-[10px] py-0 [box-shadow:inset_0_-1px_0_var(--color-stroke)]">
                    {!isDraft ? (
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          type="button"
                          className="text-fg-secondary hover:bg-surface-hover grid size-[30px] place-items-center rounded-lg"
                          aria-label={`Edit tags for ${row.projectName}`}
                          onClick={editDetails}
                        >
                          <Tags size={17} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="text-fg-secondary hover:bg-surface-hover grid size-[30px] place-items-center rounded-lg"
                          aria-label={`Edit billing for ${row.projectName}`}
                          onClick={editDetails}
                        >
                          $
                        </button>
                      </div>
                    ) : null}
                  </td>
                  {weekDays.map((day) => {
                    const dayKey = day;
                    const bucket = row.byDay.get(dayKey);
                    const value = bucket?.ms ? formatCompactDuration(bucket.ms) : "";
                    return (
                      <td
                        key={dayKey}
                        className="h-[50px] px-[10px] py-0 text-center [box-shadow:inset_0_-1px_0_var(--color-stroke)]"
                      >
                        {bucket?.entries.length ? (
                          <button
                            type="button"
                            className="border-control bg-surface-raised text-fg box-border h-6 w-[65px] rounded-lg border px-2 text-center text-sm leading-5 font-medium tabular-nums focus:bg-[#555] focus-visible:shadow-none focus-visible:outline-none"
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
                            className="border-control bg-surface-raised text-fg box-border h-6 w-[65px] rounded-lg border px-2 text-center text-sm leading-5 font-medium tabular-nums outline-none placeholder:text-transparent focus:bg-[#555] focus-visible:shadow-none focus-visible:outline-none"
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
                  <td className="bg-surface-raised text-fg h-[50px] px-[10px] py-0 text-right text-sm font-medium whitespace-nowrap tabular-nums [box-shadow:inset_0_-1px_0_var(--color-stroke)]">
                    {formatHoursLabel(row.totalMs)}
                  </td>
                  <td className="h-[50px] px-[10px] py-0 [box-shadow:inset_0_-1px_0_var(--color-stroke)]">
                    {isDraft ? (
                      <button
                        type="button"
                        aria-label="Remove draft row"
                        disabled={createMutation.isPending}
                        className="text-fg-secondary grid size-[30px] place-items-center rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() =>
                          setDraftRows((current) =>
                            current.filter((draft) => draft.key !== row.key),
                          )
                        }
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td className="h-[50px] py-0 pr-[5px] pl-5 leading-[normal] [box-shadow:inset_0_-1px_0_var(--color-stroke)]">
                <Select
                  aria-label="Add row"
                  value=""
                  placeholder="Add row"
                  icon={
                    <span className="text-accent-fg text-center font-semibold whitespace-nowrap">
                      +
                    </span>
                  }
                  className="data-[placeholder]:text-fg h-5 w-auto gap-1 border-0 bg-transparent p-0 text-center [&>svg:last-child]:hidden"
                  disabled={createMutation.isPending}
                  options={[
                    {
                      value: "none",
                      label: "Without project",
                      disabled: rows.some((row) => row.projectId === null),
                    },
                    ...(projects.data?.projects ?? []).map((project) => ({
                      value: project.id,
                      label: project.name,
                      color: project.color,
                      disabled: rows.some((row) => row.projectId === project.id),
                    })),
                  ]}
                  onValueChange={(value) =>
                    setDraftRows((current) => [
                      ...current,
                      {
                        key: `draft-${crypto.randomUUID()}`,
                        projectId: value === "none" ? "" : value,
                        description: "",
                      },
                    ])
                  }
                />
              </td>
              <td className="[box-shadow:inset_0_-1px_0_var(--color-stroke)]" />
              {weekDays.map((day) => (
                <td key={day} className="[box-shadow:inset_0_-1px_0_var(--color-stroke)]" />
              ))}
              <td className="bg-surface-raised [box-shadow:inset_0_-1px_0_var(--color-stroke)]" />
              <td className="[box-shadow:inset_0_-1px_0_var(--color-stroke)]" />
            </tr>
          </tbody>
          <tfoot>
            <tr className="bg-surface-raised text-fg text-sm leading-[normal] font-medium [&>td]:h-[50px] [&>td]:px-[10px] [&>td]:py-0">
              <td />
              <td className="text-right uppercase">Total</td>
              {weekDays.map((day) => (
                <td key={day} className="text-center tabular-nums">
                  {dayTotals.get(day) ? formatHoursLabel(dayTotals.get(day) ?? 0) : "-"}
                </td>
              ))}
              <td className="text-right tabular-nums">{formatHoursLabel(grandTotal)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
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
