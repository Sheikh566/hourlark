import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Check, CircleDollarSign, Folder, Play, Search, Square, Tags, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useMe } from "@/web/app/context";
import {
  findDescriptionCommand,
  matchesDescriptionCommand,
  removeDescriptionCommand,
  type DescriptionCommandKind,
} from "@/web/features/timer/description-command";
import {
  useDismissPopover,
  useEscapeToClose,
  useRestoreFocus,
} from "@/web/features/timer/use-dismiss-popover";
import { useNow } from "@/web/hooks/use-now";
import { ApiClientError, apiRequest, idempotencyKey } from "@/web/lib/api";
import { formatClockDuration } from "@/web/lib/format";
import { broadcastTimerChange } from "@/web/lib/timer";
import type { Project, Tag, TimeEntry } from "@/web/types";

interface RecentTime {
  description: string;
  project_id: string | null;
  project_name: string | null;
  client_name: string | null;
}

interface CommandSuggestion {
  id: string;
  kind: DescriptionCommandKind;
  label: string;
  detail: string;
  color: string;
  selected: boolean;
}

interface TimerQuery {
  entry: TimeEntry | null;
  server_now: string;
}

type ProjectChoice = Pick<Project, "id" | "name" | "color" | "client_name" | "billable_default">;

interface RunningMetadataPatch {
  description?: string;
  project_id?: string | null;
  tag_ids?: string[];
  billable?: boolean;
}

function applyEntryToCaches(queryClient: QueryClient, entry: TimeEntry) {
  queryClient.setQueryData<TimerQuery>(["timer"], (current) => ({
    entry: entry.running ? entry : null,
    server_now: current?.server_now ?? entry.updated_at,
  }));
  queryClient.setQueriesData({ queryKey: ["time-entries"] }, (current: unknown) => {
    if (!current || typeof current !== "object" || !("entries" in current)) return current;
    const data = current as { entries: TimeEntry[] };
    return {
      ...data,
      entries: data.entries.map((item) => (item.id === entry.id ? entry : item)),
    };
  });
  queryClient.setQueriesData({ queryKey: ["calendar"] }, (current: unknown) => {
    if (!current || typeof current !== "object" || !("events" in current)) return current;
    const data = current as { events: TimeEntry[] };
    return {
      ...data,
      events: data.events.map((item) => (item.id === entry.id ? entry : item)),
    };
  });
}

function isTimeEntry(value: unknown): value is TimeEntry {
  return Boolean(value && typeof value === "object" && "id" in value && "version" in value);
}

