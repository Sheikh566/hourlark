import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addSeconds } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { CalendarClock, Check, CircleDollarSign, Search, Tags, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";

import { majorToMinor, minorToMajor } from "@/domain/billing/money";
import { useMe } from "@/web/app/context";
import { Button } from "@/web/components/ui";
import { ApiClientError, apiRequest } from "@/web/lib/api";
import { formatClockDuration } from "@/web/lib/format";
import type { Project, Tag, TimeEntry } from "@/web/types";

function localValueWithSeconds(iso: string, timezone: string): string {
  return formatInTimeZone(new Date(iso), timezone, "yyyy-MM-dd'T'HH:mm:ss");
}

function parseClockDuration(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2] ?? 0);
  if (minutes > 59 || seconds > 59) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

function replaceDate(value: string, date: string): string {
  return `${date}${value.slice(10)}`;
}

function replaceTime(value: string, time: string): string {
  return `${value.slice(0, 10)}T${time}`;
}

interface InlineEntryEditorProps {
  entry: TimeEntry;
  projects: Project[];
  tags: Tag[];
  onCancel: () => void;
  onSaved: () => void;
}

type ProjectChoice = Pick<Project, "id" | "name" | "color" | "client_name">;

export function InlineEntryEditor({
  entry,
  projects,
  tags,
  onCancel,
  onSaved,
}: InlineEntryEditorProps) {
  const me = useMe();
  const queryClient = useQueryClient();
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
    setStoppedAt(
      localValueWithSeconds(addSeconds(start, seconds).toISOString(), me.member.timezone),
    );
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
      const start = fromZonedTime(startedAt, me.member.timezone);
      const stop = entry.running ? null : fromZonedTime(stoppedAt, me.member.timezone);
      if (stop && stop <= start) throw new Error("Stop must be after start.");

      const input = {
        version: entry.version,
        description,
        project_id: projectId || null,
        tag_ids: tagIds,
        started_at: start.toISOString(),
        ...(stop ? { stopped_at: stop.toISOString() } : {}),
        billable,
        ...(me.permissions.financial && billable && rateMajor
          ? {
              rate_minor: majorToMinor(rateMajor, me.workspace.currency),
              rate_currency: me.workspace.currency,
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
      onSaved();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.code === "entry_conflict") {
        void queryClient.invalidateQueries({ queryKey: ["time-entries"] });
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <form
      className="border-frosted-mint-700/40 border-b border-l-2 bg-white/[0.055] px-4 py-2 md:px-5"
      aria-label={`Edit ${entry.description || "time entry"}`}
      onSubmit={submit}
    >
      <div className="grid min-h-12 items-center gap-2 md:grid-cols-[auto_minmax(280px,1fr)_minmax(120px,0.55fr)_auto_auto]">
        <span className="h-4 w-4" aria-hidden="true" />

        <div className="flex min-w-0 items-center gap-3">
          <input
            autoFocus
            className="h-9 min-w-[120px] flex-[1_1_52%] rounded-md border border-transparent bg-transparent px-1.5 text-sm font-semibold text-slate-100 outline-none placeholder:text-slate-500 hover:bg-black/10 focus:border-white/12 focus:bg-[#111710]"
            value={description}
            maxLength={500}
            placeholder="Add description"
            aria-label="Entry description"
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancel();
            }}
          />
          <ProjectPicker
            projects={availableProjects}
            value={projectId}
            archivedProjectId={
              entry.project && !projects.some((project) => project.id === entry.project?.id)
                ? entry.project.id
                : null
            }
            onChange={setProjectId}
          />
        </div>

        <TagPicker tags={availableTags} value={tagIds} onChange={setTagIds} />

        <div className="flex items-center justify-end gap-1">
          {me.workspace.members_can_set_billable || me.member.role !== "member" ? (
            <button
              type="button"
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-md transition ${
                billable
                  ? "bg-frosted-mint-900 text-light-green-400"
                  : "text-slate-600 hover:bg-white/7 hover:text-slate-300"
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
            currency={me.workspace.currency}
            rateMajor={rateMajor}
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
            className="h-8 min-h-8 w-8 rounded-md p-0"
            aria-label="Cancel editing"
            onClick={onCancel}
          >
            <X size={16} />
          </Button>
          <Button
            type="submit"
            variant="accent"
            className="h-8 min-h-8 w-8 rounded-md p-0"
            aria-label="Save time entry"
            disabled={mutation.isPending}
          >
            <Check size={17} />
          </Button>
        </div>
      </div>

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
  onChange,
}: {
  projects: ProjectChoice[];
  value: string;
  archivedProjectId: string | null;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useDismissPopover(root, () => setOpen(false));
  const selected = projects.find((project) => project.id === value);
  const grouped = useMemo(() => {
    const result = new Map<string, ProjectChoice[]>();
    for (const project of projects) {
      if (
        search &&
        !`${project.name} ${project.client_name}`.toLowerCase().includes(search.toLowerCase())
      ) {
        continue;
      }
      const client = project.client_name || "No client";
      result.set(client, [...(result.get(client) ?? []), project]);
    }
    return [...result.entries()];
  }, [projects, search]);

  return (
    <div ref={root} className="relative min-w-0 flex-[1_1_42%]">
      <button
        type="button"
        className={`flex h-9 max-w-full items-center gap-2 rounded-md px-2 text-left text-sm transition hover:bg-black/10 ${
          selected ? "text-frosted-mint-300" : "text-slate-500"
        }`}
        aria-label={selected ? `Project: ${selected.name}` : "Choose entry project"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-slate-600"
          style={selected?.color ? { backgroundColor: selected.color } : undefined}
        />
        <span className="truncate">{selected?.name ?? "Add project"}</span>
      </button>
      {open ? (
        <div className="timer-popover absolute top-10 left-0 z-50 w-[min(88vw,360px)]">
          <div className="relative border-b border-white/10 p-2">
            <Search className="absolute top-4 left-4 text-slate-500" size={15} />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-full rounded-md border border-white/15 bg-[#0d120c] pr-3 pl-9 text-sm text-slate-100 outline-none placeholder:text-slate-600"
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
                setOpen(false);
              }}
            />
            {grouped.map(([client, clientProjects]) => (
              <div key={client} className="mt-2 first:mt-1">
                <p className="px-2 py-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                  {client}
                </p>
                {clientProjects.map((project) => (
                  <PickerOption
                    key={project.id}
                    label={`${project.name}${project.id === archivedProjectId ? " · archived" : ""}`}
                    active={project.id === value}
                    color={project.color}
                    onClick={() => {
                      onChange(project.id);
                      setOpen(false);
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TagPicker({
  tags,
  value,
  onChange,
}: {
  tags: Tag[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useDismissPopover(root, () => setOpen(false));
  const selectedTags = tags.filter((tag) => value.includes(tag.id));
  const visible = tags.filter((tag) => tag.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs transition hover:bg-black/10 ${
          selectedTags.length ? "text-slate-400" : "text-slate-600"
        }`}
        aria-label={
          selectedTags.length
            ? `Tags: ${selectedTags.map((tag) => tag.name).join(", ")}`
            : "Choose entry tags"
        }
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Tags className="shrink-0" size={15} />
        <span className="truncate">
          {selectedTags.length ? selectedTags.map((tag) => tag.name).join(", ") : "Add tags"}
        </span>
      </button>
      {open ? (
        <div className="timer-popover absolute top-10 right-0 z-50 w-[min(82vw,280px)]">
          <div className="relative border-b border-white/10 p-2">
            <Search className="absolute top-4 left-4 text-slate-500" size={15} />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-full rounded-md border border-white/15 bg-[#0d120c] pr-3 pl-9 text-sm text-slate-100 outline-none placeholder:text-slate-600"
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
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-slate-300 hover:bg-white/8 hover:text-white"
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
              <p className="p-4 text-center text-sm text-slate-500">No matching tags</p>
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
  onRateChange: (value: string) => void;
  onStartChange: (value: string) => void;
  onStopChange: (value: string) => void;
  onDurationChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismissPopover(root, () => setOpen(false));

  const displayTime = (value: string) => {
    if (!value) return "—";
    return formatInTimeZone(fromZonedTime(value, timezone), timezone, "h:mm a");
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="flex h-9 items-center gap-3 rounded-md px-2 font-mono text-xs text-slate-400 transition hover:bg-black/10 hover:text-slate-200"
        aria-label="Edit entry date, time, and duration"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="whitespace-nowrap">
          {displayTime(startedAt)} – {running ? "running" : displayTime(stoppedAt)}
        </span>
        <strong className="text-sm whitespace-nowrap text-slate-100">
          {formatClockDuration(durationSeconds * 1000)}
        </strong>
      </button>
      {open ? (
        <div className="timer-popover absolute top-10 right-0 z-50 w-[min(94vw,410px)] p-3">
          <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3">
            <CalendarClock size={17} className="text-frosted-mint-400" />
            <div>
              <p className="text-sm font-semibold text-slate-100">Date and time</p>
              <p className="text-[11px] text-slate-500">{timezone}</p>
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

          <div className="mt-3 grid items-end gap-3 border-t border-white/10 pt-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
              Duration (h:mm:ss)
              <input
                className={`h-9 min-w-0 rounded-md border bg-[#0d120c] px-2.5 font-mono text-sm text-slate-100 outline-none ${
                  parseClockDuration(durationDraft)
                    ? "focus:border-frosted-mint-700 border-white/15"
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
              <label className="grid gap-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                Rate ({currency})
                <input
                  className="focus:border-frosted-mint-700 h-9 min-w-0 rounded-md border border-white/15 bg-[#0d120c] px-2.5 text-right text-sm text-slate-100 outline-none"
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
                className="h-9 rounded-md border border-white/10 text-xs font-semibold text-slate-400 hover:bg-white/7 hover:text-slate-100"
                onClick={() => setOpen(false)}
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
    <fieldset className="min-w-0 rounded-lg border border-white/10 bg-black/10 p-2.5 disabled:opacity-50">
      <legend className="px-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
        {label}
      </legend>
      <div className="grid min-w-0 gap-2">
        <input
          className="focus:border-frosted-mint-700 h-8 min-w-0 rounded-md border border-white/12 bg-[#0d120c] px-2 text-xs text-slate-200 outline-none"
          type="date"
          value={value.slice(0, 10)}
          disabled={disabled}
          aria-label={`${label} date`}
          onChange={(event) => onChange(replaceDate(value, event.target.value))}
        />
        <input
          className="focus:border-frosted-mint-700 h-8 min-w-0 rounded-md border border-white/12 bg-[#0d120c] px-2 font-mono text-xs text-slate-200 outline-none"
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
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
        active
          ? "bg-frosted-mint-900 text-frosted-mint-200"
          : "text-slate-300 hover:bg-white/8 hover:text-white"
      }`}
      onClick={onClick}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-slate-600"
        style={color ? { backgroundColor: color } : undefined}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active ? <Check size={14} /> : null}
    </button>
  );
}

function useDismissPopover(root: RefObject<HTMLDivElement | null>, dismiss: () => void) {
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) dismiss();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [dismiss, root]);
}
