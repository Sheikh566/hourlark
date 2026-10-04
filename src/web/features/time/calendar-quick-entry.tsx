import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addMinutes } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowRight, BriefcaseBusiness, Check, CircleDollarSign, Tags, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { localDateTimeToEpoch } from "@/domain/dates/time";
import { useMe } from "@/web/app/context";
import { Button, Input, Select } from "@/web/components/ui";
import {
  useDismissPopover,
  useEscapeToClose,
  useRestoreFocus,
} from "@/web/features/timer/use-dismiss-popover";
import { apiRequest } from "@/web/lib/api";
import { formatDuration, localInputValue } from "@/web/lib/format";
import type { Project, Tag, TimeEntry } from "@/web/types";

const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)$/;

function parseLocalDateTime(value: string, timezone: string): Date | null {
  if (!LOCAL_DATE_TIME.test(value)) return null;
  try {
    const epoch = localDateTimeToEpoch(value, timezone);
    if (!Number.isFinite(epoch)) return null;
    return new Date(epoch);
  } catch {
    return null;
  }
}

function timePart(value: string): string {
  const time = value.includes("T") ? value.slice(value.indexOf("T") + 1) : "";
  return /^\d{2}:\d{2}(?::\d{2})?$/.test(time) ? time : "";
}

function withTime(value: string, time: string): string {
  return `${value.slice(0, 10)}T${time}`;
}

