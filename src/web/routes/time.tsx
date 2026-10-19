import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, getISOWeek } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { useMe } from "@/web/app/context";
import { overlapDuration } from "@/domain/dates/time";
import {
  Button,
  EmptyState,
  ErrorState,
  Select,
  useToast,
  type RowMenuItem,
} from "@/web/components/ui";
import { InlineEntryEditor, type InlineEditorField } from "@/web/features/time/inline-entry-editor";
import { EntryCheckbox, ListEntryRow } from "@/web/features/time/list-entry-row";
import { DateRangePopover, TimeEntryListCapWarning } from "@/web/features/timer/date-range-popover";
import {
  ALL_DATES_SELECTION,
  addCalendarDays,
  exclusiveEndIso,
  listPeriodLabel,
  localCalendarDate,
  selectionFromPreset,
  selectionWeekLabel,
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
import { CALENDAR_MODES, type CalendarMode } from "@/web/features/time/calendar-config";
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

export function TimePage() {
  const me = useMe();
  const now = useNow();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseView(searchParams.get("view"));
  const localToday = () => localCalendarDate(zonedToday(new Date(), me.member.timezone));
  const [anchor, setAnchor] = useState(localToday);
  const [memberId, setMemberId] = useState(me.member.id);
  const [editingTarget, setEditingTarget] = useState<{
    id: string;
    field: InlineEditorField;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("week");
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
  const currentWeekStartDate = startOfWeekDate(todayKey, weekStartsOn);

  const setView = (next: TimerView) => {
    const params = new URLSearchParams(searchParams);
    if (next === "list") params.delete("view");
    else params.set("view", next);
    setSearchParams(params, { replace: true });
    setRangeOpen(false);
  };

  const listClock = new Date(now);
  const listRange = toApiRange(listSelection, listClock, me.member.timezone);

  useEffect(() => {
    setSelectedIds(new Set());
    setEditingTarget(null);
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
  const timer = useQuery({
    queryKey: ["timer"],
    queryFn: () => apiRequest<{ entry: TimeEntry | null }>("/timer"),
    enabled: false,
  });
  const runningEntry = timer.data ? timer.data.entry : me.active_timer;
  const runningProject =
    memberId === me.member.id && runningEntry?.running ? runningEntry.project : null;
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
      if (!restore) {
        toast({
          message:
            succeeded.length === 1
              ? "The time entry was deleted."
              : `${succeeded.length} time entries were deleted.`,
          action: { label: "Undo", onSelect: () => restoreMutation.mutate(succeeded) },
        });
      }
    }
    if (restore && errors.length) {
      // Keep failed restores retryable: the deleted entries are still recoverable.
      const failed = targets.filter(
        (entry) => !succeeded.some((restored) => restored.id === entry.id),
      );
      toast({
        message:
          failed.length === 1
            ? "The time entry could not be restored."
            : `${failed.length} time entries could not be restored.`,
        action: { label: "Undo", onSelect: () => restoreMutation.mutate(failed) },
      });
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

  const canSetBillable = me.workspace.members_can_set_billable || me.member.role !== "member";
  const billableMutation = useMutation({
    mutationFn: async (entry: TimeEntry) => {
      const path = `/time-entries/${entry.id}`;
      const input = { version: entry.version, billable: !entry.billable };
      try {
        return await apiRequest(path, { method: "PATCH", body: JSON.stringify(input) });
      } catch (error) {
        if (!(error instanceof ApiClientError) || error.code !== "override_reason_required")
          throw error;
        const reason = window.prompt(
          "This entry is locked. Enter an audit reason to override the lock:",
        );
        if (!reason?.trim()) throw error;
        return apiRequest(path, {
          method: "PATCH",
          body: JSON.stringify({ ...input, override_reason: reason.trim() }),
        });
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
        queryClient.invalidateQueries({ queryKey: ["timer"] }),
      ]);
    },
  });
  const rowPending = actionsPending || duplicateMutation.isPending || billableMutation.isPending;

  const rowMenuItems = (entry: TimeEntry): RowMenuItem[] => [
    ...(entry.running
      ? []
      : [{ label: "Duplicate", onSelect: () => duplicateMutation.mutate(entry) }]),
    {
      label: "Copy description",
      disabled: !entry.description,
      onSelect: () => {
        void navigator.clipboard.writeText(entry.description).catch(() => {
          setActionError("Could not copy the description. Check clipboard permissions and retry.");
        });
      },
    },
    { label: "Delete", danger: true, onSelect: () => deleteMutation.mutate([entry]) },
  ];

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

  const calendarStartDate =
    calendarMode === "day"
      ? anchorDate
      : startOfWeekDate(anchorDate, calendarMode === "workweek" ? 1 : weekStartsOn);
  const calendarStart = localCalendarDate(calendarStartDate);
  const calendarThisWeek = startOfWeekDate(
    todayKey,
    calendarMode === "workweek" ? 1 : weekStartsOn,
  );
  const periodSuffix =
    view === "list"
      ? selectionWeekLabel(listSelection, listWeekStartsOn)
      : view === "calendar"
        ? calendarMode === "day"
          ? format(anchor, "EEE")
          : `W${getISOWeek(calendarStart)}`
        : `W${getISOWeek(weekStart)}`;
  const periodLabel =
    view === "list"
      ? listPeriodLabel(listSelection)
      : view === "calendar"
        ? calendarMode === "day"
          ? anchorDate === todayKey
            ? "Today"
            : format(anchor, "d MMM yyyy")
          : calendarStartDate === calendarThisWeek
            ? "This week"
            : calendarStartDate === addCalendarDays(calendarThisWeek, -7)
              ? "Last week"
              : `${format(calendarStart, "d MMM")} – ${format(localCalendarDate(addCalendarDays(calendarStartDate, calendarMode === "workweek" ? 4 : 6)), "d MMM yyyy")}`
        : weekStartDate === currentWeekStartDate
          ? "This week"
          : weekStartDate === addCalendarDays(currentWeekStartDate, -7)
            ? "Last week"
            : `${format(weekStart, "d MMM")} – ${format(localCalendarDate(addCalendarDays(weekStartDate, 6)), "d MMM yyyy")}`;
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
        periodSuffix={periodSuffix}
        onClearPeriod={
          view === "list" && listSelection.preset !== "all"
            ? () => applyListPreset("all")
            : undefined
        }
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
              mode="instant"
            />
          ) : null
        }
        onTodayClick={view === "list" ? () => applyListPreset("today") : undefined}
        onWeekClick={view === "list" ? () => applyListPreset("this_week") : undefined}
        trailing={
          <>
            {view === "calendar" ? (
              <Select
                className="[&>svg:last-child]:text-fg h-9 w-auto gap-2 border-0 bg-transparent px-3 [&>span]:whitespace-normal [&>svg:last-child]:h-[8.8px] [&>svg:last-child]:w-[14px] [&>svg:last-child]:[stroke-width:1.2]"
                tone="accent"
                contentClassName="h-24 w-[113.8px] min-w-0 [&_[data-radix-select-viewport]]:p-1 [&_[role=option]]:h-7 [&_[role=option]]:px-3 [&_[role=option][data-state=checked]]:bg-accent-muted-hover [&_[role=option]>span[aria-hidden=true]]:hidden"
                value={calendarMode}
                onValueChange={(value) => setCalendarMode(value as CalendarMode)}
                aria-label="Calendar density"
                options={CALENDAR_MODES.map((mode) => ({ ...mode }))}
              />
            ) : null}
            {me.permissions.view_team ? (
              <Select
                className="h-9 w-auto max-w-[12rem] min-w-0"
                value={memberId}
                onValueChange={setMemberId}
                aria-label="Timer member"
                options={(members.data?.members ?? []).map((member) => ({
                  value: member.id,
                  label: member.display_name,
                }))}
              />
            ) : null}
          </>
        }
      />

      {view === "calendar" ? (
        <CalendarView weekStart={calendarStart} memberId={memberId} calendarMode={calendarMode} />
      ) : null}
      {view === "timesheet" ? (
        <TimesheetView weekStart={weekStartDate} memberId={memberId} />
      ) : null}
      {view === "list" ? (
        <section className="bg-surface min-w-0">
          {runningProject?.name ? (
            <div className="px-5 py-1.5" role="region" aria-label="Running project">
              <div
                className="relative h-[30px] truncate text-xs leading-[26px] font-semibold uppercase after:absolute after:inset-x-0 after:bottom-0 after:h-1 after:bg-current"
                style={runningProject.color ? { color: runningProject.color } : undefined}
              >
                {runningProject.name}
              </div>
            </div>
          ) : null}
          <TimeEntryListCapWarning entryCount={entries.data?.entries.length ?? 0} />
          {entries.isLoading ? (
            <div>
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-[50px] animate-pulse bg-white/5" />
              ))}
            </div>
          ) : entries.error ? (
            <div className="p-4">
              <ErrorState message={entries.error.message} onRetry={() => void entries.refetch()} />
            </div>
          ) : grouped.length === 0 ? (
            <EmptyState
              title="No entries found in the selected period"
              description="Looks like there's no activity here. Try a different range or start tracking now."
              action={
                <div className="flex flex-wrap justify-center gap-2.5">
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
                    className="bg-accent-muted text-accent-fg hover:bg-accent-muted-hover box-border inline-flex h-9 items-center rounded-lg px-5 text-sm font-medium shadow-[inset_0_0_0_1px_var(--color-accent-muted-hover)]"
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
              const dayEntryIds = new Set(dayEntries.map((entry) => entry.id));
              // API order, so Undo restores entries in the order they were listed.
              const dayEntriesSelected = (entries.data?.entries ?? []).filter(
                (entry) => dayEntryIds.has(entry.id) && selectedIds.has(entry.id),
              );
              const selectedInDay = dayEntriesSelected.length;
              const allSelected = selectedInDay === dayEntries.length && dayEntries.length > 0;
              const someSelected = selectedInDay > 0 && !allSelected;
              return (
                <section
                  key={day}
                  aria-labelledby={`day-${day}`}
                  className="border-stroke border-b-4"
                >
                  {selectedInDay > 0 ? (
                    <div
                      className="flex h-[50px] items-center px-4"
                      role="group"
                      aria-label="Selected entries actions"
                    >
                      <span className="border-stroke mr-4 box-border flex h-[30px] items-center border-r py-2 pr-7 text-sm">
                        <span>
                          <strong className="font-semibold">
                            {selectedInDay} {selectedInDay === 1 ? "item" : "items"}
                          </strong>{" "}
                          selected
                        </span>
                      </span>
                      <button
                        type="button"
                        className="hover:bg-surface-hover box-border inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold disabled:opacity-50"
                        disabled={actionsPending}
                        aria-label="Delete selected"
                        onClick={() => deleteMutation.mutate(dayEntriesSelected)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        {deleteMutation.isPending ? "Deleting…" : "Delete"}
                      </button>
                      <button
                        type="button"
                        className="hover:bg-surface-hover ml-1 box-border grid h-9 w-[38px] place-items-center rounded-lg disabled:opacity-50"
                        disabled={actionsPending}
                        aria-label="Clear selection"
                        onClick={() =>
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            dayEntries.forEach((entry) => next.delete(entry.id));
                            return next;
                          })
                        }
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                  <div className="flex h-[50px] items-center pr-[84px] pl-5">
                    <div className="flex w-[30px] shrink-0 items-center">
                      <EntryCheckbox
                        alwaysVisible
                        disabled={actionsPending}
                        checked={allSelected}
                        indeterminate={someSelected}
                        onChange={() => {
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            if (allSelected) dayEntries.forEach((entry) => next.delete(entry.id));
                            else dayEntries.forEach((entry) => next.add(entry.id));
                            return next;
                          });
                        }}
                        label={`Select all entries for ${day}`}
                      />
                    </div>
                    <h2
                      id={`day-${day}`}
                      className="text-fg flex-1 text-sm leading-[22.96px] font-semibold whitespace-pre-wrap"
                    >
                      {isToday
                        ? "Today"
                        : formatInTimeZone(`${day}T12:00:00Z`, me.member.timezone, "EEE, d MMM")}
                    </h2>
                    <span className="text-fg box-border px-2 py-0.5 text-sm leading-[14px] font-semibold tabular-nums">
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
                            nested={nested}
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
                          selectionActive={selectedInDay > 0}
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
                          actionsPending={rowPending}
                          menuItems={rowMenuItems(entry).map((item) => ({
                            ...item,
                            disabled: item.disabled || rowPending,
                          }))}
                          onToggleBillable={
                            canSetBillable ? () => billableMutation.mutate(entry) : undefined
                          }
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
                        selectionActive={selectedInDay > 0}
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
          {grouped.length > 0 ? (
            <div className="flex justify-center py-10">
              <Link
                to="/reports"
                className="bg-surface text-fg hover:bg-surface-hover box-border inline-flex h-9 items-center rounded-lg px-5 text-sm font-medium shadow-[inset_0_0_0_1px_var(--color-stroke-tertiary)]"
              >
                View full history in reports
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}

      {actionError ||
      continueMutation.error ||
      duplicateMutation.error ||
      billableMutation.error ? (
        <p role="alert" className="mx-4 my-3 rounded-lg bg-red-950 p-3 text-sm text-red-200">
          {actionError ??
            continueMutation.error?.message ??
            duplicateMutation.error?.message ??
            billableMutation.error?.message}
        </p>
      ) : null}
    </>
  );
}
