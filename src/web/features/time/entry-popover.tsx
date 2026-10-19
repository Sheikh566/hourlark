import { ArrowRight, CalendarDays, DollarSign, Folder, Search, Tags, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { twMerge } from "tailwind-merge";

import { Checkbox } from "@/web/components/ui";
import { projectPickerTextColor, projectTextColor } from "@/web/features/time/calendar-config";
import {
  datePart,
  durationSecondsBetween,
  formatClockTime,
  parseClockTime,
  parseLocalDateTime,
  stopFromDuration,
  stopWithTime,
  timePart,
  withDate,
  withTime,
  type LocalDateTime,
} from "@/web/features/time/entry-popover-time";
import { useEscapeToClose } from "@/web/features/timer/use-dismiss-popover";
import { formatClockDuration, parseClockDuration } from "@/web/lib/format";
import type { Project, Tag } from "@/web/types";

export type PopoverAnchor = { x: number; y: number };

export type ProjectChoice = Pick<Project, "id" | "name" | "color" | "client_name">;

const VIEWPORT_MARGIN = 8;

/**
 * Toggl calendar popover: 424px wide, #1b1b1b surface, 1px #3a3a3a border, radius 8, padding
 * 12px 17px. It is fixed-positioned at `anchor` (viewport coordinates) and clamped into the
 * viewport; it never takes focus away through a backdrop.
 */
export function EntryPopoverShell({
  anchor,
  label,
  busy,
  onDismiss,
  onSubmit,
  children,
}: {
  anchor: PopoverAnchor;
  label: string;
  busy: boolean;
  onDismiss: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLFormElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const place = useCallback(() => {
    const element = root.current;
    if (!element) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const next = {
      left: Math.max(
        VIEWPORT_MARGIN,
        Math.min(anchor.x, window.innerWidth - width - VIEWPORT_MARGIN),
      ),
      top: Math.max(
        VIEWPORT_MARGIN,
        Math.min(anchor.y, window.innerHeight - height - VIEWPORT_MARGIN),
      ),
    };
    setPosition((current) =>
      current?.left === next.left && current.top === next.top ? current : next,
    );
  }, [anchor.x, anchor.y]);

  useLayoutEffect(() => {
    place();
  }, [place]);

  useEffect(() => {
    const onResize = () => {
      flushSync(() => place());
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [place]);

  useEffect(() => {
    if (busy) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (root.current?.contains(target)) return;
      // Menus and pickers opened from the popover are portaled outside of it.
      if (target.closest('[role="menu"], [role="listbox"], .hl-cal-popover')) return;
      onDismiss();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [busy, onDismiss]);

  return createPortal(
    <form
      ref={root}
      className="hl-cal-popover dark-surface border-stroke bg-surface text-fg shadow-popover fixed z-[65] box-border w-[424px] max-w-[calc(100vw-16px)] rounded-lg border px-[17px] py-3 text-sm leading-[14px] font-medium"
      style={{
        left: position?.left ?? anchor.x,
        top: position?.top ?? anchor.y,
        // Hidden elements cannot take focus, so fade in instead of using visibility.
        opacity: position ? 1 : 0,
      }}
      aria-label={label}
      onSubmit={onSubmit}
    >
      {children}
    </form>,
    document.body,
  );
}

/** 30x30 radius-8 close button pinned to the popover's top-right corner. */
export function PopoverCloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="text-fg hover:bg-surface-hover absolute top-0 right-0 inline-flex size-[30px] items-center justify-center rounded-lg leading-[normal]"
      aria-label={label}
      onClick={onClick}
    >
      <X size={10} aria-hidden="true" />
    </button>
  );
}

export function DescriptionField({
  value,
  label,
  autoFocus,
  plain,
  onChange,
}: {
  value: string;
  label: string;
  autoFocus?: boolean;
  /** Edit popovers show the title without a fill until it is hovered or focused (Toggl). */
  plain?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <input
      autoFocus={autoFocus}
      className={twMerge(
        "text-fg placeholder:text-fg-subtle box-border h-11 w-full min-w-0 rounded-lg border-0 px-3 text-lg leading-[normal] font-semibold tracking-[0.09px] outline-none focus-visible:shadow-none focus-visible:outline-none",
        plain
          ? "hover:bg-surface-raised focus:bg-surface-raised bg-transparent"
          : "bg-surface-raised",
      )}
      value={value}
      maxLength={500}
      placeholder="Add a description"
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function projectLabel(project: { name: string; client_name: string }): string {
  if (!project.client_name || project.client_name === "No client") return project.name;
  return `${project.name} • ${project.client_name}`;
}

/**
 * Icon row of the popover: project, tags and billable controls, 24px high with 8px gaps like
 * Toggl. The project and tag pickers open as Toggl popovers anchored under their triggers.
 */
export function EntryIconRow({
  projects,
  tags,
  projectId,
  tagIds,
  billable,
  canSetBillable,
  showRate,
  rateMajor,
  rateLabel,
  disabled,
  onProjectChange,
  onTagsChange,
  onBillableChange,
  onRateChange,
  openPicker,
  onOpenPickerChange,
}: {
  projects: ProjectChoice[];
  tags: Tag[];
  projectId: string;
  tagIds: string[];
  billable: boolean;
  canSetBillable: boolean;
  showRate: boolean;
  rateMajor: string;
  rateLabel: string;
  disabled?: boolean;
  onProjectChange: (projectId: string) => void;
  onTagsChange: (tagIds: string[]) => void;
  onBillableChange: (billable: boolean) => void;
  onRateChange: (rate: string) => void;
  openPicker: "project" | "tags" | null;
  onOpenPickerChange: (picker: "project" | "tags" | null) => void;
}) {
  const project = projects.find((item) => item.id === projectId);
  const projectTrigger = useRef<HTMLButtonElement>(null);
  const tagTrigger = useRef<HTMLButtonElement>(null);
  const [restore, setRestore] = useState<"project" | "tags" | null>(null);

  useEffect(() => {
    if (openPicker || !restore) return;
    (restore === "project" ? projectTrigger : tagTrigger).current?.focus();
    setRestore(null);
  }, [openPicker, restore]);

  const closePicker = useCallback(
    (focusTrigger: boolean) => {
      if (focusTrigger && openPicker) setRestore(openPicker);
      onOpenPickerChange(null);
    },
    [onOpenPickerChange, openPicker],
  );

  return (
    <div className="relative mt-[9.5px] flex h-6 items-center gap-2">
      <div className="relative">
        <button
          ref={projectTrigger}
          type="button"
          disabled={disabled}
          className={twMerge(
            "text-fg flex h-6 min-w-7 items-center gap-1.5 rounded-lg px-[5px] disabled:opacity-50",
            project && "hover:bg-surface-hover max-w-[240px]",
          )}
          aria-label="Select project"
          aria-haspopup="listbox"
          aria-expanded={openPicker === "project"}
          title={project ? projectLabel(project) : "Select project"}
          onClick={() => onOpenPickerChange(openPicker === "project" ? null : "project")}
        >
          {project ? (
            <>
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: project.color }}
                aria-hidden="true"
              />
              <span
                className="truncate text-sm leading-5 font-medium"
                style={{ color: projectTextColor(project.color) }}
              >
                {project.name}
              </span>
            </>
          ) : (
            <Folder width={18} height={12} aria-hidden="true" />
          )}
        </button>
        {openPicker === "project" ? (
          <ProjectPicker
            projects={projects}
            selectedId={projectId}
            onSelect={(id) => {
              onProjectChange(id);
              closePicker(true);
            }}
            onClose={closePicker}
          />
        ) : null}
      </div>
      <div className="relative">
        <button
          ref={tagTrigger}
          type="button"
          disabled={disabled}
          className="text-accent-fg grid size-6 place-items-center rounded-lg disabled:opacity-50"
          aria-label={tagIds.length ? `${tagIds.length} tags selected` : "Choose tags"}
          aria-haspopup="listbox"
          aria-expanded={openPicker === "tags"}
          onClick={() => onOpenPickerChange(openPicker === "tags" ? null : "tags")}
        >
          <Tags size={14} aria-hidden="true" />
        </button>
        {openPicker === "tags" ? (
          <TagPicker
            tags={tags}
            selectedIds={tagIds}
            onChange={onTagsChange}
            onClose={closePicker}
          />
        ) : null}
      </div>
      {canSetBillable ? (
        <button
          type="button"
          disabled={disabled}
          className={twMerge(
            "hover:bg-surface-hover grid size-6 place-items-center rounded-lg disabled:opacity-50",
            billable ? "text-accent-fg" : "text-fg",
          )}
          aria-label={billable ? "Mark non-billable" : "Mark billable"}
          aria-pressed={billable}
          onClick={() => onBillableChange(!billable)}
        >
          <DollarSign width={12} height={18} aria-hidden="true" />
        </button>
      ) : null}
      {showRate ? (
        <input
          type="number"
          min="0"
          step="0.01"
          disabled={disabled}
          className="bg-surface-raised text-fg placeholder:text-fg-subtle ml-1 box-border h-6 w-28 rounded-lg border-0 px-2 text-xs font-medium outline-none"
          value={rateMajor}
          placeholder="Hourly rate"
          aria-label={rateLabel}
          onChange={(event) => onRateChange(event.target.value)}
        />
      ) : null}
    </div>
  );
}

function PickerSearch({
  value,
  placeholder,
  onChange,
  onKeyDown,
  label,
}: {
  value: string;
  placeholder: string;
  label: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="flex h-[30px] items-center gap-2.5 px-2.5">
      <Search size={14} className="text-fg-subtle shrink-0" aria-hidden="true" />
      <input
        autoFocus
        className="text-fg placeholder:text-fg-subtle h-[30px] min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

function moveFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const container = event.currentTarget.closest<HTMLElement>("[data-picker]");
  const items = [
    ...(container?.querySelectorAll<HTMLElement>("input[data-picker-search], [data-picker-item]") ??
      []),
  ];
  if (!items.length) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLElement);
  const step = event.key === "ArrowDown" ? 1 : -1;
  items[Math.min(items.length - 1, Math.max(0, index + step))]?.focus();
}

function ProjectPicker({
  projects,
  selectedId,
  onSelect,
  onClose,
}: {
  projects: ProjectChoice[];
  selectedId: string;
  onSelect: (projectId: string) => void;
  onClose: (focusTrigger: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const listId = useId();
  useEffect(() => {
    const handle = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.parentElement?.contains(event.target))
        return;
      onClose(false);
    };
    document.addEventListener("pointerdown", handle);
    return () => document.removeEventListener("pointerdown", handle);
  }, [onClose]);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = projects.filter(
      (project) =>
        !needle ||
        project.name.toLowerCase().includes(needle) ||
        project.client_name.toLowerCase().includes(needle),
    );
    const byClient = new Map<string, ProjectChoice[]>();
    for (const project of matching) {
      const client = project.client_name || "No client";
      byClient.set(client, [...(byClient.get(client) ?? []), project]);
    }
    return [...byClient.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [projects, query]);

  const noProjectVisible = !query.trim() || "no project".includes(query.trim().toLowerCase());
  const firstMatch = groups[0]?.[1][0];

  return (
    <div
      ref={root}
      data-picker
      className="timer-popover dark-surface absolute top-[30px] left-0 z-10 w-[360px] max-w-[calc(100vw-32px)] p-[5px] text-sm font-medium"
    >
      <PickerSearch
        value={query}
        label="Search projects"
        placeholder="Search by project or client"
        onChange={setQuery}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (firstMatch) onSelect(firstMatch.id);
            else if (noProjectVisible) onSelect("");
            return;
          }
          moveFocus(event);
        }}
      />
      <div
        id={listId}
        role="listbox"
        aria-label="Projects"
        className="mt-[5px] max-h-[260px] overflow-y-auto"
      >
        {noProjectVisible ? (
          <button
            type="button"
            role="option"
            aria-selected={selectedId === ""}
            data-picker-item
            className={twMerge(
              "hover:bg-surface-hover focus-visible:bg-surface-hover text-fg-secondary flex h-[34px] w-full items-center gap-2 rounded-lg px-2.5 text-left",
              selectedId === "" && "bg-surface-hover",
            )}
            onKeyDown={moveFocus}
            onClick={() => onSelect("")}
          >
            No project
          </button>
        ) : null}
        {groups.map(([client, items]) => (
          <div key={client}>
            <p className="text-fg px-2.5 pt-4 pb-1 text-[11px] leading-[14px] font-semibold tracking-[0.04em] uppercase">
              {client}
            </p>
            {items.map((project) => (
              <button
                key={project.id}
                type="button"
                role="option"
                aria-selected={selectedId === project.id}
                data-picker-item
                className={twMerge(
                  "hover:bg-surface-hover focus-visible:bg-surface-hover flex h-[34px] w-full items-center gap-2 rounded-lg px-2.5 text-left",
                  selectedId === project.id && "bg-surface-hover",
                )}
                onKeyDown={moveFocus}
                onClick={() => onSelect(project.id)}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: project.color }}
                  aria-hidden="true"
                />
                <span className="truncate" style={{ color: projectPickerTextColor(project.color) }}>
                  {project.name}
                </span>
              </button>
            ))}
          </div>
        ))}
        {!noProjectVisible && groups.length === 0 ? (
          <p className="text-fg-subtle px-2.5 py-3 text-center text-xs">No matching projects</p>
        ) : null}
      </div>
    </div>
  );
}

