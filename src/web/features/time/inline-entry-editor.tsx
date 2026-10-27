import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addSeconds } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { twMerge } from "tailwind-merge";

import { majorToMinor, minorToMajor } from "@/domain/billing/money";
import { useMe } from "@/web/app/context";
import { Input } from "@/web/components/ui";
import {
  BillableCell,
  entryRowClassName,
  entryRowExtrasClassName,
  ProjectCell,
  TagsCell,
  TimeCell,
} from "@/web/features/time/list-entry-row";
import {
  CreateProjectFooter,
  PickerHeading,
  PopoverSearch as ProjectSearch,
} from "@/web/features/timer/timer-pickers";
import { projectPickerTextColor } from "@/web/features/timer/project-tint";
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
  /** Child session of an expanded group: indented 40px like the display row. */
  nested?: boolean;
  onCancel: () => void;
  onSaved: () => void;
}

type ProjectChoice = Pick<Project, "id" | "name" | "color" | "client_name">;

/**
 * Popover surface placement shared by the three pickers. Toggl opens each popover under the
 * clicked cell on the same 50px row; on narrow screens it centers in the viewport instead.
 */
const popoverPlacement =
  "fixed top-1/2 left-1/2 z-50 max-h-[80dvh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto lg:absolute lg:top-[calc(100%+4px)] lg:max-h-none lg:translate-x-0 lg:translate-y-0 lg:overflow-visible";

/**
 * Toggl edits in place: the row keeps its 50px height, the description becomes a borderless input
 * and project, tags and time open their own popovers. Enter or a click outside saves a changed
 * entry (an unchanged one just closes); Escape cancels. Visually hidden Save/Cancel buttons keep
 * the form operable by keyboard and assistive technology.
 */
export function InlineEntryEditor({
  entry,
  projects,
  tags,
  initialField = "description",
  nested = false,
  onCancel,
  onSaved,
}: InlineEntryEditorProps) {
  const me = useMe();
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  const saving = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
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
  const [initial] = useState({
    description,
    projectId,
    tagIds: tagIds.join(","),
    startedAt,
    stoppedAt,
    durationDraft,
    billable,
    rateMajor,
  });
  const dirty =
    description !== initial.description ||
    projectId !== initial.projectId ||
    tagIds.join(",") !== initial.tagIds ||
    startedAt !== initial.startedAt ||
    stoppedAt !== initial.stoppedAt ||
    durationDraft !== initial.durationDraft ||
    billable !== initial.billable ||
    rateMajor !== initial.rateMajor;

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
    onSettled: () => {
      saving.current = false;
    },
  });

  const save = () => {
    if (saving.current) return;
    saving.current = true;
    mutation.mutate();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save();
  };

  // Consume the outside click until saving succeeds so another row cannot discard a failed draft.
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (formRef.current?.contains(event.target as Node)) return;
      if (dirty || saving.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        save();
      } else onCancel();
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  });

  const canSetBillable = me.workspace.members_can_set_billable || me.member.role !== "member";

  return (
    <div>
      <form
        ref={formRef}
        className={twMerge(entryRowClassName, "bg-surface-hover [&_.text-fg-subtle]:text-fg-muted")}
        aria-label={`Edit ${entry.description || "time entry"}`}
        onSubmit={submit}
        onBlur={(event) => {
          if (!event.relatedTarget || event.currentTarget.contains(event.relatedTarget)) return;
          if (dirty) save();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || openField) return;
          event.preventDefault();
          if (!saving.current) onCancel();
        }}
      >
        <fieldset disabled={mutation.isPending} className="contents">
          <span className="h-[14px]" aria-hidden="true" />

          <div className={twMerge("flex min-w-0 items-center", nested && "pl-10")}>
            <input
              autoFocus={initialField === "description"}
              className="entry-inline-input text-fg placeholder:text-fg-subtle caret-accent h-[17px] w-[210px] max-w-[60%] shrink-0 bg-transparent p-0 text-sm font-normal"
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

          <div className={entryRowExtrasClassName}>
            <TagPicker
              tags={availableTags}
              value={tagIds}
              open={openField === "tags"}
              onOpenChange={(next) => setOpenField(next ? "tags" : null)}
              onChange={setTagIds}
            />

            <div className="flex h-full items-center">
              {canSetBillable ? (
                <BillableCell
                  billable={billable}
                  visible
                  onToggle={() => setBillable((value) => !value)}
                />
              ) : null}
            </div>

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

            <div className="flex h-full items-center justify-end gap-0.5 lg:col-span-2">
              <button
                type="button"
                className="text-fg-muted hover:bg-surface-hover hover:text-fg sr-only size-[30px] place-items-center rounded-lg focus:not-sr-only focus:grid"
                aria-label="Cancel editing"
                onClick={onCancel}
              >
                <X size={16} aria-hidden="true" />
              </button>
              <button
                type="submit"
                className="bg-accent text-fg-inverted hover:bg-accent-hover sr-only size-[30px] place-items-center rounded-lg focus:not-sr-only focus:grid"
                aria-label="Save time entry"
                disabled={mutation.isPending}
              >
                <Check size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </fieldset>
      </form>
      {mutation.error ? (
        <p className="text-error-fg px-5 pb-2 pl-[50px] text-xs font-medium" role="alert">
          {mutation.error instanceof ApiClientError && mutation.error.code === "entry_conflict"
            ? "This entry changed elsewhere. The latest values were reloaded; open it again to continue."
            : mutation.error.message}
        </p>
      ) : null}
    </div>
  );
}

