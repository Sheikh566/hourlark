import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addMinutes } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { Check, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { majorToMinor, minorToMajor } from "@/domain/billing/money";
import { useMe } from "@/web/app/context";
import { Button, Input, Select } from "@/web/components/ui";
import { ApiClientError, apiRequest } from "@/web/lib/api";
import type { Project, Tag, TimeEntry } from "@/web/types";

function localValueWithSeconds(iso: string, timezone: string): string {
  return formatInTimeZone(new Date(iso), timezone, "yyyy-MM-dd'T'HH:mm:ss");
}

interface InlineEntryEditorProps {
  entry: TimeEntry;
  projects: Project[];
  tags: Tag[];
  onCancel: () => void;
  onSaved: () => void;
}

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
  const initialDuration = Math.max(
    1,
    Math.round((new Date(initialStop).getTime() - new Date(entry.started_at).getTime()) / 60_000),
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
  const [durationMinutes, setDurationMinutes] = useState(initialDuration);
  const [billable, setBillable] = useState(entry.billable);
  const [rateMajor, setRateMajor] = useState(
    entry.rate_minor === null || entry.rate_minor === undefined
      ? ""
      : String(minorToMajor(entry.rate_minor, entry.rate_currency ?? me.workspace.currency)),
  );

  const availableTags = useMemo(() => {
    const merged = new Map(tags.map((tag) => [tag.id, tag]));
    for (const tag of entry.tags) merged.set(tag.id, tag);
    return [...merged.values()];
  }, [entry.tags, tags]);

  const updateStopFromDuration = (minutes: number, startValue = startedAt) => {
    if (!Number.isFinite(minutes) || minutes < 1 || !startValue) return;
    const start = fromZonedTime(startValue, me.member.timezone);
    setStoppedAt(
      localValueWithSeconds(addMinutes(start, minutes).toISOString(), me.member.timezone),
    );
  };
  const updateDurationFromTimes = (startValue: string, stopValue: string) => {
    if (!startValue || !stopValue) return;
    const start = fromZonedTime(startValue, me.member.timezone).getTime();
    const stop = fromZonedTime(stopValue, me.member.timezone).getTime();
    if (stop > start) setDurationMinutes(Math.max(1, Math.round((stop - start) / 60_000)));
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
      className="border-frosted-mint-700/50 border-b border-l-2 bg-[#182117] px-4 py-3"
      aria-label={`Edit ${entry.description || "time entry"}`}
      onSubmit={submit}
    >
      <div className="grid items-end gap-2 lg:grid-cols-[minmax(220px,1.4fr)_minmax(180px,0.8fr)_160px_160px_110px_auto]">
        <label className="grid gap-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
          Description
          <Input
            autoFocus
            className="h-9 min-h-9"
            value={description}
            maxLength={500}
            placeholder="What did you work on?"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
          Project
          <Select
            className="h-9 min-h-9"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">No project</option>
            {entry.project && !projects.some((project) => project.id === entry.project?.id) ? (
              <option value={entry.project.id}>{entry.project.name} · archived</option>
            ) : null}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.client_name} · {project.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
          Start
          <Input
            className="h-9 min-h-9 px-2"
            type="datetime-local"
            step={1}
            value={startedAt}
            onChange={(event) => {
              const nextStart = event.target.value;
              setStartedAt(nextStart);
              if (!entry.running) updateStopFromDuration(durationMinutes, nextStart);
            }}
          />
        </label>
        <label className="grid gap-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
          Stop
          <Input
            className="h-9 min-h-9 px-2"
            type="datetime-local"
            step={1}
            value={stoppedAt}
            disabled={entry.running}
            title={entry.running ? "Stop the timer before setting a stop time" : undefined}
            onChange={(event) => {
              setStoppedAt(event.target.value);
              updateDurationFromTimes(startedAt, event.target.value);
            }}
          />
        </label>
        <label className="grid gap-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
          Minutes
          <Input
            className="h-9 min-h-9 px-2 font-mono"
            type="number"
            min={1}
            max={7 * 24 * 60}
            value={durationMinutes}
            disabled={entry.running}
            onChange={(event) => {
              const minutes = Number(event.target.value);
              setDurationMinutes(minutes);
              updateStopFromDuration(minutes);
            }}
          />
        </label>
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            className="h-9 w-9 p-0"
            aria-label="Cancel editing"
            onClick={onCancel}
          >
            <X size={16} />
          </Button>
          <Button
            type="submit"
            variant="accent"
            className="h-9 w-9 p-0"
            aria-label="Save time entry"
            disabled={mutation.isPending}
          >
            <Check size={17} />
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {availableTags.map((tag) => {
          const selected = tagIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition ${
                selected
                  ? "text-slate-100"
                  : "border-white/10 bg-white/3 text-slate-500 hover:text-slate-200"
              }`}
              style={
                selected
                  ? { borderColor: `${tag.color}99`, backgroundColor: `${tag.color}2b` }
                  : undefined
              }
              aria-pressed={selected}
              onClick={() =>
                setTagIds((current) =>
                  selected ? current.filter((id) => id !== tag.id) : [...current, tag.id],
                )
              }
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
              {tag.name}
            </button>
          );
        })}
        {me.workspace.members_can_set_billable || me.member.role !== "member" ? (
          <label className="ml-auto flex h-7 items-center gap-2 rounded-md border border-white/10 px-2.5 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={billable}
              onChange={(event) => setBillable(event.target.checked)}
            />
            Billable
          </label>
        ) : null}
        {me.permissions.financial && billable ? (
          <label className="flex h-7 items-center gap-2 text-xs text-slate-500">
            Rate ({me.workspace.currency})
            <input
              className="h-7 w-24 rounded-md border border-white/15 bg-[#111710] px-2 text-right text-xs text-slate-100"
              type="number"
              min="0"
              step="0.01"
              value={rateMajor}
              placeholder="Inherited"
              onChange={(event) => setRateMajor(event.target.value)}
            />
          </label>
        ) : null}
      </div>
      {mutation.error ? (
        <p className="mt-2 text-xs text-red-300" role="alert">
          {mutation.error instanceof ApiClientError && mutation.error.code === "entry_conflict"
            ? "This entry changed elsewhere. The latest values were reloaded; open it again to continue."
            : mutation.error.message}
        </p>
      ) : null}
    </form>
  );
}