function TagPicker({
  tags,
  selectedIds,
  onChange,
  onClose,
}: {
  tags: Tag[];
  selectedIds: string[];
  onChange: (tagIds: string[]) => void;
  onClose: (focusTrigger: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const handle = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.parentElement?.contains(event.target))
        return;
      onClose(false);
    };
    document.addEventListener("pointerdown", handle);
    return () => document.removeEventListener("pointerdown", handle);
  }, [onClose]);
  const needle = query.trim().toLowerCase();
  const visible = tags.filter((tag) => !needle || tag.name.toLowerCase().includes(needle));
  return (
    <div
      ref={root}
      data-picker
      className="timer-popover dark-surface absolute top-[30px] left-0 z-10 w-60 max-w-[calc(100vw-32px)] p-[5px] text-sm font-medium"
    >
      <PickerSearch
        value={query}
        label="Filter tags"
        placeholder="Filter tags"
        onChange={setQuery}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
          moveFocus(event);
        }}
      />
      <div
        role="listbox"
        aria-multiselectable="true"
        aria-label="Tags"
        className="mt-[5px] max-h-52 overflow-y-auto"
      >
        {visible.length ? (
          visible.map((tag) => {
            const selected = selectedIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                role="option"
                aria-selected={selected}
                data-picker-item
                className="hover:bg-surface-hover focus-visible:bg-surface-hover flex h-8 w-full items-center gap-3.5 rounded-lg px-2.5 text-left"
                onKeyDown={moveFocus}
                onClick={() =>
                  onChange(
                    selected ? selectedIds.filter((id) => id !== tag.id) : [...selectedIds, tag.id],
                  )
                }
              >
                <Checkbox
                  checked={selected}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                  className="pointer-events-none"
                />
                <span className="truncate">{tag.name}</span>
              </button>
            );
          })
        ) : (
          <p className="text-fg-subtle px-2.5 py-3 text-center text-xs">No active tags</p>
        )}
      </div>
    </div>
  );
}