/** Popover search field: 30px, radius 8, Toggl's focus ring. */
function PopoverSearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="border-b border-[#191919] px-[15px] pb-2.5">
      <div className="bg-surface text-fg-muted box-border flex h-[30px] items-center gap-2.5 rounded-lg px-3 shadow-[inset_0_0_0_1px_var(--color-control)] focus-within:shadow-[0_0_0_1px_var(--color-surface),0_0_0_3px_#555,inset_0_0_0_1px_var(--color-fg-secondary)]">
        <Search className="shrink-0" size={14} aria-hidden="true" />
        <input
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="entry-inline-input text-fg placeholder:text-fg-subtle h-full min-w-0 flex-1 bg-transparent text-sm font-medium"
          placeholder={placeholder}
          aria-label={label}
        />
      </div>
    </div>
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
  const me = useMe();
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
    <div ref={root} className="relative flex min-w-0 flex-1 items-center">
      <ProjectCell
        entry={{
          project: selected
            ? { id: selected.id, name: selected.name, color: selected.color }
            : null,
          client:
            selected && selected.client_name && selected.client_name !== "No client"
              ? { id: "", name: selected.client_name }
              : null,
        }}
        onClick={() => onOpenChange(!open)}
        title={selectedLabel ?? "Add project"}
        visible
        buttonProps={{
          ref: trigger,
          "aria-label": selected ? `Project: ${selectedLabel}` : "Choose entry project",
          "aria-expanded": open,
          "aria-haspopup": "listbox",
        }}
      />
      {open ? (
        <div
          className={twMerge(
            popoverPlacement,
            "timer-popover w-[min(92vw,360px)] pt-[5px] lg:top-[calc(100%+9px)] lg:-left-2",
          )}
        >
          <div className="border-surface-raised mt-2 flex h-[47px] items-start border-b pt-[3px] pr-[59px] pl-[15px]">
            <ProjectSearch
              value={search}
              onChange={setSearch}
              placeholder="Search by project, task or client"
              label="Search entry projects"
              clearLabel="Clear entry project search"
            />
          </div>
          <div className="mt-3 ml-px max-h-[324px] [scrollbar-gutter:stable] overflow-y-auto">
            <PickerOption
              label="No Project"
              active={!value}
              onClick={() => {
                onChange("");
                requestClose(true);
              }}
            />
            {selected && selectedVisible ? (
              <div>
                <PickerHeading>Selected project</PickerHeading>
                <PickerOption
                  label={`${selected.name}${selected.id === archivedProjectId ? " · archived" : ""}`}
                  active
                  color={selected.color}
                  onClick={() => requestClose(true)}
                />
              </div>
            ) : null}
            {grouped.length ? (
              grouped.map(([client, clientProjects]) => (
                <div key={client}>
                  <PickerHeading>{client}</PickerHeading>
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
              <p className="text-fg-subtle p-4 text-center text-sm font-medium">
                No matching projects
              </p>
            )}
          </div>
          {me.permissions.manage_workspace ? <CreateProjectFooter /> : null}
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
    <div ref={root} className="relative h-full min-w-0">
      <TagsCell
        hasTags={selectedTags.length > 0}
        visible
        active={open}
        onClick={() => onOpenChange(!open)}
        label={
          selectedTags.length
            ? `Tags: ${selectedTags.map((tag) => tag.name).join(", ")}`
            : "Choose entry tags"
        }
        title={selectedTags.map((tag) => tag.name).join(", ") || undefined}
        buttonProps={{
          ref: trigger,
          "aria-expanded": open,
          "aria-haspopup": "listbox",
        }}
      />
      {open ? (
        <div
          className={twMerge(
            popoverPlacement,
            "timer-popover w-[min(92vw,240px)] py-[5px] lg:right-[-40px] lg:left-auto",
          )}
        >
          <div className="pt-2.5">
            <PopoverSearch
              value={search}
              onChange={setSearch}
              placeholder="Add/filter tags"
              label="Search entry tags"
            />
          </div>
          <div className="max-h-[231px] overflow-y-auto px-[5px] pt-[5px]">
            {visible.length ? (
              visible.map((tag) => {
                const active = value.includes(tag.id);
                return (
                  <button
                    type="button"
                    key={tag.id}
                    aria-pressed={active}
                    className="text-fg box-border flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium hover:bg-[#fafafa]/5"
                    onClick={() =>
                      onChange(
                        active ? value.filter((tagId) => tagId !== tag.id) : [...value, tag.id],
                      )
                    }
                  >
                    <span
                      className={twMerge(
                        "border-control bg-surface box-border grid size-[14px] shrink-0 place-items-center rounded border",
                        active && "border-accent bg-accent",
                      )}
                      aria-hidden="true"
                    >
                      {active ? (
                        <Check size={10} strokeWidth={3} className="text-fg-inverted" />
                      ) : null}
                    </span>
                    <span className="min-w-0 truncate">{tag.name}</span>
                  </button>
                );
              })
            ) : (
              <p className="text-fg-subtle p-4 text-center text-sm font-medium">No matching tags</p>
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
    <div ref={root} className="relative h-full min-w-0 max-lg:ml-auto">
      <TimeCell
        range={`${displayTime(startedAt)} - ${running ? "running" : displayTime(stoppedAt)}`}
        durationMs={durationSeconds * 1000}
        running={running}
        active={open}
        onClick={() => onOpenChange(!open)}
        title="Edit date, times, and duration"
        ariaLabel="Edit entry date, time, and duration"
        buttonProps={{
          ref: trigger,
          "aria-expanded": open,
          "aria-haspopup": "dialog",
        }}
      />
      {open ? (
        <div
          role="dialog"
          aria-label="Date and time"
          className={twMerge(
            popoverPlacement,
            "timer-popover w-[min(92vw,340px)] px-2.5 pt-3 pb-4 lg:right-[-61px] lg:left-auto",
          )}
        >
          <div className="grid grid-cols-2 gap-x-2.5 px-[5px]">
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
          <p className="text-fg-subtle mt-2.5 px-[15px] text-xs font-medium">{timezone}</p>

          <div className="mt-3 grid grid-cols-2 items-end gap-x-2.5 px-[15px]">
            <label className="text-fg grid gap-1 text-[11px] leading-[14px] font-semibold tracking-[0.4px] uppercase">
              Duration (h:mm:ss)
              <Input
                className={twMerge(
                  "h-[35px] font-medium tabular-nums",
                  !parseClockDuration(durationDraft) && "border-error",
                )}
                value={durationDraft}
                disabled={running}
                inputMode="numeric"
                aria-label="Entry duration"
                onChange={(event) => onDurationChange(event.target.value)}
              />
            </label>
            {financial && billable ? (
              <label className="text-fg grid gap-1 text-[11px] leading-[14px] font-semibold tracking-[0.4px] uppercase">
                Rate ({currency})
                <Input
                  className="h-[35px] text-right font-medium"
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
                className="border-control text-fg hover:bg-surface-hover box-border h-[35px] rounded-lg border text-sm font-semibold"
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
    <fieldset className="grid min-w-0 gap-1 disabled:opacity-50" disabled={disabled}>
      <legend className="text-fg float-left mb-1 w-full text-[11px] leading-[14px] font-semibold tracking-[0.4px] uppercase">
        {label}
      </legend>
      <div className="grid min-w-0 gap-2">
        <Input
          className="h-[35px] px-3 font-medium"
          type="date"
          value={value.slice(0, 10)}
          aria-label={`${label} date`}
          onChange={(event) => onChange(replaceDate(value, event.target.value))}
        />
        <Input
          className="h-[35px] px-3 font-medium tabular-nums"
          type="time"
          step={1}
          value={value.slice(11)}
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
  active?: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <div className="py-px pr-[3px] pl-1.5">
      <button
        type="button"
        aria-label={label.replace(" · archived", "")}
        className={twMerge(
          "group hover:bg-surface-hover box-border flex h-[34px] w-full items-center gap-1 rounded-lg px-2.5 text-left text-sm font-medium",
          active && "bg-surface-hover",
        )}
        onClick={onClick}
      >
        <span className="grid w-[9px] shrink-0 place-items-center" aria-hidden="true">
          <span
            className="size-2 rounded-full"
            style={{
              backgroundColor: color
                ? `color-mix(in srgb, ${color} 94.5%, black)`
                : "rgb(170 170 170)",
            }}
          />
        </span>
        <span
          className="ml-2.5 min-w-0 flex-1 truncate leading-[30px]"
          style={color ? { color: projectPickerTextColor(color) } : { color: "rgb(183 183 183)" }}
        >
          {label}
        </span>
        {active ? <Check size={16} className="text-fg-muted shrink-0" aria-hidden="true" /> : null}
      </button>
    </div>
  );
}
