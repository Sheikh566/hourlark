import FullCalendar, {
  type CalendarRef,
  type DateSelectInfo,
  type DatesSetInfo,
  type EventClickInfo,
  type EventDisplayInfo,
  type EventDropInfo,
  type EventResizeDoneInfo,
} from "@fullcalendar/react";
import interactionPlugin from "@fullcalendar/react/interaction";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import themePlugin from "@fullcalendar/react/themes/classic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Minus, Play, Plus } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { overlapDuration } from "@/domain/dates/time";
import { useMe } from "@/web/app/context";
import { ErrorState } from "@/web/components/ui";
import {
  CALENDAR_SLOT_HEIGHT,
  CALENDAR_ZOOM_LEVELS,
  clampCalendarZoom,
  eventFillColor,
  projectTextColor,
  readCalendarZoom,
  storeCalendarZoom,
  type CalendarMode,
} from "@/web/features/time/calendar-config";
import { CalendarEntryPopover } from "@/web/features/time/calendar-entry-popover";
import { CalendarQuickEntry } from "@/web/features/time/calendar-quick-entry";
import { formatClockTime } from "@/web/features/time/entry-popover-time";
import type { PopoverAnchor } from "@/web/features/time/entry-popover";
import {
  addCalendarDays,
  exclusiveEndIso,
  localCalendarDate,
  startOfWeekDate,
  zonedDayStartIso,
  zonedToday,
} from "@/web/features/timer/list-date-range";
import { useNow } from "@/web/hooks/use-now";
import { apiRequest, idempotencyKey } from "@/web/lib/api";
import { formatClockDuration } from "@/web/lib/format";
import { broadcastTimerChange } from "@/web/lib/timer";
import type { Project, Tag, TimeEntry } from "@/web/types";

import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";

const CALENDAR_PLUGINS = [themePlugin, timeGridPlugin, interactionPlugin];

function calendarEventClass(info: EventDisplayInfo): string {
  return info.isMirror ? "hl-cal-event fc-event fc-event-mirror" : "hl-cal-event fc-event";
}

/** Toggl draws no vertical line in the header; in the body it is the first day's left border. */
function calendarDividerClass(info: { inTableHeader: boolean }): string {
  return info.inTableHeader ? "hl-cal-divider-header" : "hl-cal-divider";
}

function calendarEventBeforeClass(info: EventDisplayInfo): string {
  return info.isStartResizable ? "hl-cal-resizer hl-cal-resizer-start" : "";
}

function calendarEventAfterClass(info: EventDisplayInfo): string {
  return info.isEndResizable ? "hl-cal-resizer hl-cal-resizer-end" : "";
}

/** Toggl event blocks hide their text progressively as the block gets shorter. */
function eventDetailLevel(heightPx: number): { title: boolean; project: boolean; meta: boolean } {
  return { title: heightPx >= 24, project: heightPx >= 60, meta: heightPx >= 45 };
}

/** 11px/600 time label for a slot header, from the slot's time of day. */
function slotLabel(timeMs: number): string {
  const totalMinutes = Math.round(timeMs / 60_000);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return formatClockTime(`${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`);
}

/** Toggl opens the popover just right of and above where the pointer was released. */
const POINTER_OFFSET = { x: 2, y: -5 };

function pointerAnchor(pointer: globalThis.MouseEvent | null | undefined): PopoverAnchor | null {
  if (!pointer || (!pointer.clientX && !pointer.clientY)) return null;
  return { x: pointer.clientX + POINTER_OFFSET.x, y: pointer.clientY + POINTER_OFFSET.y };
}

function mirrorAnchor(container: HTMLElement | null): PopoverAnchor | null {
  const mirror = container?.querySelector<HTMLElement>(".fc-event-mirror");
  if (!mirror) return null;
  const rect = mirror.getBoundingClientRect();
  return { x: rect.left + rect.width / 2 + POINTER_OFFSET.x, y: rect.bottom + POINTER_OFFSET.y };
}

function ZoomButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="text-fg-secondary hover:bg-surface-hover hover:text-fg flex h-5 w-[22px] items-center justify-center rounded text-start leading-[14px] disabled:opacity-40 disabled:hover:bg-transparent"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function CalendarView({
  weekStart,
  memberId,
  calendarMode = "week",
}: {
  weekStart: Date;
  memberId: string;
  calendarMode?: CalendarMode;
}) {
  const me = useMe();
  const now = useNow(30_000);
  const queryClient = useQueryClient();
  const calendarRef = useRef<CalendarRef>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const dateKey = format(weekStart, "yyyy-MM-dd");
  const inclusiveDays = calendarMode === "day" ? 0 : 6;
  const [range, setRange] = useState({
    start: zonedDayStartIso(dateKey, me.member.timezone),
    end: exclusiveEndIso(addCalendarDays(dateKey, inclusiveDays), me.member.timezone),
  });
  const [editing, setEditing] = useState<{ entry: TimeEntry; anchor: PopoverAnchor } | null>(null);
  const [selection, setSelection] = useState<{
    start: Date;
    end: Date;
    anchor: PopoverAnchor;
  } | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(readCalendarZoom);
  const zoomLevel = CALENDAR_ZOOM_LEVELS[clampCalendarZoom(zoom)] ?? CALENDAR_ZOOM_LEVELS[3];
  const slotMs = (zoomLevel?.minutes ?? 15) * 60_000;
  // Match the measured calendar's initial hours; earlier hours remain reachable by scrolling.
  const initialScroll = "11:00:00";

  // A new zoom level changes every slot height; bring the working hours back into view.
  const firstZoomRender = useRef(true);
  useEffect(() => {
    if (firstZoomRender.current) {
      firstZoomRender.current = false;
      return;
    }
    const frame = window.requestAnimationFrame(() =>
      calendarRef.current?.getApi().scrollToTime(initialScroll),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [initialScroll, zoom]);

  useEffect(() => {
    setEditing(null);
    setSelection(null);
    let cancelled = false;
    queueMicrotask(() => {
      const api = calendarRef.current?.getApi();
      if (!api || cancelled) return;
      api.unselect();
      api.gotoDate(dateKey);
      api.changeView(calendarMode === "day" ? "timeGridDay" : "timeGridWeek");
    });
    return () => {
      cancelled = true;
    };
  }, [calendarMode, me.member.timezone, dateKey, memberId]);

  const changeZoom = useCallback((next: number) => {
    const level = clampCalendarZoom(next);
    setZoom(level);
    storeCalendarZoom(level);
  }, []);

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
  const calendar = useQuery({
    queryKey: ["calendar", range, memberId],
    queryFn: () => {
      const params = new URLSearchParams({
        start: range.start,
        end: range.end,
        ...(me.permissions.view_team ? { member_id: memberId } : {}),
      });
      return apiRequest<{ events: TimeEntry[]; generated_at: string }>(`/calendar?${params}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ entry, start, end }: { entry: TimeEntry; start: Date; end: Date }) =>
      apiRequest(`/time-entries/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          version: entry.version,
          started_at: start.toISOString(),
          stopped_at: end.toISOString(),
        }),
      }),
    onSuccess: async () => {
      setMutationError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
      ]);
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
      setMutationError(null);
      broadcastTimerChange();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["timer"] }),
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
      ]);
    },
    onError: (error) => setMutationError(error.message),
  });

  const entries = useMemo(() => calendar.data?.events ?? [], [calendar.data?.events]);
  const overlaps = useMemo(() => {
    const ids = new Set<string>();
    const sorted = entries
      .map((entry) => ({
        id: entry.id,
        start: new Date(entry.started_at).getTime(),
        end: entry.stopped_at ? new Date(entry.stopped_at).getTime() : now,
      }))
      .sort((left, right) => left.start - right.start);
    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      if (!current) continue;
      for (let compare = index + 1; compare < sorted.length; compare += 1) {
        const candidate = sorted[compare];
        if (!candidate || candidate.start >= current.end) break;
        ids.add(current.id);
        ids.add(candidate.id);
      }
    }
    return ids;
  }, [entries, now]);
  const totalsByDay = useMemo(() => {
    const totals = new Map<string, number>();
    const timezone = me.member.timezone;
    const firstDay = formatInTimeZone(range.start, timezone, "yyyy-MM-dd");
    const lastDay = formatInTimeZone(range.end, timezone, "yyyy-MM-dd");
    for (let day = firstDay; day < lastDay; day = addCalendarDays(day, 1)) {
      const start = Date.parse(zonedDayStartIso(day, timezone));
      const end = Date.parse(zonedDayStartIso(addCalendarDays(day, 1), timezone));
      totals.set(
        day,
        entries.reduce(
          (sum, entry) =>
            sum +
            overlapDuration(
              Date.parse(entry.started_at),
              entry.stopped_at ? Date.parse(entry.stopped_at) : now,
              start,
              end,
            ),
          0,
        ),
      );
    }
    return totals;
  }, [entries, me.member.timezone, now, range.start, range.end]);

  const events = useMemo(
    () =>
      entries.map((entry) => ({
        id: entry.id,
        title: entry.description || "(no description)",
        start: entry.started_at,
        end: entry.stopped_at ?? new Date(now).toISOString(),
        // Toggl tints the block with 20% of the project colour (grey without a project).
        color: eventFillColor(entry.project?.color),
        contrastColor: "#fafafa",
        className: overlaps.has(entry.id) ? "hourlark-cal-overlap" : "",
        editable: !entry.running,
        extendedProps: { entry },
      })),
    [entries, now, overlaps],
  );

  const moveEntry = useCallback(
    (entryId: string, start: Date | null, end: Date | null, revert: () => void) => {
      const entry = entries.find((item) => item.id === entryId);
      if (!entry || entry.running || updateMutation.isPending || !start || !end) {
        revert();
        return;
      }
      updateMutation.mutate(
        { entry, start, end },
        {
          onError: (error) => {
            revert();
            setMutationError(error.message);
            void queryClient.invalidateQueries({ queryKey: ["calendar"] });
          },
        },
      );
    },
    [entries, queryClient, updateMutation],
  );
  const closeSelection = useCallback(() => {
    calendarRef.current?.getApi().unselect();
    setSelection(null);
  }, []);
  const handleDatesSet = useCallback((info: DatesSetInfo) => {
    setRange({ start: info.start.toISOString(), end: info.end.toISOString() });
  }, []);
  const handleSelect = useCallback((info: DateSelectInfo) => {
    setEditing(null);
    const container = shellRef.current;
    const anchor = pointerAnchor(info.jsEvent) ??
      mirrorAnchor(container) ?? { x: Math.max(16, window.innerWidth / 2 - 212), y: 160 };
    setSelection({ start: info.start, end: info.end, anchor });
  }, []);
  const handleEventClick = useCallback(
    (info: EventClickInfo) => {
      closeSelection();
      const rect = info.el.getBoundingClientRect();
      const anchor = pointerAnchor(info.jsEvent) ?? { x: rect.left, y: rect.top };
      setEditing({ entry: info.event.extendedProps.entry as TimeEntry, anchor });
    },
    [closeSelection],
  );
  const handleEventDrop = useCallback(
    (info: EventDropInfo) =>
      moveEntry(info.event.id, info.event.start, info.event.end, info.revert),
    [moveEntry],
  );
  const handleEventResize = useCallback(
    (info: EventResizeDoneInfo) =>
      moveEntry(info.event.id, info.event.start, info.event.end, info.revert),
    [moveEntry],
  );
  const renderDayHeader = useCallback(
    (info: { date: Date }) => {
      const key = formatInTimeZone(info.date, me.member.timezone, "yyyy-MM-dd");
      const isToday = key === formatInTimeZone(new Date(), me.member.timezone, "yyyy-MM-dd");
      return (
        <div className="flex items-center" data-today={isToday ? "true" : undefined}>
          <span
            className={
              isToday
                ? "bg-accent-muted text-accent-fg inline-flex h-9 w-11 shrink-0 items-center justify-center rounded-[99px] py-1.5 text-center text-2xl leading-6 font-medium tracking-[0.4px] whitespace-pre-wrap"
                : "text-fg inline-flex h-9 w-11 shrink-0 items-center justify-center rounded-[99px] py-1.5 text-center text-2xl leading-6 font-medium tracking-[0.4px] whitespace-pre-wrap"
            }
          >
            {formatInTimeZone(info.date, me.member.timezone, "d")}
          </span>
          <div className="ml-0.5 flex min-w-0 flex-col items-start pl-0">
            <div
              className={`text-left text-[11px] leading-[normal] font-semibold tracking-[0.4px] uppercase ${isToday ? "text-accent-fg" : "text-fg"}`}
            >
              {formatInTimeZone(
                info.date,
                me.member.timezone,
                calendarMode === "day" ? "EEEE" : "EEE",
              )}
            </div>
            <div className="text-fg-subtle text-center text-xs leading-[normal] font-medium tracking-[0.4px]">
              {formatClockDuration(totalsByDay.get(key) ?? 0)}
            </div>
          </div>
        </div>
      );
    },
    [calendarMode, me.member.timezone, totalsByDay],
  );
  const renderSlotLabel = useCallback(
    (info: { time?: { milliseconds: number }; isFirst: boolean }) =>
      info.isFirst || !info.time ? null : (
        <span className="hl-cal-slot-label">{slotLabel(info.time.milliseconds)}</span>
      ),
    [],
  );
  const renderEventContent = useCallback(
    (info: EventDisplayInfo) => {
      const entry = info.event.extendedProps.entry as TimeEntry | undefined;
      const durationMs = (info.event.end?.getTime() ?? now) - (info.event.start?.getTime() ?? now);
      const heightPx = (durationMs / slotMs) * CALENDAR_SLOT_HEIGHT;
      if (info.isMirror || !entry) {
        return (
          <div className="flex h-full min-w-0 flex-col justify-end">
            <span className="text-fg pb-px text-xs leading-[15px] font-semibold">
              {formatClockDuration(durationMs)}
            </span>
          </div>
        );
      }
      const detail = eventDetailLevel(heightPx);
      const projectColor = entry.project?.color;
      return (
        <div
          className="relative flex h-full min-w-0 flex-col"
          title={overlaps.has(entry.id) ? "Overlapping time entry" : undefined}
        >
          {detail.title ? (
            <div
              className={`truncate text-xs leading-4 font-semibold ${entry.description ? "text-fg" : "text-fg-subtle"}`}
            >
              {entry.description || "(no description)"}
            </div>
          ) : null}
          {detail.project && entry.project?.name ? (
            <div
              className="mt-0.5 truncate text-xs leading-4 font-medium"
              style={{ color: projectTextColor(projectColor) }}
            >
              {entry.project.name}
            </div>
          ) : null}
          {detail.meta ? (
            <div className="text-fg mt-auto pt-0.5 pb-1 text-xs leading-[15px] font-semibold">
              {formatClockDuration(durationMs)}
            </div>
          ) : null}
          {!entry.running && memberId === me.member.id ? (
            <button
              type="button"
              className="hl-cal-continue bg-accent text-fg absolute right-[-10px] bottom-[-10px] grid size-[30px] place-items-center rounded-full border border-solid border-[#1b1b1b]"
              aria-label={`Continue ${entry.description || "time entry"}`}
              title="Continue time entry"
              onPointerDown={(event: React.PointerEvent) => event.stopPropagation()}
              onMouseDown={(event: MouseEvent) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                if (!continueMutation.isPending) continueMutation.mutate(entry);
              }}
            >
              <Play size={10} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      );
    },
    [continueMutation, memberId, me.member.id, now, overlaps, slotMs],
  );

  return (
    <>
      {mutationError ? (
        <div className="m-4 rounded-lg border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-300">
          The calendar change was rolled back: {mutationError}
        </div>
      ) : null}
      {calendar.error ? (
        <div className="p-4">
          <ErrorState message={calendar.error.message} onRetry={() => void calendar.refetch()} />
        </div>
      ) : (
        <section
          ref={shellRef}
          aria-label="Time entry calendar"
          className="hl-cal-shell bg-surface relative overflow-hidden"
        >
          <div className="absolute top-[21px] left-[21.7px] z-[4] flex gap-[3px]">
            <ZoomButton
              label="Decrease zoom"
              disabled={zoom <= 0}
              onClick={() => changeZoom(zoom - 1)}
            >
              <Minus width={10} height={3} viewBox="0 10 24 4" aria-hidden="true" />
            </ZoomButton>
            <ZoomButton
              label="Increase zoom"
              disabled={zoom >= CALENDAR_ZOOM_LEVELS.length - 1}
              onClick={() => changeZoom(zoom + 1)}
            >
              <Plus size={10} aria-hidden="true" />
            </ZoomButton>
          </div>
          <FullCalendar
            ref={calendarRef}
            className="hourlark-calendar"
            plugins={CALENDAR_PLUGINS}
            initialView={calendarMode === "day" ? "timeGridDay" : "timeGridWeek"}
            initialDate={dateKey}
            firstDay={calendarMode === "workweek" || me.workspace.week_start === "monday" ? 1 : 0}
            timeZone={me.member.timezone}
            height="max(320px, calc(100dvh - 152px))"
            allDaySlot={false}
            weekends={calendarMode !== "workweek"}
            nowIndicator
            selectable
            selectMirror
            unselectCancel=".hl-cal-popover"
            editable={memberId === me.member.id || me.permissions.view_team}
            slotEventOverlap={false}
            eventResizableFromStart
            slotMinTime="00:00:00"
            slotMaxTime="24:00:00"
            slotDuration={zoomLevel?.slot ?? "00:15:00"}
            snapDuration={zoomLevel?.snap ?? "00:15:00"}
            slotHeaderInterval={zoomLevel?.slot ?? "00:15:00"}
            slotMinHeight={CALENDAR_SLOT_HEIGHT}
            scrollTime={initialScroll}
            eventMinHeight={0}
            eventShortHeight={0}
            headerToolbar={false}
            events={events}
            eventClass={calendarEventClass}
            columnEventInnerClass="hl-cal-event-inner"
            columnEventBeforeClass={calendarEventBeforeClass}
            columnEventAfterClass={calendarEventAfterClass}
            dayLaneClass="fc-timegrid-col hl-cal-day-lane"
            dayLaneInnerClass="hl-cal-lane-inner"
            slotLaneClass="fc-timegrid-slot hl-cal-slot-lane"
            slotHeaderClass="fc-timegrid-slot hl-cal-slot-header"
            slotHeaderInnerClass="hl-cal-slot-inner"
            dayHeaderClass="hl-cal-day-header"
            dayHeaderInnerClass="hl-cal-day-inner"
            dayHeaderAlign="start"
            borderless
            tableHeaderClass="hl-cal-header"
            slotHeaderDividerClass={calendarDividerClass}
            nowIndicatorLineClass="fc-timegrid-now-indicator-line hl-cal-now-line"
            nowIndicatorHeaderClass="fc-timegrid-now-indicator-arrow hl-cal-now-arrow"
            datesSet={handleDatesSet}
            select={handleSelect}
            eventClick={handleEventClick}
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
            dayHeaderContent={renderDayHeader}
            slotHeaderContent={renderSlotLabel}
            eventContent={renderEventContent}
          />
        </section>
      )}
      {selection ? (
        <CalendarQuickEntry
          key={`${memberId}:${selection.start.toISOString()}:${selection.end.toISOString()}`}
          start={selection.start}
          stop={selection.end}
          anchor={selection.anchor}
          targetMemberId={me.permissions.view_team ? memberId : undefined}
          projects={projects.data?.projects ?? []}
          tags={tags.data?.tags ?? []}
          onClose={closeSelection}
        />
      ) : null}
      {editing ? (
        <CalendarEntryPopover
          key={editing.entry.id}
          entry={editing.entry}
          anchor={editing.anchor}
          targetMemberId={me.permissions.view_team ? memberId : undefined}
          projects={projects.data?.projects ?? []}
          tags={tags.data?.tags ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

/** @deprecated Prefer CalendarView inside the Timer page */
export function CalendarPage() {
  const me = useMe();
  const today = zonedToday(new Date(), me.member.timezone);
  const weekStartsOn = me.workspace.week_start === "monday" ? 1 : 0;
  const weekStart = localCalendarDate(startOfWeekDate(today, weekStartsOn));
  return <CalendarView weekStart={weekStart} memberId={me.member.id} />;
}