/** Escape closes an open picker first, then the whole popover. */
export function usePopoverEscape(
  openPicker: "project" | "tags" | null,
  closePicker: () => void,
  close: () => void,
) {
  useEscapeToClose(true, () => {
    if (openPicker) {
      const trigger = document.activeElement
        ?.closest(".hl-cal-popover")
        ?.querySelector<HTMLElement>('button[aria-expanded="true"][aria-haspopup="listbox"]');
      closePicker();
      trigger?.focus();
    } else close();
  });
}

export interface EntryTimes {
  startedAt: LocalDateTime;
  stoppedAt: LocalDateTime;
}

/**
 * Draft start/stop state shared by the add and edit popovers. `onStartChange` decides what a
 * new start time moves: `duration` keeps the duration (stop follows), `stop` keeps the stop.
 */
export function useEntryTimes({
  initial,
  timezone,
  running = false,
  onStartChange,
}: {
  initial: EntryTimes;
  timezone: string;
  running?: boolean;
  onStartChange: "duration" | "stop";
}) {
  const [startedAt, setStartedAt] = useState(initial.startedAt);
  const [stoppedAt, setStoppedAt] = useState(initial.stoppedAt);
  const [error, setError] = useState<string | null>(null);
  const invalidTimes = useRef(new Set<string>());

  const durationSeconds = durationSecondsBetween(startedAt, stoppedAt, timezone);

  const applyStart = useCallback(
    (next: LocalDateTime) => {
      const previousSeconds = durationSecondsBetween(startedAt, stoppedAt, timezone);
      setStartedAt(next);
      setError(null);
      if (running || onStartChange === "stop" || !previousSeconds) return;
      const stop = stopFromDuration(next, previousSeconds, timezone);
      if (stop) setStoppedAt(stop);
    },
    [onStartChange, running, startedAt, stoppedAt, timezone],
  );

  const commitStartText = useCallback(
    (text: string): string | null => {
      const time = parseClockTime(text);
      if (!time) {
        invalidTimes.current.add("start");
        setError("Enter a valid start time, like 3:30 PM.");
        return null;
      }
      invalidTimes.current.delete("start");
      applyStart(withTime(startedAt, time));
      return formatClockTime(time);
    },
    [applyStart, startedAt],
  );

  const commitStopText = useCallback(
    (text: string): string | null => {
      const time = parseClockTime(text);
      if (!time) {
        invalidTimes.current.add("stop");
        setError("Enter a valid stop time, like 3:30 PM.");
        return null;
      }
      invalidTimes.current.delete("stop");
      setError(null);
      const next = stopWithTime(stoppedAt, startedAt, time, timezone);
      setStoppedAt(next);
      return formatClockTime(timePart(next));
    },
    [startedAt, stoppedAt, timezone],
  );

  const commitDurationText = useCallback(
    (text: string): string | null => {
      const seconds = parseClockDuration(text);
      if (seconds === null) {
        invalidTimes.current.add("duration");
        setError("Enter a duration in h:mm:ss, up to 168 hours.");
        return null;
      }
      const stop = stopFromDuration(startedAt, seconds, timezone);
      if (!stop) return null;
      invalidTimes.current.delete("duration");
      setError(null);
      setStoppedAt(stop);
      return formatClockDuration(seconds * 1000);
    },
    [startedAt, timezone],
  );

  const commitDate = useCallback(
    (date: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      applyStart(withDate(startedAt, date));
    },
    [applyStart, startedAt],
  );

  /** Validates the draft and returns the instants to save, or sets an error. */
  const resolve = useCallback((): { start: Date; stop: Date | null } | null => {
    if (invalidTimes.current.size > 0) {
      setError("Enter a valid start, stop and duration before saving.");
      return null;
    }
    const start = parseLocalDateTime(startedAt, timezone);
    const stop = parseLocalDateTime(stoppedAt, timezone);
    if (!start || (!running && !stop)) {
      setError("Enter a valid start and stop time.");
      return null;
    }
    if (!running && stop && stop <= start) {
      setError("Stop must be after start.");
      return null;
    }
    setError(null);
    return { start, stop: running ? null : stop };
  }, [running, startedAt, stoppedAt, timezone]);

  return {
    startedAt,
    stoppedAt,
    durationSeconds,
    error,
    setError,
    commitStartText,
    commitStopText,
    commitDurationText,
    commitDate,
    resolve,
  };
}

