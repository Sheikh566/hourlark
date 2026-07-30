import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addMinutes } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { ArrowRight, BriefcaseBusiness, Check, CircleDollarSign, Tags, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { useMe } from "@/web/app/context";
import { Button, Input, Select } from "@/web/components/ui";
import { apiRequest } from "@/web/lib/api";
import { formatDuration, localInputValue } from "@/web/lib/format";
import type { Project, Tag, TimeEntry } from "@/web/types";

interface CalendarQuickEntryProps {
  start: Date;
  stop: Date;
  targetMemberId?: string;
  projects: Project[];
  tags: Tag[];
  onClose: () => void;
}

export function CalendarQuickEntry({
  start,
  stop,
  targetMemberId,
  projects,
  tags,
  onClose,
}: CalendarQuickEntryProps) {
  const me = useMe();
  const queryClient = useQueryClient();
  const initialDuration = Math.max(1, Math.round((stop.getTime() - start.getTime()) / 60_000));
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState(
    localInputValue(start.toISOString(), me.member.timezone),
  );
  const [stoppedAt, setStoppedAt] = useState(
    localInputValue(stop.toISOString(), me.member.timezone),
  );
  const [durationMinutes, setDurationMinutes] = useState(initialDuration);
  const [billable, setBillable] = useState(false);
  const [showTags, setShowTags] = useState(false);

  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedTags = useMemo(() => tags.filter((tag) => tagIds.includes(tag.id)), [tagIds, tags]);

  const preserveDurationFrom = (nextStart: string) => {
    if (!nextStart || !Number.isFinite(durationMinutes)) return;
    const nextStop = addMinutes(fromZonedTime(nextStart, me.member.timezone), durationMinutes);
    setStoppedAt(localInputValue(nextStop.toISOString(), me.member.timezone));
  };

  const recalculateDuration = (nextStop: string) => {
    if (!startedAt || !nextStop) return;
    const nextDuration = Math.round(
      (fromZonedTime(nextStop, me.member.timezone).getTime() -
        fromZonedTime(startedAt, me.member.timezone).getTime()) /
        60_000,
    );
    if (nextDuration > 0) setDurationMinutes(nextDuration);
  };

  const mutation = useMutation({
    mutationFn: () => {
      const startInstant = fromZonedTime(startedAt, me.member.timezone);
      const stopInstant = fromZonedTime(stoppedAt, me.member.timezone);
      if (stopInstant <= startInstant) throw new Error("Stop must be after start.");
      return apiRequest<{ entry: TimeEntry }>("/time-entries", {
        method: "POST",
        body: JSON.stringify({
          ...(targetMemberId ? { member_id: targetMemberId } : {}),
          description,
          project_id: projectId || null,
          tag_ids: tagIds,
          started_at: startInstant.toISOString(),
          stopped_at: stopInstant.toISOString(),
          billable,
        }),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
      ]);
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };
  const timePart = (value: string) => value.slice(11, 16);
  const withTime = (value: string, time: string) => `${value.slice(0, 10)}T${time}`;

  return (
    <form
      className="dark-surface fixed top-1/2 left-1/2 z-30 w-[min(92vw,500px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/15 bg-[#171d16] p-4 shadow-[0_24px_70px_rgb(0_0_0_/_0.55)] md:left-[calc(50%+102px)]"
      aria-label="Add calendar time entry"
      onSubmit={submit}
    >
      <div className="flex items-center gap-3">
        <Input
          autoFocus
          className="h-10 min-h-10 flex-1 border-0 bg-transparent px-1 text-base font-semibold focus:border focus:border-white/15"
          value={description}
          maxLength={500}
          placeholder="What did you work on?"
          aria-label="New entry description"
          onChange={(event) => setDescription(event.target.value)}
        />
        <Button
          type="button"
          variant="ghost"
          className="h-8 w-8 shrink-0 p-0"
          aria-label="Cancel new entry"
          onClick={onClose}
        >
          <X size={16} />
        </Button>
      </div>

      <div className="mt-2 grid items-center gap-2 border-t border-white/8 pt-3 sm:grid-cols-[minmax(150px,1fr)_auto_auto]">
        <label className="relative">
          <BriefcaseBusiness
            className="pointer-events-none absolute top-2.5 left-2.5 text-slate-500"
            size={15}
          />
          <Select
            className="h-9 min-h-9 pl-8"
            value={projectId}
            aria-label="New entry project"
            onChange={(event) => {
              const value = event.target.value;
              setProjectId(value);
              const project = projects.find((item) => item.id === value);
              setBillable(project?.billable_default === true || project?.billable_default === 1);
            }}
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.client_name} · {project.name}
              </option>
            ))}
          </Select>
        </label>

        <div className="relative">
          <button
            type="button"
            className={`relative grid h-9 w-9 place-items-center rounded-lg transition ${
              tagIds.length
                ? "bg-frosted-mint-900 text-light-green-400"
                : "text-slate-500 hover:bg-white/7 hover:text-slate-200"
            }`}
            aria-label={tagIds.length ? `${tagIds.length} tags selected` : "Choose tags"}
            aria-expanded={showTags}
            onClick={() => setShowTags((value) => !value)}
          >
            <Tags size={17} />
          </button>
          {showTags ? (
            <div className="absolute top-11 right-0 z-10 max-h-52 w-56 overflow-y-auto rounded-lg border border-white/12 bg-[#111710] p-1.5 shadow-xl">
              {tags.length ? (
                tags.map((tag) => {
                  const selected = tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-slate-300 hover:bg-white/7"
                      onClick={() =>
                        setTagIds((current) =>
                          selected
                            ? current.filter((tagId) => tagId !== tag.id)
                            : [...current, tag.id],
                        )
                      }
                    >
                      <span
                        className="grid h-4 w-4 place-items-center rounded border"
                        style={{
                          borderColor: tag.color,
                          backgroundColor: selected ? tag.color : "transparent",
                        }}
                      >
                        {selected ? <Check size={11} className="text-white" /> : null}
                      </span>
                      {tag.name}
                    </button>
                  );
                })
              ) : (
                <p className="p-3 text-center text-xs text-slate-500">No active tags</p>
              )}
            </div>
          ) : null}
        </div>

        {me.workspace.members_can_set_billable || me.member.role !== "member" ? (
          <button
            type="button"
            className={`grid h-9 w-9 place-items-center rounded-lg transition ${
              billable
                ? "bg-frosted-mint-900 text-light-green-400"
                : "text-slate-500 hover:bg-white/7 hover:text-slate-200"
            }`}
            aria-label={billable ? "Mark non-billable" : "Mark billable"}
            aria-pressed={billable}
            onClick={() => setBillable((value) => !value)}
          >
            <CircleDollarSign size={17} />
          </button>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
          Start
          <Input
            className="h-9 min-h-9 w-[105px] px-2"
            type="time"
            value={timePart(startedAt)}
            onChange={(event) => {
              const nextStart = withTime(startedAt, event.target.value);
              setStartedAt(nextStart);
              preserveDurationFrom(nextStart);
            }}
          />
        </label>
        <ArrowRight className="mb-2.5 shrink-0 text-slate-600" size={14} />
        <label className="grid gap-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
          Stop
          <Input
            className="h-9 min-h-9 w-[105px] px-2"
            type="time"
            value={timePart(stoppedAt)}
            onChange={(event) => {
              const nextStop = withTime(stoppedAt, event.target.value);
              setStoppedAt(nextStop);
              recalculateDuration(nextStop);
            }}
          />
        </label>
        <div className="mb-2 ml-auto min-w-14 text-right font-mono text-sm font-semibold text-slate-300">
          {formatDuration(durationMinutes * 60_000)}
        </div>
        <Button
          type="submit"
          variant="accent"
          className="h-9 min-h-9 px-5"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Adding…" : "Add"}
        </Button>
      </div>

      {selectedProject || selectedTags.length ? (
        <p className="mt-2 truncate text-[11px] text-slate-500">
          {[selectedProject?.name, ...selectedTags.map((tag) => `#${tag.name}`)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      {mutation.error ? (
        <p className="mt-2 text-xs text-red-300" role="alert">
          {mutation.error.message}
        </p>
      ) : null}
    </form>
  );
}
