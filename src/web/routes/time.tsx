import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, getISOWeek } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Copy, MoreHorizontal, Play, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { useMe } from "@/web/app/context";
import { overlapDuration } from "@/domain/dates/time";
import { Button, EmptyState, ErrorState, Select } from "@/web/components/ui";
import { InlineEntryEditor, type InlineEditorField } from "@/web/features/time/inline-entry-editor";
import { DateRangePopover, TimeEntryListCapWarning } from "@/web/features/timer/date-range-popover";
import {
  ALL_DATES_SELECTION,
  addCalendarDays,
  exclusiveEndIso,
  listPeriodLabel,
  localCalendarDate,
  selectionFromPreset,
  shiftSelection,
  startOfWeekDate,
  TIME_ENTRY_LIST_LIMIT,
  toApiRange,
  weekStartFromWorkspace,
  zonedDayStartIso,
  zonedToday,
} from "@/web/features/timer/list-date-range";
import {
  groupSessionsByDay,
  latestSession,
  sessionGroupBounds,
  sessionGroupDuration,
} from "@/web/features/timer/session-groups";
import { CalendarView } from "@/web/routes/calendar";
import { TimerToolbar, type TimerView } from "@/web/features/timer/timer-toolbar";
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

function ListEntryRow({
  rowId,
  entry,
  timezone,
  durationMs,
  running,
  startedAt,
  stoppedAt,
  selected,
  indeterminate = false,
  onToggleSelected,
  selectLabel,
  count,
  expanded,
  onToggleCount,
  panelId,
  onDescriptionClick,
  onProjectClick,
  onTagsClick,
  onTimeClick,
  descriptionTitle,
  projectTitle,
  timeTitle,
  timeAriaLabel,
  onContinue,
  continueLabel,
  continuePending,
  actionsPending,
  showMore,
  moreOpen,
  onToggleMore,
  onDuplicate,
  onDelete,
  nested = false,
}: {
  rowId?: string;
  entry: TimeEntry;
  timezone: string;
  durationMs: number;
  running: boolean;
  startedAt: string;
  stoppedAt: string | null;
  selected: boolean;
  indeterminate?: boolean;
  onToggleSelected: () => void;
  selectLabel: string;
  count?: number;
  expanded?: boolean;
  onToggleCount?: () => void;
  panelId?: string;
  onDescriptionClick: () => void;
  onProjectClick: () => void;
  onTagsClick: () => void;
  onTimeClick: () => void;
  descriptionTitle: string;
  projectTitle: string;
  timeTitle: string;
  timeAriaLabel: string;
  onContinue: () => void;
  continueLabel: string;
  continuePending: boolean;
  actionsPending: boolean;
  showMore: boolean;
  moreOpen: boolean;
  onToggleMore?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  nested?: boolean;
}) {
  const startLabel = formatInTimeZone(startedAt, timezone, "h:mm a");
  const stopLabel =
    running || !stoppedAt ? "running" : formatInTimeZone(stoppedAt, timezone, "h:mm a");
  const matchLabel = entry.description || "time entry";

  return (
    <article
      id={rowId}
      className={`group grid min-h-[50px] min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-[#3b3b3b] px-5 py-3 transition hover:bg-white/[0.03] lg:h-[50px] lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,auto)_minmax(190px,auto)_auto] lg:py-0 ${
        running ? "bg-[#382b16]/35" : ""
      } ${nested ? "bg-[#1b1b1b]/35 pl-8 lg:pl-12" : ""}`}
    >
      <div className="row-span-3 flex items-center gap-1.5 lg:row-span-1">
        <input
          type="checkbox"
          disabled={actionsPending}
          checked={selected}
          ref={(node) => {
            if (node) node.indeterminate = indeterminate;
          }}
          onChange={onToggleSelected}
          aria-label={selectLabel}
        />
        {count != null && onToggleCount ? (
          <button
            type="button"
            className="grid h-7 min-w-7 shrink-0 place-items-center rounded-md bg-[#382b16] px-1.5 text-xs font-bold text-[#fbbf24] hover:bg-[#48361b]"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggleCount}
            aria-label={
              expanded
                ? `Hide ${count} matching sessions for ${matchLabel}`
                : `Show ${count} matching sessions for ${matchLabel}`
            }
          >
            {count}
          </button>
        ) : null}
      </div>
      <div className="col-span-2 flex min-w-0 items-center gap-3 lg:col-span-1">
        <button
          type="button"
          className={`max-w-[58%] min-w-0 shrink truncate rounded-sm text-left text-sm ${
            entry.description
              ? "font-medium text-[#fafafa] hover:text-[#fbbf24]"
              : "text-[#a4a4a4] hover:text-[#fafafa]"
          }`}
          onClick={onDescriptionClick}
          title={descriptionTitle}
        >
          {entry.description || "Add description"}
        </button>
        <button
          type="button"
          className="flex max-w-[42%] min-w-0 shrink items-center gap-2 rounded-sm text-left text-sm"
          onClick={onProjectClick}
          title={projectTitle}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-[#a4a4a4]"
            style={entry.project?.color ? { backgroundColor: entry.project.color } : undefined}
          />
          <span className="min-w-0 truncate">
            <span
              style={
                entry.project?.color
                  ? { color: `color-mix(in srgb, ${entry.project.color} 45%, #fafafa)` }
                  : undefined
              }
              className={entry.project?.name ? "" : "text-[#a4a4a4]"}
            >
              {entry.project?.name ?? "+ Add project"}
            </span>
            {entry.client?.name ? (
              <span className="text-[#a4a4a4]"> {entry.client.name}</span>
            ) : null}
          </span>
        </button>
      </div>
      <div className="col-span-2 min-w-0 lg:col-span-1">
        {entry.tags.length ? (
          <button
            type="button"
            className="max-w-full truncate text-left text-sm text-[#a4a4a4]"
            onClick={onTagsClick}
            aria-label={
              count != null
                ? `Show tags for ${count} matching sessions`
                : `Edit tags for ${matchLabel}`
            }
          >
            {entry.tags.map((tag) => tag.name).join(", ")}
          </button>
        ) : (
          <button
            type="button"
            className="text-sm text-[#a4a4a4]/50 hover:text-[#a4a4a4]"
            onClick={onTagsClick}
            aria-label={
              count != null
                ? `Show tags for ${count} matching sessions`
                : `Edit tags for ${matchLabel}`
            }
          >
            —
          </button>
        )}
      </div>
      <button
        type="button"
        className="min-w-0 rounded-sm text-left text-xs text-[#a4a4a4] lg:text-right"
        onClick={onTimeClick}
        title={timeTitle}
        aria-label={timeAriaLabel}
      >
        <span>
          {startLabel} – {stopLabel}
        </span>
        <strong className={`ml-3 text-sm ${running ? "text-[#fbbf24]" : "text-[#fafafa]"}`}>
          {formatClockDuration(durationMs)}
        </strong>
      </button>
      <div className="flex justify-end gap-0.5 transition group-hover:opacity-100 focus-within:opacity-100 lg:opacity-0">
        <Button
          variant="ghost"
          className="h-8 w-8 p-0"
          disabled={actionsPending || continuePending}
          onClick={onContinue}
          title="Continue"
          aria-label={continueLabel}
        >
          <Play size={14} />
        </Button>
        {showMore ? (
          <div className="relative" data-entry-menu={entry.id}>
            <button
              type="button"
              disabled={actionsPending}
              aria-expanded={moreOpen}
              onClick={onToggleMore}
              aria-label="More actions"
              className="grid h-8 w-8 list-none place-items-center rounded-lg text-[#a4a4a4] hover:bg-white/7 hover:text-[#fafafa] [&::-webkit-details-marker]:hidden"
            >
              <MoreHorizontal size={14} />
              <span className="sr-only">More actions</span>
            </button>
            {moreOpen ? (
              <div className="timer-popover absolute top-9 right-0 z-20 w-40 p-1">
                {!entry.running ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-[#fafafa] hover:bg-white/8"
                    disabled={actionsPending}
                    onClick={onDuplicate}
                  >
                    <Copy size={13} /> Duplicate
                  </button>
                ) : null}
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-red-300 hover:bg-white/8"
                  disabled={actionsPending}
                  onClick={onDelete}
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function TimePage() {
  const me = useMe();
  const now = useNow();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseView(searchParams.get("view"));
  const localToday = () => localCalendarDate(zonedToday(new Date(), me.member.timezone));
  const [anchor, setAnchor] = useState(localToday);
  const [memberId, setMemberId] = useState(me.member.id);
  const [editingTarget, setEditingTarget] = useState<{
    id: string;
    field: InlineEditorField;
  } | null>(null);
  const [undoEntries, setUndoEntries] = useState<TimeEntry[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [calendarMode, setCalendarMode] = useState<"week" | "day">("week");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [listSelection, setListSelection] = useState(ALL_DATES_SELECTION);
  const [rangeOpen, setRangeOpen] = useState(false);
  const periodButtonRef = useRef<HTMLButtonElement>(null);

  const weekStartsOn = me.workspace.week_start === "monday" ? 1 : 0;
  const listWeekStartsOn = weekStartFromWorkspace(me.workspace.week_start);
  const anchorDate = format(anchor, "yyyy-MM-dd");
  const weekStartDate = startOfWeekDate(anchorDate, weekStartsOn);
  const weekStart = localCalendarDate(weekStartDate);
  const todayKey = formatInTimeZone(new Date(now), me.member.timezone, "yyyy-MM-dd");

  const setView = (next: TimerView) => {
    const params = new URLSearchParams(searchParams);
    if (next === "list") params.delete("view");
    else params.set("view", next);
    setSearchParams(params, { replace: true });
    setRangeOpen(false);
    setOpenMenuId(null);
  };

  const listClock = new Date(now);
  const listRange = toApiRange(listSelection, listClock, me.member.timezone);

  useEffect(() => {
    setSelectedIds(new Set());
    setEditingTarget(null);
    setOpenMenuId(null);
    setExpandedGroups(new Set());
  }, [memberId, listRange.start, listRange.end]);

  const totalsWeekStart =
    view === "list"
      ? startOfWeekDate(zonedToday(new Date(now), me.member.timezone), weekStartsOn)
      : weekStartDate;
  const weekRange = {
    start: zonedDayStartIso(totalsWeekStart, me.member.timezone),
    end: exclusiveEndIso(addCalendarDays(totalsWeekStart, 6), me.member.timezone),
  };

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
        limit: String(TIME_ENTRY_LIST_LIMIT),
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
        limit: String(TIME_ENTRY_LIST_LIMIT),
        ...(me.permissions.view_team ? { member_id: memberId } : {}),
      });
      return apiRequest<{ entries: TimeEntry[] }>(`/time-entries?${params}`);
    },
  });

  const durationFor = (entry: TimeEntry) =>
    entry.running ? Math.max(0, now - new Date(entry.started_at).getTime()) : entry.duration_ms;

  const durationWithin = (entry: TimeEntry, start: string, end: string) =>
    overlapDuration(
      Date.parse(entry.started_at),
      entry.stopped_at ? Date.parse(entry.stopped_at) : now,
      Date.parse(start),
      Date.parse(end),
    );
  const todayStart = zonedDayStartIso(todayKey, me.member.timezone);
  const todayEnd = zonedDayStartIso(addCalendarDays(todayKey, 1), me.member.timezone);
  const todayTotal = (weekEntries.data?.entries ?? []).reduce(
    (sum, entry) => sum + durationWithin(entry, todayStart, todayEnd),
    0,
  );
  const weekTotal = (weekEntries.data?.entries ?? []).reduce(
    (sum, entry) => sum + durationWithin(entry, weekRange.start, weekRange.end),
    0,
  );

  const changeDeletedState = async (entry: TimeEntry, restore: boolean) => {
    const path = `/time-entries/${entry.id}${restore ? "/restore" : ""}`;
    const options = restore ? { method: "POST", body: "{}" } : { method: "DELETE" };
    try {
      await apiRequest(path, options);
    } catch (error) {
      if (!(error instanceof ApiClientError) || error.code !== "override_reason_required")
        throw error;
      const reason = window.prompt("This entry is locked. Enter an audit reason to override:");
      if (!reason?.trim()) throw error;
      await apiRequest(`${path}?override_reason=${encodeURIComponent(reason.trim())}`, options);
    }
  };
  const changeEntries = async (targets: TimeEntry[], restore: boolean) => {
    setActionError(null);
    const succeeded: TimeEntry[] = [];
    const errors: string[] = [];
    for (const entry of targets) {
      try {
        await changeDeletedState(entry, restore);
        succeeded.push(entry);
      } catch (error) {
        errors.push(
          `${entry.description || "Time entry"}: ${error instanceof Error ? error.message : "Request failed"}`,
        );
      }
    }
    if (succeeded.length) {
      const ids = new Set(succeeded.map((entry) => entry.id));
      setUndoEntries((current) =>
        restore
          ? current.filter((entry) => !ids.has(entry.id))
          : [...current.filter((entry) => !ids.has(entry.id)), ...succeeded],
      );
      setSelectedIds((current) => new Set([...current].filter((id) => !ids.has(id))));
      setEditingTarget((current) => (current && ids.has(current.id) ? null : current));
      if (succeeded.some((entry) => entry.running)) broadcastTimerChange();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
        ...(succeeded.some((entry) => entry.running)
          ? [queryClient.invalidateQueries({ queryKey: ["timer"] })]
          : []),
      ]);
    }
    if (errors.length) setActionError(errors.join("; "));
  };
  const deleteMutation = useMutation({
    mutationFn: (targets: TimeEntry[]) => changeEntries(targets, false),
  });
  const restoreMutation = useMutation({
    mutationFn: (targets: TimeEntry[]) => changeEntries(targets, true),
  });
  const actionsPending = deleteMutation.isPending || restoreMutation.isPending;

  useEffect(() => {
    if (!openMenuId) return;
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(`[data-entry-menu="${openMenuId}"]`)
      )
        setOpenMenuId(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        document
          .querySelector<HTMLButtonElement>(`[data-entry-menu="${openMenuId}"] button`)
          ?.focus();
        setOpenMenuId(null);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [openMenuId]);
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
          tag_ids: entry.tags.filter((tag) => tag.status === "active").map((tag) => tag.id),
          started_at: entry.started_at,
          stopped_at: entry.stopped_at ?? new Date().toISOString(),
          billable:
            (me.workspace.members_can_set_billable || me.member.role !== "member") &&
            entry.billable,
        }),
      }),
    onSuccess: async ({ entry }) => {
      await queryClient.invalidateQueries({ queryKey: ["time-entries"] });
      setEditingTarget({ id: entry.id, field: "description" });
    },
  });

  const grouped = useMemo(
    () => groupSessionsByDay(entries.data?.entries ?? [], me.member.timezone),
    [entries.data, me.member.timezone],
  );

  const expandGroup = (key: string) => {
    setExpandedGroups((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  };

  const toggleGroupExpanded = (key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const periodLabel =
    view === "list"
      ? listPeriodLabel(listSelection)
      : view === "calendar" && calendarMode === "day"
        ? format(anchor, "EEE, d MMM yyyy")
        : `${format(weekStart, "d MMM")} – ${format(localCalendarDate(addCalendarDays(weekStartDate, 6)), "d MMM yyyy")} · W${getISOWeek(weekStart)}`;
  const applyListPreset = (preset: "today" | "this_week" | "all") => {
    setListSelection(selectionFromPreset(preset, listClock, me.member.timezone, listWeekStartsOn));
    setRangeOpen(false);
  };

  const onPrevious = () => {
    if (view === "list") {
      setListSelection((current) =>
        shiftSelection(current, -1, listClock, me.member.timezone, listWeekStartsOn),
      );
      return;
    }
    setAnchor(
      localCalendarDate(
        addCalendarDays(anchorDate, view === "calendar" && calendarMode === "day" ? -1 : -7),
      ),
    );
  };
  const onNext = () => {
    if (view === "list") {
      setListSelection((current) =>
        shiftSelection(current, 1, listClock, me.member.timezone, listWeekStartsOn),
      );
      return;
    }
    setAnchor(
      localCalendarDate(
        addCalendarDays(anchorDate, view === "calendar" && calendarMode === "day" ? 1 : 7),
      ),
    );
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
        onPeriodClick={
          view === "list"
            ? () => setRangeOpen((current) => !current)
            : () => setAnchor(localToday())
        }
        previousDisabled={view === "list" && listSelection.preset === "all"}
        nextDisabled={view === "list" && listSelection.preset === "all"}
        showTodayTotal={view === "list"}
        todayTotal={formatClockDuration(todayTotal)}
        weekTotal={formatClockDuration(weekTotal)}
        periodTitle={view === "list" ? "Choose date range" : "Jump to current period"}
        periodButtonRef={periodButtonRef}
        periodExpanded={rangeOpen}
        periodPopover={
          view === "list" ? (
            <DateRangePopover
              open={rangeOpen}
              timezone={me.member.timezone}
              weekStartsOn={listWeekStartsOn}
              value={listSelection}
              now={listClock}
              onChange={setListSelection}
              onClose={(restoreFocus) => {
                setRangeOpen(false);
                if (restoreFocus) periodButtonRef.current?.focus();
              }}
              triggerRef={periodButtonRef}
            />
          ) : null
        }
        onTodayClick={view === "list" ? () => applyListPreset("today") : undefined}
        onWeekClick={view === "list" ? () => applyListPreset("this_week") : undefined}
        trailing={
          <>
            {view === "calendar" ? (
              <Select
                className="h-7 min-h-7 w-28 text-xs"
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
                className="h-7 min-h-7 w-auto max-w-[10rem] min-w-0 text-xs"
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

      {view === "calendar" ? (
        <CalendarView
          weekStart={calendarMode === "day" ? anchor : weekStart}
          memberId={memberId}
          calendarMode={calendarMode}
        />
      ) : null}
      {view === "timesheet" ? (
        <TimesheetView weekStart={weekStartDate} memberId={memberId} />
      ) : null}
      {view === "list" ? (
        <section className="min-w-0 bg-[#212121]">
          <TimeEntryListCapWarning entryCount={entries.data?.entries.length ?? 0} />
          {selectedIds.size > 0 ? (
            <div
              className="flex flex-wrap items-center gap-3 border-b border-[#3b3b3b] px-5 py-3"
              aria-label="Selected entries actions"
            >
              <span className="text-sm">{selectedIds.size} selected</span>
              <Button
                disabled={actionsPending}
                onClick={() =>
                  deleteMutation.mutate(
                    (entries.data?.entries ?? []).filter((entry) => selectedIds.has(entry.id)),
                  )
                }
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete selected"}
              </Button>
              <Button
                variant="secondary"
                disabled={actionsPending}
                onClick={() => setSelectedIds(new Set())}
              >
                Clear selection
              </Button>
            </div>
          ) : null}
          {entries.isLoading ? (
            <div className="space-y-0">
              {[1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-[50px] animate-pulse border-b border-[#3b3b3b] bg-white/5"
                />
              ))}
            </div>
          ) : entries.error ? (
            <div className="p-4">
              <ErrorState message={entries.error.message} onRetry={() => void entries.refetch()} />
            </div>
          ) : grouped.length === 0 ? (
            <EmptyState
              title="No entries in the selected period"
              description="Nothing was tracked in this date range. Choose a different period or view the full history in reports."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {listSelection.preset !== "all" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => applyListPreset("all")}
                    >
                      Show all dates
                    </Button>
                  ) : null}
                  <Link
                    to="/reports"
                    className="inline-flex h-9 items-center rounded-lg border border-[#3b3b3b] bg-[#382b16] px-3 text-sm font-semibold text-[#fbbf24] hover:bg-[#48361b]"
                  >
                    View full history in reports
                  </Link>
                </div>
              }
            />
          ) : (
            grouped.map(({ day, groups }) => {
              const dayEntries = groups.flatMap((group) => group.entries);
              const dayTotal = sessionGroupDuration(dayEntries, now);
              const isToday = day === todayKey;
              const selectedInDay = dayEntries.filter((entry) => selectedIds.has(entry.id)).length;
              const allSelected = selectedInDay === dayEntries.length && dayEntries.length > 0;
              const someSelected = selectedInDay > 0 && !allSelected;
              return (
                <section key={day} aria-labelledby={`day-${day}`}>
                  <div className="flex h-[50px] items-center gap-3 border-y border-[#3b3b3b] bg-[#212121] px-5">
                    <input
                      type="checkbox"
                      disabled={actionsPending}
                      checked={allSelected}
                      ref={(node) => {
                        if (node) node.indeterminate = someSelected;
                      }}
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
                    <h2 id={`day-${day}`} className="flex-1 text-sm font-bold text-[#fafafa]">
                      {isToday
                        ? "Today"
                        : formatInTimeZone(`${day}T12:00:00Z`, me.member.timezone, "EEE, d MMM")}
                    </h2>
                    <span className="font-mono text-sm font-semibold text-[#fafafa]">
                      {formatClockDuration(dayTotal)}
                    </span>
                  </div>
                  {groups.flatMap((group) => {
                    const representative = group.entries[0];
                    if (!representative) return [];
                    const multi = group.entries.length > 1;
                    const editingHere = group.entries.some(
                      (entry) => entry.id === editingTarget?.id,
                    );
                    const expanded = !multi || expandedGroups.has(group.key) || editingHere;
                    const selectedCount = group.entries.filter((entry) =>
                      selectedIds.has(entry.id),
                    ).length;
                    const bounds = sessionGroupBounds(group.entries);
                    const matchLabel = representative.description || "time entry";
                    const renderEntry = (entry: TimeEntry, nested: boolean) =>
                      editingTarget?.id === entry.id ? (
                        <div key={entry.id} id={`time-entry-${entry.id}`}>
                          <InlineEntryEditor
                            entry={entry}
                            projects={projects.data?.projects ?? []}
                            tags={tags.data?.tags ?? []}
                            initialField={editingTarget.field}
                            onCancel={() => setEditingTarget(null)}
                            onSaved={() => setEditingTarget(null)}
                          />
                        </div>
                      ) : (
                        <ListEntryRow
                          key={entry.id}
                          rowId={`time-entry-${entry.id}`}
                          entry={entry}
                          timezone={me.member.timezone}
                          durationMs={durationFor(entry)}
                          running={entry.running}
                          startedAt={entry.started_at}
                          stoppedAt={entry.stopped_at}
                          selected={selectedIds.has(entry.id)}
                          onToggleSelected={() => toggleSelected(entry.id)}
                          selectLabel={`Select ${entry.description || "time entry"}`}
                          onDescriptionClick={() =>
                            setEditingTarget({ id: entry.id, field: "description" })
                          }
                          onProjectClick={() =>
                            setEditingTarget({ id: entry.id, field: "project" })
                          }
                          onTagsClick={() => setEditingTarget({ id: entry.id, field: "tags" })}
                          onTimeClick={() => setEditingTarget({ id: entry.id, field: "time" })}
                          descriptionTitle="Edit description"
                          projectTitle={
                            entry.project?.name
                              ? `${entry.project.name}${entry.client?.name ? ` • ${entry.client.name}` : ""}`
                              : "Edit project"
                          }
                          timeTitle="Edit date, times, and duration"
                          timeAriaLabel={`${entry.description || "Time entry"}, ${formatInTimeZone(entry.started_at, me.member.timezone, "h:mm a")} to ${
                            entry.stopped_at
                              ? formatInTimeZone(entry.stopped_at, me.member.timezone, "h:mm a")
                              : "running"
                          }, ${formatClockDuration(durationFor(entry))}`}
                          onContinue={() => continueMutation.mutate(entry)}
                          continueLabel="Continue time entry"
                          continuePending={continueMutation.isPending}
                          actionsPending={actionsPending || duplicateMutation.isPending}
                          showMore
                          moreOpen={openMenuId === entry.id}
                          onToggleMore={() =>
                            setOpenMenuId((current) => (current === entry.id ? null : entry.id))
                          }
                          onDuplicate={() => {
                            setOpenMenuId(null);
                            duplicateMutation.mutate(entry);
                          }}
                          onDelete={() => {
                            setOpenMenuId(null);
                            deleteMutation.mutate([entry]);
                          }}
                          nested={nested}
                        />
                      );

                    if (!multi) return [renderEntry(representative, false)];

                    const groupDuration = sessionGroupDuration(group.entries, now);
                    const startLabel = formatInTimeZone(
                      bounds.startedAt,
                      me.member.timezone,
                      "h:mm a",
                    );
                    const stopLabel = bounds.running
                      ? "running"
                      : bounds.stoppedAt
                        ? formatInTimeZone(bounds.stoppedAt, me.member.timezone, "h:mm a")
                        : "running";
                    const nodes = [
                      <ListEntryRow
                        key={`group-${group.entries
                          .map((entry) => entry.id)
                          .slice()
                          .sort()
                          .join("-")}`}
                        entry={representative}
                        timezone={me.member.timezone}
                        durationMs={groupDuration}
                        running={bounds.running}
                        startedAt={bounds.startedAt}
                        stoppedAt={bounds.stoppedAt}
                        selected={selectedCount === group.entries.length}
                        indeterminate={selectedCount > 0 && selectedCount < group.entries.length}
                        onToggleSelected={() => {
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            const selectAll = selectedCount !== group.entries.length;
                            for (const entry of group.entries) {
                              if (selectAll) next.add(entry.id);
                              else next.delete(entry.id);
                            }
                            return next;
                          });
                        }}
                        selectLabel={`Select ${group.entries.length} matching sessions for ${matchLabel}`}
                        count={group.entries.length}
                        expanded={expanded}
                        onToggleCount={() => toggleGroupExpanded(group.key)}
                        panelId={group.entries.map((entry) => `time-entry-${entry.id}`).join(" ")}
                        onDescriptionClick={() => expandGroup(group.key)}
                        onProjectClick={() => expandGroup(group.key)}
                        onTagsClick={() => expandGroup(group.key)}
                        onTimeClick={() => expandGroup(group.key)}
                        descriptionTitle="Show matching sessions"
                        projectTitle={
                          representative.project?.name
                            ? `${representative.project.name}${representative.client?.name ? ` • ${representative.client.name}` : ""}`
                            : "Show matching sessions"
                        }
                        timeTitle="Show matching sessions"
                        timeAriaLabel={`${matchLabel}, ${group.entries.length} sessions, ${startLabel} to ${stopLabel}, ${formatClockDuration(groupDuration)}`}
                        onContinue={() => {
                          const latest = latestSession(group.entries);
                          if (latest) continueMutation.mutate(latest);
                        }}
                        continueLabel="Continue latest matching session"
                        continuePending={continueMutation.isPending}
                        actionsPending={actionsPending}
                        showMore={false}
                        moreOpen={false}
                      />,
                    ];
                    if (expanded) {
                      nodes.push(...group.entries.map((entry) => renderEntry(entry, true)));
                    }
                    return nodes;
                  })}
                </section>
              );
            })
          )}
          <div className="flex justify-center py-8">
            <Link
              to="/reports"
              className="inline-flex h-8 items-center rounded-full border border-[#3b3b3b] bg-[#382b16] px-4 text-sm font-medium text-[#fbbf24] hover:bg-[#48361b]"
            >
              View full history in reports
            </Link>
          </div>
        </section>
      ) : null}

      {actionError || continueMutation.error || duplicateMutation.error ? (
        <p role="alert" className="mx-4 my-3 rounded-lg bg-red-950 p-3 text-sm text-red-200">
          {actionError ?? continueMutation.error?.message ?? duplicateMutation.error?.message}
        </p>
      ) : null}
      {undoEntries.length > 0 ? (
        <div className="fixed right-4 bottom-4 z-30 flex items-center gap-3 rounded-xl border border-[#3b3b3b] bg-[#212121] px-4 py-3 text-sm text-[#fafafa] shadow-xl">
          {undoEntries.length === 1 ? "Entry deleted." : `${undoEntries.length} entries deleted.`}
          <Button
            variant="accent"
            className="min-h-8 py-1"
            disabled={actionsPending}
            onClick={() => restoreMutation.mutate(undoEntries)}
          >
            <RotateCcw size={14} /> Undo
          </Button>
        </div>
      ) : null}
    </>
  );
}