function TimeTextInput({
  value,
  label,
  className,
  disabled,
  align = "right",
  onCommit,
}: {
  value: string;
  label: string;
  className?: string;
  disabled?: boolean;
  align?: "left" | "right";
  /** Applies typed text; returns the normalized text to show, or null when it is invalid. */
  onCommit: (text: string) => string | null;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);
  // Show the committed value unless the user is typing a replacement.
  const shown = focused || invalid ? draft : value;
  return (
    <input
      type="text"
      inputMode="text"
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      className={twMerge(
        "border-control bg-surface text-fg box-border h-[37px] min-w-0 rounded-lg border px-[11px] py-[9px] text-sm leading-[normal] font-medium outline-none disabled:opacity-60",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      value={shown}
      aria-label={label}
      aria-invalid={invalid}
      onFocus={(event) => {
        if (!invalid) setDraft(value);
        setFocused(true);
        event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value || invalid) setInvalid(onCommit(draft) === null);
        setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || draft === value) return;
        // Commit the typed time first; a second Enter submits the form.
        event.preventDefault();
        const normalized = onCommit(draft);
        setInvalid(normalized === null);
        if (normalized !== null) setDraft(normalized);
      }}
    />
  );
}

/**
 * Time row: start field (with date picker), end field, editable duration. Widths are Toggl's
 * measured 103.9 / 85.9 / 83.2 so the row plus the 85px action button fills the 388px content.
 */