function projectOptionLabel(project: { name: string; client_name: string }): string {
  if (!project.client_name || project.client_name === "No client") return project.name;
  return `${project.name} • ${project.client_name}`;
}

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
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const timezone = me.member.timezone;
  const canSetBillable = me.workspace.members_can_set_billable || me.member.role !== "member";
  const initialDuration = Math.max(1, Math.round((stop.getTime() - start.getTime()) / 60_000));
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState(localInputValue(start.toISOString(), timezone));
  const [stoppedAt, setStoppedAt] = useState(localInputValue(stop.toISOString(), timezone));
  const [durationMinutes, setDurationMinutes] = useState(initialDuration);
  const [billable, setBillable] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [timeError, setTimeError] = useState<string | null>(null);

  const tagRoot = useRef<HTMLDivElement>(null);
  const tagTrigger = useRef<HTMLButtonElement>(null);
  const [restoreTagFocus, setRestoreTagFocus] = useState(false);
  const closeTags = (shouldRestore: boolean) => {
    setRestoreTagFocus(shouldRestore);
    setShowTags(false);
  };
  useDismissPopover(tagRoot, () => closeTags(false), undefined, showTags);
  useEscapeToClose(showTags, () => closeTags(true));
  useEscapeToClose(!showTags, onClose);
  useRestoreFocus(showTags, tagTrigger, restoreTagFocus, () => setRestoreTagFocus(false));

  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedTags = useMemo(() => tags.filter((tag) => tagIds.includes(tag.id)), [tagIds, tags]);

  const preserveDurationFrom = (nextStart: string) => {
    const parsedStart = parseLocalDateTime(nextStart, timezone);
    if (!parsedStart || !Number.isFinite(durationMinutes) || durationMinutes < 1) return;
    const nextStop = addMinutes(parsedStart, durationMinutes);
    setStoppedAt(formatInTimeZone(nextStop, timezone, "yyyy-MM-dd'T'HH:mm"));
  };

  const recalculateDuration = (nextStop: string) => {
    const parsedStart = parseLocalDateTime(startedAt, timezone);
    const parsedStop = parseLocalDateTime(nextStop, timezone);
    if (!parsedStart || !parsedStop) return;
    const nextDuration = Math.round((parsedStop.getTime() - parsedStart.getTime()) / 60_000);
    if (nextDuration > 0) setDurationMinutes(nextDuration);
  };

  const mutation = useMutation({
    mutationFn: () => {
      const startInstant = parseLocalDateTime(startedAt, timezone);
      const stopInstant = parseLocalDateTime(stoppedAt, timezone);
      if (!startInstant || !stopInstant) throw new Error("Enter a valid start and stop time.");
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
          billable: canSetBillable ? billable : false,
        }),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
      ]);
      if (mounted.current) onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const startInstant = parseLocalDateTime(startedAt, timezone);
    const stopInstant = parseLocalDateTime(stoppedAt, timezone);
    if (!startInstant || !stopInstant) {
      setTimeError("Enter a valid start and stop time.");
      return;
    }
    if (stopInstant <= startInstant) {
      setTimeError("Stop must be after start.");
      return;
    }
    setTimeError(null);
    mutation.mutate();
  };

  return (
    <form
      className="dark-surface fixed top-1/2 left-1/2 z-30 flex max-h-[min(92vh,100dvh)] w-[min(92vw,500px)] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-[#3b3b3b] bg-[#212121] p-4 text-[#fafafa] shadow-[0_24px_70px_rgb(0_0_0_/_0.55)] md:left-[calc(50%+102px)]"
      aria-label="Add calendar time entry"
      onSubmit={submit}
    >
      <fieldset disabled={mutation.isPending} className="min-w-0 border-0 p-0">
        <div className="flex min-w-0 items-center gap-3">
          <Input
            autoFocus
            className="h-10 min-h-10 min-w-0 flex-1 border-0 bg-transparent px-1 text-base font-semibold focus:border focus:border-[#3b3b3b]"
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

        <div className="mt-2 grid min-w-0 items-center gap-2 border-t border-[#3b3b3b] pt-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="relative min-w-0">
            <BriefcaseBusiness
              className="pointer-events-none absolute top-2.5 left-2.5 text-[#a4a4a4]"
              size={15}
            />
            <Select
              className="h-9 min-h-9 pl-8"
              value={projectId}
              aria-label="New entry project"
              onChange={(event) => {
                const value = event.target.value;
                setProjectId(value);
                if (!canSetBillable) return;
                const project = projects.find((item) => item.id === value);
                setBillable(project?.billable_default === true || project?.billable_default === 1);
              }}
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {projectOptionLabel(project)}
                </option>
              ))}
            </Select>
          </label>

          <div ref={tagRoot} className="relative">
            <button
              ref={tagTrigger}
              type="button"
              className={`relative grid h-9 w-9 place-items-center rounded-lg transition ${
                tagIds.length
                  ? "bg-[#382b16] text-[#fbbf24]"
                  : "text-[#a4a4a4] hover:bg-white/7 hover:text-[#fafafa]"
              }`}
              aria-label={tagIds.length ? `${tagIds.length} tags selected` : "Choose tags"}
              aria-expanded={showTags}
              onClick={() => setShowTags((value) => !value)}
            >
              <Tags size={17} />
            </button>
            {showTags ? (
              <div className="absolute top-11 left-0 z-10 max-h-52 w-56 overflow-y-auto rounded-lg border border-[#3b3b3b] bg-[#212121] p-1.5 shadow-xl sm:right-0 sm:left-auto">
                {tags.length ? (
                  tags.map((tag) => {
                    const selected = tagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-[#fafafa] hover:bg-white/7"
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
                  <p className="p-3 text-center text-xs text-[#a4a4a4]">No active tags</p>
                )}
              </div>
            ) : null}
          </div>

          {canSetBillable ? (
            <button
              type="button"
              className={`grid h-9 w-9 place-items-center rounded-lg transition ${
                billable
                  ? "bg-[#382b16] text-[#fbbf24]"
                  : "text-[#a4a4a4] hover:bg-white/7 hover:text-[#fafafa]"
              }`}
              aria-label={billable ? "Mark non-billable" : "Mark billable"}
              aria-pressed={billable}
              onClick={() => setBillable((value) => !value)}
            >
              <CircleDollarSign size={17} />
            </button>
          ) : null}
        </div>

        <div className="mt-3 flex min-w-0 flex-wrap items-end gap-2">
          <label className="grid min-w-0 gap-1 text-[10px] font-bold tracking-wider text-[#a4a4a4] uppercase">
            Start
            <Input
              className="h-9 min-h-9 w-full max-w-[9rem] min-w-0 px-2"
              type="time"
              step={1}
              value={timePart(startedAt)}
              aria-label="Start time"
              onChange={(event) => {
                const nextStart = withTime(startedAt, event.target.value);
                setStartedAt(nextStart);
                setTimeError(null);
                preserveDurationFrom(nextStart);
              }}
            />
          </label>
          <ArrowRight className="mb-2.5 shrink-0 text-[#a4a4a4]" size={14} />
          <label className="grid min-w-0 gap-1 text-[10px] font-bold tracking-wider text-[#a4a4a4] uppercase">
            Stop
            <Input
              className="h-9 min-h-9 w-full max-w-[9rem] min-w-0 px-2"
              type="time"
              step={1}
              value={timePart(stoppedAt)}
              aria-label="Stop time"
              onChange={(event) => {
                const nextStop = withTime(stoppedAt, event.target.value);
                setStoppedAt(nextStop);
                setTimeError(null);
                recalculateDuration(nextStop);
              }}
            />
          </label>
          <div className="mb-2 ml-auto min-w-14 text-right font-mono text-sm font-semibold text-[#fafafa]">
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
          <p className="mt-2 truncate text-[11px] text-[#a4a4a4]">
            {[selectedProject?.name, ...selectedTags.map((tag) => `#${tag.name}`)]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
      </fieldset>
      {timeError || mutation.error ? (
        <p className="mt-2 text-xs text-red-300" role="alert">
          {timeError ?? mutation.error?.message}
        </p>
      ) : null}
    </form>
  );
}
