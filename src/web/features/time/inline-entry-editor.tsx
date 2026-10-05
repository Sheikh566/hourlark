import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addSeconds } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { CalendarClock, Check, CircleDollarSign, Search, Tags, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { majorToMinor, minorToMajor } from "@/domain/billing/money";
import { useMe } from "@/web/app/context";
import { Button } from "@/web/components/ui";
import {
  useDismissPopover,
  useEscapeToClose,
  useRestoreFocus,
} from "@/web/features/timer/use-dismiss-popover";
import { ApiClientError, apiRequest } from "@/web/lib/api";
import { formatClockDuration, parseClockDuration } from "@/web/lib/format";
import type { Project, Tag, TimeEntry } from "@/web/types";

export type InlineEditorField = "description" | "project" | "tags" | "time";

function localValueWithSeconds(iso: string, timezone: string): string {
  return formatInTimeZone(new Date(iso), timezone, "yyyy-MM-dd'T'HH:mm:ss");
}

function replaceDate(value: string, date: string): string {
  return `${date}${value.slice(10)}`;
}

function replaceTime(value: string, time: string): string {
  return `${value.slice(0, 10)}T${time}`;
}

function projectVisibleLabel(project: { name: string; client_name: string }): string {
  if (!project.client_name || project.client_name === "No client") return project.name;
  return `${project.name} • ${project.client_name}`;
}

interface InlineEntryEditorProps {
  entry: TimeEntry;
  projects: Project[];
  tags: Tag[];
  initialField?: InlineEditorField;
  onCancel: () => void;
  onSaved: () => void;
}

type ProjectChoice = Pick<Project, "id" | "name" | "color" | "client_name">;

export function InlineEntryEditor({
  entry,
  projects,
  tags,
  initialField = "description",
  onCancel,
  onSaved,
}: InlineEntryEditorProps) {
  const me = useMe();
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const initialStop = entry.stopped_at ?? new Date().toISOString();
  const initialDurationSeconds = Math.max(
    1,
    Math.round((new Date(initialStop).getTime() - new Date(entry.started_at).getTime()) / 1000),
  );
  const [description, setDescription] = useState(entry.description);
  const [projectId, setProjectId] = useState(entry.project?.id ?? "");
  const [tagIds, setTagIds] = useState(entry.tags.map((tag) => tag.id));
  const [startedAt, setStartedAt] = useState(
    localValueWithSeconds(entry.started_at, me.member.timezone),
  );
  const [stoppedAt, setStoppedAt] = useState(
    localValueWithSeconds(initialStop, me.member.timezone),
  );
  const [durationSeconds, setDurationSeconds] = useState(initialDurationSeconds);
  const [durationDraft, setDurationDraft] = useState(
    formatClockDuration(initialDurationSeconds * 1000),
  );
  const [billable, setBillable] = useState(entry.billable);
  const [rateMajor, setRateMajor] = useState(
    entry.rate_minor === null || entry.rate_minor === undefined
      ? ""
      : String(minorToMajor(entry.rate_minor, entry.rate_currency ?? me.workspace.currency)),
  );
  const [openField, setOpenField] = useState<InlineEditorField | null>(
    initialField === "description" ? null : initialField,
  );

  const availableProjects = useMemo(() => {
    const merged = new Map<string, ProjectChoice>(projects.map((project) => [project.id, project]));
    if (entry.project) {
      merged.set(entry.project.id, {
        id: entry.project.id,
        name: entry.project.name ?? "Archived project",
        color: entry.project.color ?? "#64748b",
        client_name: entry.client?.name ?? "Archived",
      });
    }
    return [...merged.values()];
  }, [entry.client?.name, entry.project, projects]);
  const availableTags = useMemo(() => {
    const merged = new Map(tags.map((tag) => [tag.id, tag]));
    for (const tag of entry.tags) merged.set(tag.id, tag);
    return [...merged.values()];
  }, [entry.tags, tags]);

  const updateStopFromDuration = (seconds: number, startValue = startedAt) => {
    if (!Number.isFinite(seconds) || seconds < 1 || !startValue) return;
    const start = fromZonedTime(startValue, me.member.timezone);
    if (!Number.isFinite(start.getTime())) return;
    const stop = addSeconds(start, seconds);
    if (!Number.isFinite(stop.getTime())) return;
    setStoppedAt(localValueWithSeconds(stop.toISOString(), me.member.timezone));
  };
  const updateDurationFromTimes = (startValue: string, stopValue: string) => {
    if (!startValue || !stopValue) return;
    const start = fromZonedTime(startValue, me.member.timezone).getTime();
    const stop = fromZonedTime(stopValue, me.member.timezone).getTime();
    if (stop > start) {
      const seconds = Math.max(1, Math.round((stop - start) / 1000));
      setDurationSeconds(seconds);
      setDurationDraft(formatClockDuration(seconds * 1000));
    }
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!entry.running && !parseClockDuration(durationDraft))
        throw new Error("Enter a duration in h:mm:ss, up to 168 hours.");
      const start = fromZonedTime(startedAt, me.member.timezone);
      const stop = entry.running ? null : fromZonedTime(stoppedAt, me.member.timezone);
      if (!Number.isFinite(start.getTime()) || (stop && !Number.isFinite(stop.getTime())))
        throw new Error("Choose valid start and stop dates and times.");
      if (stop && stop <= start) throw new Error("Stop must be after start.");

      const input = {
        version: entry.version,
        description,
        project_id: projectId || null,
        tag_ids: tagIds,
        started_at:
          startedAt === localValueWithSeconds(entry.started_at, me.member.timezone)
            ? entry.started_at
            : start.toISOString(),
        ...(stop
          ? {
              stopped_at:
                entry.stopped_at &&
                stoppedAt === localValueWithSeconds(entry.stopped_at, me.member.timezone)
                  ? entry.stopped_at
                  : stop.toISOString(),
            }
          : {}),
        billable,
        ...(me.permissions.financial &&
        billable &&
        rateMajor &&
        rateMajor !==
          (entry.rate_minor == null
            ? ""
            : String(minorToMajor(entry.rate_minor, entry.rate_currency ?? me.workspace.currency)))
          ? {
              rate_minor: majorToMinor(rateMajor, entry.rate_currency ?? me.workspace.currency),
              rate_currency: entry.rate_currency ?? me.workspace.currency,
            }
          : {}),
      };

      try {
        return await apiRequest<{ entry: TimeEntry }>(`/time-entries/${entry.id}`, {
          method: "PATCH",
          body: JSON.stringify(input),
        });
      } catch (error) {
        if (error instanceof ApiClientError && error.code === "override_reason_required") {
          const reason = window.prompt(
            "This entry is locked. Enter an audit reason to override the lock:",
          );
          if (reason?.trim()) {
            return apiRequest<{ entry: TimeEntry }>(`/time-entries/${entry.id}`, {
              method: "PATCH",
              body: JSON.stringify({ ...input, override_reason: reason.trim() }),
            });
          }
        }
        throw error;
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
        queryClient.invalidateQueries({ queryKey: ["timer"] }),
      ]);
      if (mounted.current) onSaved();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.code === "entry_conflict") {
        void queryClient.invalidateQueries({ queryKey: ["time-entries"] });
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!mutation.isPending) mutation.mutate();
  };

  return (
    <form
      className="border-b border-l-2 border-[#3b3b3b] border-l-[#f59e0b]/50 bg-white/[0.04] px-4 py-2 md:px-5"
      aria-label={`Edit ${entry.description || "time entry"}`}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || openField) return;
        event.preventDefault();
        onCancel();
      }}
    >
      <fieldset disabled={mutation.isPending} className="min-w-0 border-0 p-0">
        <div className="grid min-h-12 min-w-0 items-center gap-2 xl:grid-cols-[auto_minmax(280px,1fr)_minmax(120px,0.55fr)_auto_auto]">
          <span className="h-4 w-4" aria-hidden="true" />

          <div className="flex min-w-0 items-center gap-3">
            <input
              autoFocus={initialField === "description"}
              className="h-9 min-w-[120px] flex-[1_1_52%] rounded-md border border-transparent bg-transparent px-1.5 text-sm font-semibold text-[#fafafa] outline-none placeholder:text-[#a4a4a4] hover:bg-black/10 focus:border-[#3b3b3b] focus:bg-[#1b1b1b]"
              value={description}
              maxLength={500}
              placeholder="Add description"
              aria-label="Entry description"
              onChange={(event) => setDescription(event.target.value)}
            />
            <ProjectPicker
              projects={availableProjects}
              value={projectId}
              archivedProjectId={
                entry.project && !projects.some((project) => project.id === entry.project?.id)
                  ? entry.project.id
                  : null
              }
              open={openField === "project"}
              onOpenChange={(next) => setOpenField(next ? "project" : null)}
              onChange={setProjectId}
            />
          </div>

          <TagPicker
            tags={availableTags}
            value={tagIds}
            open={openField === "tags"}
            onOpenChange={(next) => setOpenField(next ? "tags" : null)}
            onChange={setTagIds}
          />

          <div className="flex items-center justify-end gap-1">
            {me.workspace.members_can_set_billable || me.member.role !== "member" ? (
              <button
                type="button"
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition ${
                  billable
                    ? "bg-[#382b16] text-[#fbbf24]"
                    : "text-[#a4a4a4] hover:bg-white/7 hover:text-[#fafafa]"
                }`}
                aria-label={billable ? "Mark entry non-billable" : "Mark entry billable"}
                aria-pressed={billable}
                onClick={() => setBillable((value) => !value)}
              >
                <CircleDollarSign size={16} />
              </button>
            ) : null}
            <TimePicker
              timezone={me.member.timezone}
              running={entry.running}
              startedAt={startedAt}
              stoppedAt={stoppedAt}
              durationSeconds={durationSeconds}
              durationDraft={durationDraft}
              billable={billable}
              financial={me.permissions.financial}
              currency={entry.rate_currency ?? me.workspace.currency}
              rateMajor={rateMajor}
              open={openField === "time"}
              onOpenChange={(next) => setOpenField(next ? "time" : null)}
              onRateChange={setRateMajor}
              onStartChange={(nextStart) => {
                setStartedAt(nextStart);
                if (!entry.running) updateStopFromDuration(durationSeconds, nextStart);
              }}
              onStopChange={(nextStop) => {
                setStoppedAt(nextStop);
                updateDurationFromTimes(startedAt, nextStop);
              }}
              onDurationChange={(value) => {
                setDurationDraft(value);
                const seconds = parseClockDuration(value);
                if (seconds) {
                  setDurationSeconds(seconds);
                  updateStopFromDuration(seconds);
                }
              }}
            />
          </div>

          <div className="flex justify-end gap-0.5">
            <Button
              type="button"
              variant="ghost"
              className="h-8 min-h-8 w-8 rounded-md p-0 text-[#a4a4a4] hover:text-[#fafafa]"
              aria-label="Cancel editing"
              onClick={onCancel}
            >
              <X size={16} />
            </Button>
            <Button
              type="submit"
              variant="ghost"
              className="h-8 min-h-8 w-8 rounded-md bg-[#f59e0b] p-0 text-[#18181b] hover:bg-[#fbbf24] hover:text-[#18181b]"
              aria-label="Save time entry"
              disabled={mutation.isPending}
            >
              <Check size={17} />
            </Button>
          </div>
        </div>
      </fieldset>
      {mutation.error ? (
        <p className="mt-1 pl-7 text-xs text-red-300" role="alert">
          {mutation.error instanceof ApiClientError && mutation.error.code === "entry_conflict"
            ? "This entry changed elsewhere. The latest values were reloaded; open it again to continue."
            : mutation.error.message}
        </p>
      ) : null}
    </form>
  );
}

function ProjectPicker({
  projects,
  value,
  archivedProjectId,
  open,
  onOpenChange,
  onChange,
}: {
  projects: ProjectChoice[];
  value: string;
  archivedProjectId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const requestClose = (shouldRestore: boolean) => {
    setRestoreFocus(shouldRestore);
    onOpenChange(false);
  };
  useDismissPopover(root, () => requestClose(false), undefined, open);
  useEscapeToClose(open, () => requestClose(true));
  useRestoreFocus(open, trigger, restoreFocus, () => setRestoreFocus(false));
  useEffect(() => {
    if (open) setSearch("");
  }, [open]);
  const selected = projects.find((project) => project.id === value);
  const selectedLabel = selected ? projectVisibleLabel(selected) : null;
  const selectedVisible = Boolean(
    selected &&
    (!search ||
      `${selected.name} ${selected.client_name}`.toLowerCase().includes(search.toLowerCase())),
  );
  const grouped = useMemo(() => {
    const result = new Map<string, ProjectChoice[]>();
    for (const project of projects) {
      if (
        project.id === value ||
        (search &&
          !`${project.name} ${project.client_name}`.toLowerCase().includes(search.toLowerCase()))
      ) {
        continue;
      }
      const client = project.client_name || "No client";
      result.set(client, [...(result.get(client) ?? []), project]);
    }
    return [...result.entries()];
  }, [projects, search, value]);

  return (
    <div ref={root} className="relative min-w-0 flex-[1_1_42%]">
      <button
        ref={trigger}
        type="button"
        className="flex h-9 max-w-full items-center gap-2 rounded-md px-2 text-left text-sm transition hover:bg-black/10"
        aria-label={selected ? `Project: ${selectedLabel}` : "Choose entry project"}
        title={selectedLabel ?? "Add project"}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => onOpenChange(!open)}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-[#a4a4a4]"
          style={selected?.color ? { backgroundColor: selected.color } : undefined}
        />
        <span className="min-w-0 truncate">
          <span style={selected?.color ? { color: selected.color } : undefined}>
            {selected?.name ?? "Add project"}
          </span>
          {selected && selected.client_name && selected.client_name !== "No client" ? (
            <span className="text-[#a4a4a4]"> • {selected.client_name}</span>
          ) : null}
        </span>
      </button>
      {open ? (
        <div className="timer-popover fixed top-1/2 left-1/2 z-50 max-h-[80dvh] w-[min(92vw,360px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto xl:absolute xl:top-10 xl:left-0 xl:max-h-none xl:translate-x-0 xl:translate-y-0">
          <div className="relative border-b border-[#3b3b3b] p-2">
            <Search className="absolute top-4 left-4 text-[#a4a4a4]" size={15} />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-full rounded-md border border-[#3b3b3b] bg-[#1b1b1b] pr-3 pl-9 text-sm text-[#fafafa] outline-none placeholder:text-[#a4a4a4]"
              placeholder="Search projects or clients"
              aria-label="Search entry projects"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5">
            <PickerOption
              label="No project"
              active={!value}
              onClick={() => {
                onChange("");
                requestClose(true);
              }}
            />
            {selected && selectedVisible ? (
              <div className="mt-2">
                <p className="px-2 py-1 text-[10px] font-bold tracking-wider text-[#a4a4a4] uppercase">
                  Selected project
                </p>
                <PickerOption
                  label={`${selected.name}${selected.id === archivedProjectId ? " · archived" : ""}`}
                  detail={selected.client_name || "No client"}
                  active
                  color={selected.color}
                  onClick={() => requestClose(true)}
                />
              </div>
            ) : null}
            {grouped.length ? (
              grouped.map(([client, clientProjects]) => (
                <div key={client} className="mt-2 first:mt-1">
                  <p className="px-2 py-1 text-[10px] font-bold tracking-wider text-[#a4a4a4] uppercase">
                    {client}
                  </p>
                  {clientProjects.map((project) => (
                    <PickerOption
                      key={project.id}
                      label={`${project.name}${project.id === archivedProjectId ? " · archived" : ""}`}
                      color={project.color}
                      onClick={() => {
                        onChange(project.id);
                        requestClose(true);
                      }}
                    />
                  ))}
                </div>
              ))
            ) : selectedVisible ? null : (
              <p className="p-4 text-center text-sm text-[#a4a4a4]">No matching projects</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TagPicker({
  tags,
  value,
  open,
  onOpenChange,
  onChange,
}: {
  tags: Tag[];
  value: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const requestClose = (shouldRestore: boolean) => {
    setRestoreFocus(shouldRestore);
    onOpenChange(false);
  };
  useDismissPopover(root, () => requestClose(false), undefined, open);
  useEscapeToClose(open, () => requestClose(true));
  useRestoreFocus(open, trigger, restoreFocus, () => setRestoreFocus(false));
  useEffect(() => {
    if (open) setSearch("");
  }, [open]);
  const selectedTags = tags.filter((tag) => value.includes(tag.id));
  const visible = tags.filter((tag) => tag.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div ref={root} className="relative min-w-0">
      <button
        ref={trigger}
        type="button"
        className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs transition hover:bg-black/10 ${
          selectedTags.length ? "text-[#a4a4a4]" : "text-[#a4a4a4]/60"
        }`}
        aria-label={
          selectedTags.length
            ? `Tags: ${selectedTags.map((tag) => tag.name).join(", ")}`
            : "Choose entry tags"
        }
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => onOpenChange(!open)}
      >
        <Tags className="shrink-0" size={15} />
        <span className="truncate">
          {selectedTags.length ? selectedTags.map((tag) => tag.name).join(", ") : "Add tags"}
        </span>
      </button>
      {open ? (
        <div className="timer-popover fixed top-1/2 left-1/2 z-50 max-h-[80dvh] w-[min(92vw,280px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto xl:absolute xl:top-10 xl:right-0 xl:left-auto xl:max-h-none xl:translate-x-0 xl:translate-y-0">
          <div className="relative border-b border-[#3b3b3b] p-2">
            <Search className="absolute top-4 left-4 text-[#a4a4a4]" size={15} />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-full rounded-md border border-[#3b3b3b] bg-[#1b1b1b] pr-3 pl-9 text-sm text-[#fafafa] outline-none placeholder:text-[#a4a4a4]"
              placeholder="Filter tags"
              aria-label="Search entry tags"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {visible.length ? (
              visible.map((tag) => {
                const active = value.includes(tag.id);
                return (
                  <button
                    type="button"
                    key={tag.id}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-[#fafafa] hover:bg-white/8"
                    onClick={() =>
                      onChange(
                        active ? value.filter((tagId) => tagId !== tag.id) : [...value, tag.id],
                      )
                    }
                  >
                    <span
                      className="grid h-4 w-4 place-items-center rounded border"
                      style={{
                        borderColor: tag.color,
                        backgroundColor: active ? tag.color : "transparent",
                      }}
                    >
                      {active ? <Check size={11} className="text-white" /> : null}
                    </span>
                    {tag.name}
                  </button>
                );
              })
            ) : (
              <p className="p-4 text-center text-sm text-[#a4a4a4]">No matching tags</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TimePicker({
  timezone,
  running,
  startedAt,
  stoppedAt,
  durationSeconds,
  durationDraft,
  billable,
  financial,
  currency,
  rateMajor,
  open,
  onOpenChange,
  onRateChange,
  onStartChange,
  onStopChange,
  onDurationChange,
}: {
  timezone: string;
  running: boolean;
  startedAt: string;
  stoppedAt: string;
  durationSeconds: number;
  durationDraft: string;
  billable: boolean;
  financial: boolean;
  currency: string;
  rateMajor: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRateChange: (value: string) => void;
  onStartChange: (value: string) => void;
  onStopChange: (value: string) => void;
  onDurationChange: (value: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const requestClose = (shouldRestore: boolean) => {
    setRestoreFocus(shouldRestore);
    onOpenChange(false);
  };
  useDismissPopover(root, () => requestClose(false), undefined, open);
  useEscapeToClose(open, () => requestClose(true));
  useRestoreFocus(open, trigger, restoreFocus, () => setRestoreFocus(false));

  const displayTime = (value: string) => {
    if (!value) return "—";
    const instant = fromZonedTime(value, timezone);
    return Number.isFinite(instant.getTime()) ? formatInTimeZone(instant, timezone, "h:mm a") : "—";
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        className="flex h-9 items-center gap-3 rounded-md px-2 text-xs text-[#a4a4a4] tabular-nums transition hover:bg-black/10 hover:text-[#fafafa]"
        aria-label="Edit entry date, time, and duration"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => onOpenChange(!open)}
      >
        <span className="whitespace-nowrap">
          {displayTime(startedAt)} – {running ? "running" : displayTime(stoppedAt)}
        </span>
        <strong className="text-sm whitespace-nowrap text-[#fafafa]">
          {formatClockDuration(durationSeconds * 1000)}
        </strong>
      </button>
      {open ? (
        <div className="timer-popover fixed top-1/2 left-1/2 z-50 max-h-[80dvh] w-[min(92vw,410px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-3 xl:absolute xl:top-10 xl:right-0 xl:left-auto xl:max-h-none xl:translate-x-0 xl:translate-y-0">
          <div className="mb-3 flex items-center gap-2 border-b border-[#3b3b3b] pb-3">
            <CalendarClock size={17} className="text-[#fbbf24]" />
            <div>
              <p className="text-sm font-semibold text-[#fafafa]">Date and time</p>
              <p className="text-[11px] text-[#a4a4a4]">{timezone}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <DateTimeFields
              label="Start"
              value={startedAt}
              onChange={onStartChange}
              disabled={false}
            />
            <DateTimeFields
              label="Stop"
              value={stoppedAt}
              onChange={onStopChange}
              disabled={running}
            />
          </div>

          <div className="mt-3 grid items-end gap-3 border-t border-[#3b3b3b] pt-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[10px] font-bold tracking-wider text-[#a4a4a4] uppercase">
              Duration (h:mm:ss)
              <input
                className={`h-9 min-w-0 rounded-md border bg-[#1b1b1b] px-2.5 text-sm text-[#fafafa] tabular-nums outline-none ${
                  parseClockDuration(durationDraft)
                    ? "border-[#3b3b3b] focus:border-[#f59e0b]"
                    : "border-red-500/70"
                }`}
                value={durationDraft}
                disabled={running}
                inputMode="numeric"
                aria-label="Entry duration"
                onChange={(event) => onDurationChange(event.target.value)}
              />
            </label>
            {financial && billable ? (
              <label className="grid gap-1 text-[10px] font-bold tracking-wider text-[#a4a4a4] uppercase">
                Rate ({currency})
                <input
                  className="h-9 min-w-0 rounded-md border border-[#3b3b3b] bg-[#1b1b1b] px-2.5 text-right text-sm text-[#fafafa] outline-none focus:border-[#f59e0b]"
                  type="number"
                  min="0"
                  step="0.01"
                  value={rateMajor}
                  placeholder="Inherited"
                  onChange={(event) => onRateChange(event.target.value)}
                />
              </label>
            ) : (
              <button
                type="button"
                className="h-9 rounded-md border border-[#3b3b3b] text-xs font-semibold text-[#a4a4a4] hover:bg-white/7 hover:text-[#fafafa]"
                onClick={() => requestClose(true)}
              >
                Done
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DateTimeFields({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="min-w-0 rounded-lg border border-[#3b3b3b] bg-black/10 p-2.5 disabled:opacity-50">
      <legend className="px-1 text-[10px] font-bold tracking-wider text-[#a4a4a4] uppercase">
        {label}
      </legend>
      <div className="grid min-w-0 gap-2">
        <input
          className="h-8 min-w-0 rounded-md border border-[#3b3b3b] bg-[#1b1b1b] px-2 text-xs text-[#fafafa] outline-none focus:border-[#f59e0b]"
          type="date"
          value={value.slice(0, 10)}
          disabled={disabled}
          aria-label={`${label} date`}
          onChange={(event) => onChange(replaceDate(value, event.target.value))}
        />
        <input
          className="h-8 min-w-0 rounded-md border border-[#3b3b3b] bg-[#1b1b1b] px-2 text-xs text-[#fafafa] tabular-nums outline-none focus:border-[#f59e0b]"
          type="time"
          step={1}
          value={value.slice(11)}
          disabled={disabled}
          aria-label={`${label} time`}
          onChange={(event) => onChange(replaceTime(value, event.target.value))}
        />
      </div>
    </fieldset>
  );
}

function PickerOption({
  label,
  detail,
  active,
  color,
  onClick,
}: {
  label: string;
  detail?: string;
  active?: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label.replace(" · archived", "")}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
        active ? "bg-[#382b16] text-[#fbbf24]" : "text-[#fafafa] hover:bg-white/8"
      }`}
      onClick={onClick}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-[#a4a4a4]"
        style={color ? { backgroundColor: color } : undefined}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {detail ? (
          <span className="block truncate text-[11px] text-[#a4a4a4]">{detail}</span>
        ) : null}
      </span>
      {active ? <Check size={14} /> : null}
    </button>
  );
}