export function EntryTimeRow({
  times,
  running,
  disabled,
  action,
}: {
  times: ReturnType<typeof useEntryTimes>;
  running: boolean;
  disabled?: boolean;
  action: ReactNode;
}) {
  const dateInput = useRef<HTMLInputElement>(null);
  const duration =
    times.durationSeconds === null ? "" : formatClockDuration(times.durationSeconds * 1000);
  const startDate = datePart(times.startedAt);
  return (
    <div>
      <div className="hl-cal-time-row mt-[9.5px] flex h-[37px] items-start">
        <div className="hl-cal-time-start relative w-[103.9px] shrink-0">
          <TimeTextInput
            className="w-full pr-8"
            disabled={disabled}
            label="Start time"
            value={formatClockTime(timePart(times.startedAt))}
            onCommit={times.commitStartText}
          />
          <button
            type="button"
            disabled={disabled}
            className="text-fg absolute top-[2px] right-px grid size-8 place-items-center rounded-lg disabled:opacity-50"
            aria-label="Choose start date"
            onClick={() => {
              try {
                dateInput.current?.showPicker();
              } catch {
                dateInput.current?.focus();
              }
            }}
          >
            <CalendarDays size={16} aria-hidden="true" />
          </button>
          <input
            ref={dateInput}
            type="date"
            tabIndex={-1}
            aria-label="Start date"
            className="pointer-events-none absolute right-0 bottom-0 h-px w-px opacity-0"
            value={startDate}
            onChange={(event) => times.commitDate(event.target.value)}
          />
        </div>
        <ArrowRight
          size={15}
          className="hl-cal-time-arrow text-fg mx-[3px] mt-[14px] ml-1 shrink-0"
          aria-hidden="true"
        />
        <TimeTextInput
          className="hl-cal-time-stop w-[85.9px] shrink-0"
          disabled={disabled || running}
          label="Stop time"
          value={running ? "" : formatClockTime(timePart(times.stoppedAt))}
          onCommit={times.commitStopText}
        />
        <TimeTextInput
          className="hl-cal-time-duration mr-1 ml-1 w-[83.2px] shrink-0 border-transparent text-left"
          align="left"
          disabled={disabled || running}
          label="Duration (h:mm:ss)"
          value={duration}
          onCommit={times.commitDurationText}
        />
        <div className="hl-cal-time-action contents">{action}</div>
      </div>
      {times.error ? (
        <p className="text-error-fg mt-2 text-xs leading-4 font-medium" role="alert">
          {times.error}
        </p>
      ) : null}
    </div>
  );
}
