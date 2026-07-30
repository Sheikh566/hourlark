import FullCalendar from "@fullcalendar/react";
import interactionPlugin, { type EventResizeDoneArg } from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import type {
  DateSelectArg,
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
} from "@fullcalendar/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";
import { CalendarDays, List } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { useMe } from "@/web/app/context";
import { ErrorState, Select } from "@/web/components/ui";
import { CalendarQuickEntry } from "@/web/features/time/calendar-quick-entry";
import { EntryEditor } from "@/web/features/time/entry-editor";
import { useNow } from "@/web/hooks/use-now";
import { apiRequest } from "@/web/lib/api";
import { formatDuration } from "@/web/lib/format";
import type { Member, Project, Tag, TimeEntry } from "@/web/types";

function calendarTextColor(background: string): string {
  const hex = background.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "#ffffff";
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 145 ? "#051f0a" : "#ffffff";
}

export function CalendarPage() {
  const me = useMe();
  const now = useNow(30_000);
  const queryClient = useQueryClient();
  const calendarRef = useRef<FullCalendar>(null);
  const initialStart = new Date();
  initialStart.setDate(initialStart.getDate() - ((initialStart.getDay() + 6) % 7));
  initialStart.setHours(0, 0, 0, 0);
  const [range, setRange] = useState({
    start: initialStart.toISOString(),
    end: new Date(initialStart.getTime() + 7 * 86_400_000).toISOString(),
  });
  const [memberId, setMemberId] = useState(me.member.id);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [selection, setSelection] = useState<{ start: Date; end: Date } | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

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
      ]);
    },
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
    for (const entry of entries) {
      const day = formatInTimeZone(entry.started_at, me.member.timezone, "yyyy-MM-dd");
      totals.set(
        day,
        (totals.get(day) ?? 0) +
          (entry.running ? now - new Date(entry.started_at).getTime() : entry.duration_ms),
      );
    }
    return totals;
  }, [entries, me.member.timezone, now]);

  const moveEntry = (entryId: string, start: Date | null, end: Date | null, revert: () => void) => {
    const entry = entries.find((item) => item.id === entryId);
    if (!entry || !start || !end) {
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
  };
  const closeSelection = () => {
    calendarRef.current?.getApi().unselect();
    setSelection(null);
  };

  return (
    <>
      <section className="border-b border-white/10 bg-[#111710]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-5">
          <div>
            <h1 className="text-base font-bold text-slate-100">Calendar</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              {me.member.timezone} · Drag to create, move, or resize time.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {me.permissions.view_team ? (
              <Select
                className="h-9 min-h-9 min-w-48"
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
                aria-label="Calendar member"
              >
                {(members.data?.members ?? []).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.display_name}
                  </option>
                ))}
              </Select>
            ) : null}
            <div className="flex shrink-0 overflow-hidden rounded-md border border-white/15">
              <span className="bg-frosted-mint-900 text-frosted-mint-200 flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs font-semibold whitespace-nowrap">
                <CalendarDays size={14} /> Calendar
              </span>
              <Link
                to="/time"
                className="flex shrink-0 items-center gap-1.5 border-l border-white/10 px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-slate-400 hover:bg-white/6 hover:text-white"
              >
                <List size={14} /> Time entries
              </Link>
            </div>
          </div>
        </div>
        <div className="from-light-green-500 via-frosted-mint-700 mx-5 h-px bg-gradient-to-r to-transparent" />
      </section>
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
        <section className="overflow-hidden bg-[#111710] p-3">
          <FullCalendar
            ref={calendarRef}
            plugins={[timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            firstDay={me.workspace.week_start === "monday" ? 1 : 0}
            timeZone={me.member.timezone}
            height="calc(100vh - 176px)"
            allDaySlot={false}
            nowIndicator
            selectable
            selectMirror
            editable={memberId === me.member.id || me.permissions.view_team}
            eventResizableFromStart
            slotMinTime="06:00:00"
            slotMaxTime="22:00:00"
            slotDuration="00:30:00"
            scrollTime="08:00:00"
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "timeGridWeek,timeGridDay",
            }}
            buttonIcons={false}
            buttonText={{ prev: "‹", next: "›", today: "Today", week: "Week", day: "Day" }}
            events={entries.map((entry) => {
              const backgroundColor = entry.project?.color ?? "#14852B";
              return {
                id: entry.id,
                title: entry.description || entry.project?.name || "No description",
                start: entry.started_at,
                end: entry.stopped_at ?? new Date(now).toISOString(),
                backgroundColor,
                textColor: calendarTextColor(backgroundColor),
                borderColor: overlaps.has(entry.id) ? "#82CF30" : backgroundColor,
                extendedProps: { entry },
              };
            })}
            datesSet={(info: DatesSetArg) =>
              setRange({ start: info.start.toISOString(), end: info.end.toISOString() })
            }
            select={(info: DateSelectArg) => {
              setEditing(null);
              setSelection({ start: info.start, end: info.end });
            }}
            eventClick={(info: EventClickArg) => {
              closeSelection();
              setEditing(info.event.extendedProps.entry as TimeEntry);
            }}
            eventDrop={(info: EventDropArg) =>
              moveEntry(info.event.id, info.event.start, info.event.end, info.revert)
            }
            eventResize={(info: EventResizeDoneArg) =>
              moveEntry(info.event.id, info.event.start, info.event.end, info.revert)
            }
            dayHeaderContent={(info) => {
              const key = formatInTimeZone(info.date, me.member.timezone, "yyyy-MM-dd");
              return (
                <div className="py-1 text-center">
                  <div>{formatInTimeZone(info.date, me.member.timezone, "EEE d")}</div>
                  <div className="text-frosted-mint-300 mt-1 text-[10px] font-medium">
                    {formatDuration(totalsByDay.get(key) ?? 0)}
                  </div>
                </div>
              );
            }}
            eventContent={(info: EventContentArg) => (
              <div className="min-w-0 overflow-hidden">
                <div className="truncate text-xs font-semibold">{info.event.title}</div>
                <div className="truncate text-[10px] font-medium">
                  {formatDuration(
                    (info.event.end?.getTime() ?? now) - (info.event.start?.getTime() ?? now),
                  )}
                  {overlaps.has(info.event.id) ? " · overlap" : ""}
                </div>
              </div>
            )}
          />
        </section>
      )}
      {selection ? (
        <CalendarQuickEntry
          key={`${selection.start.toISOString()}:${selection.end.toISOString()}`}
          start={selection.start}
          stop={selection.end}
          targetMemberId={me.permissions.view_team ? memberId : undefined}
          projects={projects.data?.projects ?? []}
          tags={tags.data?.tags ?? []}
          onClose={closeSelection}
        />
      ) : null}
      <EntryEditor
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
          }
        }}
        entry={editing}
        projects={projects.data?.projects ?? []}
        tags={tags.data?.tags ?? []}
      />
    </>
  );
}