export function GlobalTimerBar() {
  const me = useMe();
  const queryClient = useQueryClient();
  const now = useNow();
  const descriptionInput = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState("");
  const [runningDraft, setRunningDraft] = useState<string | null>(null);
  const [rejectedDraft, setRejectedDraft] = useState<string | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [descriptionCursor, setDescriptionCursor] = useState(0);
  const [commandDismissed, setCommandDismissed] = useState(false);
  const [highlightedCommand, setHighlightedCommand] = useState(0);
  const [projectId, setProjectId] = useState("");
  const [billable, setBillable] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [operationPending, setOperationPending] = useState(false);
  const runningDraftRef = useRef<string | null>(null);
  const rejectedDraftRef = useRef<string | null>(null);
  const persistPromiseRef = useRef<Promise<boolean> | null>(null);
  const exclusiveRef = useRef<Promise<unknown> | null>(null);

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
  const recent = useQuery({
    queryKey: ["recent-time"],
    queryFn: () => apiRequest<{ recent: RecentTime[] }>("/me/recent"),
  });
  const timer = useQuery({
    queryKey: ["timer"],
    queryFn: () => apiRequest<TimerQuery>("/timer"),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const activeTimer = timer.data?.entry ?? null;
  const idleProjectId =
    projects.data && !projects.data.projects.some((project) => project.id === projectId)
      ? ""
      : projectId;
  const descriptionCommand = findDescriptionCommand(
    activeTimer ? (runningDraft ?? rejectedDraft ?? activeTimer.description) : description,
    descriptionCursor,
  );
  const displayedProjectId = activeTimer ? (activeTimer.project?.id ?? "") : idleProjectId;
  const displayedTagIds = activeTimer ? activeTimer.tags.map((tag) => tag.id) : selectedTags;
  const canSetBillable = me.workspace.members_can_set_billable || me.member.role !== "member";
  const billableForProject = (project: ProjectChoice | undefined) =>
    canSetBillable && (project?.billable_default === true || project?.billable_default === 1);
  const displayedBillable = activeTimer ? activeTimer.billable : billable;
  const displayedDescription = activeTimer
    ? (runningDraft ?? rejectedDraft ?? activeTimer.description)
    : description;
  const pickerProjects = useMemo<ProjectChoice[]>(() => {
    const merged = new Map<string, ProjectChoice>(
      (projects.data?.projects ?? []).map((project) => [project.id, project]),
    );
    if (activeTimer?.project) {
      const archived = !merged.has(activeTimer.project.id);
      merged.set(activeTimer.project.id, {
        id: activeTimer.project.id,
        name: activeTimer.project.name ?? "Archived project",
        color: activeTimer.project.color ?? "#64748b",
        client_name: activeTimer.client?.name ?? (archived ? "Archived" : "No client"),
        billable_default: false,
      });
    }
    return [...merged.values()];
  }, [activeTimer, projects.data?.projects]);
  const pickerTags = useMemo(() => {
    const merged = new Map((tags.data?.tags ?? []).map((tag) => [tag.id, tag]));
    if (activeTimer) {
      for (const tag of activeTimer.tags) merged.set(tag.id, tag);
    }
    return [...merged.values()];
  }, [activeTimer, tags.data?.tags]);
  const commandSuggestions = useMemo<CommandSuggestion[]>(() => {
    if (!descriptionCommand) return [];
    const query = descriptionCommand.query;
    if (descriptionCommand.kind === "project") {
      return [...pickerProjects]
        .filter((project) => matchesDescriptionCommand(project.name, query))
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, 10)
        .map((project) => ({
          id: project.id,
          kind: "project",
          label: project.name,
          detail: project.client_name || "No client",
          color: project.color,
          selected: project.id === displayedProjectId,
        }));
    }
    return [...pickerTags]
      .filter((tag) => matchesDescriptionCommand(tag.name, query))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, 10)
      .map((tag) => ({
        id: tag.id,
        kind: "tag",
        label: tag.name,
        detail: "Tag",
        color: tag.color,
        selected: displayedTagIds.includes(tag.id),
      }));
  }, [descriptionCommand, displayedProjectId, displayedTagIds, pickerProjects, pickerTags]);
  const commandMenuOpen = Boolean(descriptionCommand && !commandDismissed && !activeTimer);
  const commandLoading =
    descriptionCommand?.kind === "project" ? projects.isLoading : tags.isLoading;

  useEffect(() => {
    setHighlightedCommand(0);
  }, [descriptionCommand?.kind, descriptionCommand?.query]);

  useEffect(() => {
    runningDraftRef.current = runningDraft;
    rejectedDraftRef.current = rejectedDraft;
  }, [rejectedDraft, runningDraft]);

  useEffect(() => {
    runningDraftRef.current = null;
    rejectedDraftRef.current = null;
    setRunningDraft(null);
    setRejectedDraft(null);
    setPatchError(null);
  }, [activeTimer?.id]);

  const refreshTimerSurfaces = async () => {
    broadcastTimerChange();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["timer"] }),
      queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
      queryClient.invalidateQueries({ queryKey: ["calendar"] }),
      queryClient.invalidateQueries({ queryKey: ["reports"] }),
      queryClient.invalidateQueries({ queryKey: ["recent-time"] }),
    ]);
  };

  const runExclusive = async <T,>(task: () => Promise<T>): Promise<T> => {
    while (exclusiveRef.current) {
      try {
        await exclusiveRef.current;
      } catch {
        // The previous operation already surfaced its error.
      }
    }
    const run = task();
    exclusiveRef.current = run;
    setOperationPending(true);
    try {
      return await run;
    } finally {
      if (exclusiveRef.current === run) exclusiveRef.current = null;
      if (!exclusiveRef.current) setOperationPending(false);
    }
  };

  const patchRunningMetadata = async (patch: RunningMetadataPatch): Promise<TimeEntry> => {
    const entryId = activeTimer?.id;
    return runExclusive(async () => {
      const current = queryClient.getQueryData<TimerQuery>(["timer"])?.entry;
      if (!current || current.id !== entryId) {
        throw new Error("The running timer changed. Review the current entry before editing.");
      }
      const body: Record<string, unknown> = { version: current.version };
      if (patch.description !== undefined) body.description = patch.description;
      if (patch.project_id !== undefined) body.project_id = patch.project_id;
      if (patch.tag_ids !== undefined) body.tag_ids = patch.tag_ids;
      if (patch.billable !== undefined) body.billable = patch.billable;
      try {
        const result = await apiRequest<{ entry: TimeEntry }>(`/time-entries/${current.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        if (queryClient.getQueryData<TimerQuery>(["timer"])?.entry?.id !== entryId) {
          await refreshTimerSurfaces();
          return result.entry;
        }
        applyEntryToCaches(queryClient, result.entry);
        if (patch.description !== undefined) {
          const latestDraft = runningDraftRef.current ?? rejectedDraftRef.current;
          if (latestDraft === null || latestDraft === patch.description) {
            runningDraftRef.current = null;
            rejectedDraftRef.current = null;
            setRunningDraft(null);
            setRejectedDraft(null);
          }
        }
        setPatchError(null);
        await refreshTimerSurfaces();
        return result.entry;
      } catch (error) {
        if (queryClient.getQueryData<TimerQuery>(["timer"])?.entry?.id !== entryId) {
          await refreshTimerSurfaces();
          throw error;
        }
        if (error instanceof ApiClientError && error.code === "entry_conflict") {
          if (isTimeEntry(error.details?.authoritative)) {
            applyEntryToCaches(queryClient, error.details.authoritative);
          }
          await queryClient.invalidateQueries({ queryKey: ["timer"] });
          setPatchError(
            "This entry changed elsewhere. Retry your edit or cancel to keep the latest timer.",
          );
        } else {
          setPatchError(error instanceof Error ? error.message : "The timer could not be updated.");
        }
        if (patch.description !== undefined) {
          rejectedDraftRef.current = patch.description;
          setRejectedDraft(patch.description);
        }
        throw error;
      }
    });
  };

  const persistRunningDescription = (): Promise<boolean> => {
    if (persistPromiseRef.current) return persistPromiseRef.current;
    const promise = (async () => {
      const current = queryClient.getQueryData<TimerQuery>(["timer"])?.entry;
      if (!current) return true;
      const draft = runningDraftRef.current ?? rejectedDraftRef.current;
      if (draft === null || draft === current.description) {
        runningDraftRef.current = null;
        rejectedDraftRef.current = null;
        setRunningDraft(null);
        setRejectedDraft(null);
        return true;
      }
      try {
        await patchRunningMetadata({ description: draft });
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      if (persistPromiseRef.current === promise) persistPromiseRef.current = null;
    });
    persistPromiseRef.current = promise;
    return promise;
  };

  const startMutation = useMutation({
    mutationFn: () =>
      apiRequest("/timer/start", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({
          description,
          project_id: idleProjectId || null,
          tag_ids: selectedTags,
          billable: canSetBillable ? billable : false,
        }),
      }),
    onSuccess: async () => {
      setDescription("");
      await refreshTimerSurfaces();
    },
    onError: refreshTimerSurfaces,
  });
  const stopMutation = useMutation({
    mutationFn: () =>
      apiRequest("/timer/stop", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: "{}",
      }),
    onSuccess: refreshTimerSurfaces,
    onError: refreshTimerSurfaces,
  });

  const timerError = patchError ?? startMutation.error?.message ?? stopMutation.error?.message;
  const metadataBusy = operationPending || stopMutation.isPending;
  const selectCommandSuggestion = (suggestion: CommandSuggestion) => {
    if (!descriptionCommand || activeTimer) return;
    if (suggestion.kind === "project") {
      setProjectId(suggestion.id);
      const project = pickerProjects.find((item) => item.id === suggestion.id);
      setBillable(billableForProject(project));
    } else {
      setSelectedTags((current) =>
        current.includes(suggestion.id) ? current : [...current, suggestion.id],
      );
    }

    const next = removeDescriptionCommand(description, descriptionCommand);
    setDescription(next.description);
    setDescriptionCursor(next.cursor);
    setCommandDismissed(false);
    window.setTimeout(() => {
      descriptionInput.current?.focus();
      descriptionInput.current?.setSelectionRange(next.cursor, next.cursor);
    }, 0);
  };
  const cancelRejectedDescription = () => {
    runningDraftRef.current = null;
    rejectedDraftRef.current = null;
    setRunningDraft(null);
    setRejectedDraft(null);
    setPatchError(null);
  };
  const handleDescriptionKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (activeTimer) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelRejectedDescription();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void persistRunningDescription();
      }
      return;
    }
    if (!commandMenuOpen || !descriptionCommand) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setCommandDismissed(true);
      return;
    }
    if (!commandSuggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedCommand((current) => (current + 1) % commandSuggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedCommand(
        (current) => (current - 1 + commandSuggestions.length) % commandSuggestions.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const suggestion = commandSuggestions[highlightedCommand];
      if (suggestion) selectCommandSuggestion(suggestion);
    }
  };
  const handleStop = async () => {
    const entryId = activeTimer?.id;
    if (exclusiveRef.current) {
      try {
        await exclusiveRef.current;
      } catch {
        return;
      }
    }
    if (queryClient.getQueryData<TimerQuery>(["timer"])?.entry?.id !== entryId) return;
    do {
      const draft = runningDraftRef.current ?? rejectedDraftRef.current;
      if (rejectedDraftRef.current !== null && draft === rejectedDraftRef.current) return;
      const saved = await persistRunningDescription();
      if (!saved || queryClient.getQueryData<TimerQuery>(["timer"])?.entry?.id !== entryId) {
        return;
      }
    } while (runningDraftRef.current !== null);
    try {
      await runExclusive(async () => {
        if (queryClient.getQueryData<TimerQuery>(["timer"])?.entry?.id === entryId) {
          await stopMutation.mutateAsync();
        }
      });
    } catch {
      // The stop mutation displays its error and refreshes the timer.
    }
  };

  return (
    <header className="global-timer sticky top-0 z-20 border-b border-[#3b3b3b] bg-[#1b1b1b] pr-3 pl-14 md:px-5">
      <div className="flex min-h-[84px] w-full flex-wrap items-center gap-2 py-3 sm:h-[84px] sm:flex-nowrap sm:py-0">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto">
          <input
            ref={descriptionInput}
            value={displayedDescription}
            onChange={(event) => {
              const value = event.target.value;
              setDescriptionCursor(event.currentTarget.selectionStart ?? value.length);
              setCommandDismissed(false);
              if (activeTimer) {
                runningDraftRef.current = value;
                setRunningDraft(value);
                return;
              }
              setDescription(value);
            }}
            onSelect={(event) => {
              setDescriptionCursor(
                event.currentTarget.selectionStart ?? event.currentTarget.value.length,
              );
              setCommandDismissed(false);
            }}
            onKeyUp={(event) =>
              setDescriptionCursor(
                event.currentTarget.selectionStart ?? event.currentTarget.value.length,
              )
            }
            onKeyDown={handleDescriptionKeyDown}
            onBlur={() => {
              if (!activeTimer) return;
              const draft = runningDraftRef.current ?? rejectedDraftRef.current;
              if (rejectedDraftRef.current !== null && draft === rejectedDraftRef.current) return;
              void persistRunningDescription();
            }}
            list={commandMenuOpen ? undefined : "recent-time-descriptions"}
            placeholder="What are you working on?"
            aria-label="Timer description"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={commandMenuOpen}
            aria-controls={commandMenuOpen ? "timer-description-command-menu" : undefined}
            aria-activedescendant={
              commandMenuOpen && commandSuggestions[highlightedCommand]
                ? `timer-description-command-${commandSuggestions[highlightedCommand].kind}-${commandSuggestions[highlightedCommand].id}`
                : undefined
            }
            className="h-12 w-full border-0 bg-transparent px-1 text-[18px] font-medium text-[#fafafa] outline-none placeholder:text-[#a4a4a4]"
          />
          <datalist id="recent-time-descriptions">
            {(recent.data?.recent ?? []).map((item) => (
              <option key={`${item.description}:${item.project_id ?? ""}`} value={item.description}>
                {[item.client_name, item.project_name].filter(Boolean).join(" · ")}
              </option>
            ))}
          </datalist>
          {commandMenuOpen && descriptionCommand ? (
            <div
              id="timer-description-command-menu"
              className="timer-popover absolute top-[58px] left-0 z-50 w-[min(88vw,430px)]"
              role="listbox"
              aria-label={
                descriptionCommand.kind === "project" ? "Project suggestions" : "Tag suggestions"
              }
            >
              <div className="flex items-center justify-between border-b border-[#3b3b3b] px-3 py-2">
                <p className="text-xs font-semibold text-[#fafafa]">
                  {descriptionCommand.kind === "project" ? "Choose a project" : "Add a tag"}
                </p>
                <p className="text-[10px] text-[#a4a4a4]">
                  <kbd className="rounded border border-[#3b3b3b] px-1 py-0.5">↑↓</kbd> navigate ·{" "}
                  <kbd className="rounded border border-[#3b3b3b] px-1 py-0.5">Enter</kbd> select
                </p>
              </div>
              <div className="max-h-72 overflow-y-auto p-1.5">
                {commandLoading ? (
                  <p className="p-4 text-center text-sm text-[#a4a4a4]">
                    Loading {descriptionCommand.kind === "project" ? "projects" : "tags"}…
                  </p>
                ) : commandSuggestions.length ? (
                  commandSuggestions.map((suggestion, index) => (
                    <button
                      key={`${suggestion.kind}:${suggestion.id}`}
                      id={`timer-description-command-${suggestion.kind}-${suggestion.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === highlightedCommand}
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left ${
                        index === highlightedCommand
                          ? "bg-[#382b16] text-[#fbbf24]"
                          : "text-[#fafafa] hover:bg-white/7"
                      }`}
                      onMouseEnter={() => setHighlightedCommand(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectCommandSuggestion(suggestion)}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#a4a4a4]"
                        style={{ backgroundColor: suggestion.color }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {suggestion.label}
                        </span>
                        <span className="block truncate text-[11px] text-[#a4a4a4]">
                          {suggestion.detail}
                        </span>
                      </span>
                      {suggestion.selected ? <Check size={14} aria-hidden /> : null}
                    </button>
                  ))
                ) : (
                  <p className="p-4 text-center text-sm text-[#a4a4a4]">
                    No {descriptionCommand.kind === "project" ? "projects" : "tags"} start with{" "}
                    <span className="text-[#fafafa] tabular-nums">
                      {descriptionCommand.marker}
                      {descriptionCommand.query}
                    </span>
                  </p>
                )}
              </div>
            </div>
          ) : null}
          {timerError ? (
            <p
              className="absolute bottom-0 left-0 flex max-w-full flex-wrap items-center gap-2 text-[11px] text-red-300"
              role="alert"
            >
              <span className="truncate">{timerError}</span>
              {rejectedDraft !== null ? (
                <>
                  <button
                    type="button"
                    className="shrink-0 font-semibold text-[#fbbf24] underline"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void persistRunningDescription()}
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    className="shrink-0 font-semibold text-[#fafafa] underline"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={cancelRejectedDescription}
                  >
                    Cancel
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
        </div>

        <ProjectPicker
          projects={pickerProjects}
          value={displayedProjectId}
          disabled={metadataBusy}
          onChange={(value) => {
            if (activeTimer) {
              void patchRunningMetadata({ project_id: value || null }).catch(() => undefined);
              return;
            }
            setProjectId(value);
            const project = pickerProjects.find((item) => item.id === value);
            setBillable(billableForProject(project));
          }}
        />
        <TagPicker
          tags={pickerTags}
          value={displayedTagIds}
          disabled={metadataBusy}
          onChange={(value) => {
            if (activeTimer) {
              void patchRunningMetadata({ tag_ids: value }).catch(() => undefined);
              return;
            }
            setSelectedTags(value);
          }}
        />
        {me.workspace.members_can_set_billable ? (
          <button
            type="button"
            className={`timer-tool hidden sm:grid ${displayedBillable ? "timer-tool-active" : ""}`}
            aria-label={displayedBillable ? "Mark non-billable" : "Mark billable"}
            aria-pressed={displayedBillable}
            disabled={metadataBusy}
            onClick={() => {
              if (activeTimer) {
                void patchRunningMetadata({ billable: !activeTimer.billable }).catch(
                  () => undefined,
                );
                return;
              }
              setBillable((value) => !value);
            }}
          >
            <CircleDollarSign size={19} />
          </button>
        ) : null}
        <div className="ml-auto w-[95px] shrink-0 text-right text-lg font-bold text-[#fafafa] tabular-nums">
          {activeTimer
            ? formatClockDuration(now - new Date(activeTimer.started_at).getTime())
            : "0:00:00"}
        </div>
        {activeTimer ? (
          <button
            type="button"
            className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-red-500 text-white transition hover:bg-red-400"
            onClick={() => void handleStop()}
            disabled={stopMutation.isPending}
            aria-label="Stop timer"
          >
            <Square size={17} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-[#f59e0b] text-[#18181b] transition hover:bg-[#fbbf24]"
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            aria-label="Start timer"
          >
            <Play className="ml-0.5" size={18} fill="currentColor" />
          </button>
        )}
      </div>
    </header>
  );
}

function projectVisibleLabel(project: { name: string; client_name: string }): string {
  if (!project.client_name || project.client_name === "No client") return project.name;
  return `${project.name} • ${project.client_name}`;
}

function matchesProjectSearch(project: ProjectChoice, search: string): boolean {
  if (!search) return true;
  return `${project.name} ${project.client_name}`.toLowerCase().includes(search.toLowerCase());
}

function ProjectPicker({
  projects,
  value,
  disabled,
  onChange,
}: {
  projects: ProjectChoice[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const requestClose = (shouldRestore: boolean) => {
    setRestoreFocus(shouldRestore);
    setOpen(false);
  };
  useDismissPopover(root, () => requestClose(false), undefined, open);
  useEscapeToClose(open, () => requestClose(true));
  useRestoreFocus(open, trigger, restoreFocus, () => setRestoreFocus(false));
  useEffect(() => {
    if (open) setSearch("");
  }, [open]);
  const selected = projects.find((project) => project.id === value);
  const selectedLabel = selected ? projectVisibleLabel(selected) : null;
  const selectedVisible = Boolean(selected && matchesProjectSearch(selected, search));
  const grouped = useMemo(() => {
    const result = new Map<string, ProjectChoice[]>();
    for (const project of projects) {
      if (project.id === value || !matchesProjectSearch(project, search)) continue;
      const client = project.client_name || "No client";
      result.set(client, [...(result.get(client) ?? []), project]);
    }
    return [...result.entries()];
  }, [projects, search, value]);

  return (
    <div
      ref={root}
      className={`relative min-w-0 ${selected ? "shrink basis-full sm:basis-auto" : "shrink-0"}`}
    >
      <button
        ref={trigger}
        type="button"
        className={selected ? "timer-project-chip" : "timer-tool grid"}
        style={
          selected
            ? {
                color: `color-mix(in srgb, ${selected.color} 45%, #fafafa)`,
                backgroundColor: `color-mix(in srgb, ${selected.color} 16%, #1b1b1b)`,
              }
            : undefined
        }
        disabled={disabled}
        aria-label={selected ? `Project: ${selectedLabel}` : "Choose project"}
        title={selectedLabel ?? "Choose project"}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        {selected ? (
          <>
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: selected.color }}
            />
            <span className="min-w-0 truncate text-left text-sm font-medium">
              <span>{selected.name}</span>
              {selected.client_name && selected.client_name !== "No client" ? (
                <>
                  <span className="font-normal text-[#a4a4a4]"> • </span>
                  <span className="font-normal text-[#a4a4a4]">{selected.client_name}</span>
                </>
              ) : null}
            </span>
          </>
        ) : (
          <Folder size={19} />
        )}
      </button>
      {open ? (
        <div className="timer-popover absolute top-12 right-0 z-50 w-[min(88vw,360px)]">
          <div className="relative border-b border-[#3b3b3b] p-2">
            <Search className="absolute top-4 left-4 text-[#a4a4a4]" size={15} />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-full rounded-md border border-[#3b3b3b] bg-[#212121] pr-3 pl-9 text-sm text-[#fafafa] outline-none placeholder:text-[#a4a4a4]"
              placeholder="Search projects or clients"
              aria-label="Search projects or clients"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5">
            <PickerOption
              label="No project"
              active={!value}
              disabled={disabled}
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
                  label={selected.name}
                  detail={selected.client_name || "No client"}
                  active
                  color={selected.color}
                  disabled={disabled}
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
                      label={project.name}
                      disabled={disabled}
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
  disabled,
  onChange,
}: {
  tags: Tag[];
  value: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const requestClose = (shouldRestore: boolean) => {
    setRestoreFocus(shouldRestore);
    setOpen(false);
  };
  useDismissPopover(root, () => requestClose(false), undefined, open);
  useEscapeToClose(open, () => requestClose(true));
  useRestoreFocus(open, trigger, restoreFocus, () => setRestoreFocus(false));
  useEffect(() => {
    if (open) setSearch("");
  }, [open]);
  const visible = tags.filter((tag) => tag.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={trigger}
        type="button"
        className={`timer-tool grid ${value.length ? "timer-tool-active" : ""}`}
        disabled={disabled}
        aria-label={value.length ? `${value.length} timer tags selected` : "Choose timer tags"}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        <Tags size={19} />
        {value.length ? (
          <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#f59e0b] px-1 text-[9px] font-bold text-[#18181b]">
            {value.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="timer-popover absolute top-12 right-0 z-50 w-[min(82vw,280px)]">
          <div className="relative border-b border-[#3b3b3b] p-2">
            <Search className="absolute top-4 left-4 text-[#a4a4a4]" size={15} />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-full rounded-md border border-[#3b3b3b] bg-[#212121] pr-8 pl-9 text-sm text-[#fafafa] outline-none placeholder:text-[#a4a4a4]"
              placeholder="Filter tags"
              aria-label="Search timer tags"
            />
            {search ? (
              <button
                type="button"
                className="absolute top-3.5 right-4 text-[#a4a4a4] hover:text-[#fafafa]"
                onClick={() => setSearch("")}
                aria-label="Clear tag search"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {visible.length ? (
              visible.map((tag) => {
                const active = value.includes(tag.id);
                return (
                  <button
                    type="button"
                    key={tag.id}
                    disabled={disabled}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-[#fafafa] hover:bg-white/8"
                    onClick={() =>
                      onChange(
                        active ? value.filter((tagId) => tagId !== tag.id) : [...value, tag.id],
                      )
                    }
                  >
                    <span
                      className="grid h-4 w-4 place-items-center rounded border"
                      style={{ borderColor: tag.color, backgroundColor: active ? tag.color : "" }}
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

function PickerOption({
  label,
  detail,
  active,
  color,
  disabled,
  onClick,
}: {
  label: string;
  detail?: string;
  active?: boolean;
  color?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
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
