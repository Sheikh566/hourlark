import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";
import { useEffect, useMemo, useRef, useState } from "react";

import { useMe } from "@/web/app/context";
import { useToast } from "@/web/components/toast";
import { RowMenu } from "@/web/components/ui";
import {
  findDescriptionCommand,
  matchesDescriptionCommand,
  removeDescriptionCommand,
  type DescriptionCommandKind,
} from "@/web/features/timer/description-command";
import {
  CommandMenu,
  SuggestionsDropdown,
  suggestionOptionId,
  type DescriptionSuggestion,
  type RecentTime,
} from "@/web/features/timer/description-suggestions";
import { ManualRangeFields } from "@/web/features/timer/manual-range-fields";
import { RunningDuration } from "@/web/features/timer/running-time-popover";
import {
  AddGlyph,
  AutomaticModeGlyph,
  ManualModeGlyph,
  PlayGlyph,
  StopGlyph,
} from "@/web/features/timer/timer-glyphs";
import { useTimerDocumentTitle } from "@/web/features/timer/timer-document-title";
import {
  BillableButton,
  groupProjectsByClient,
  ProjectPicker,
  TagPicker,
  type ProjectChoice,
} from "@/web/features/timer/timer-pickers";
import { useNow } from "@/web/hooks/use-now";
import { ApiClientError, apiRequest, idempotencyKey } from "@/web/lib/api";
import { formatClockDuration } from "@/web/lib/format";
import {
  manualEntryRange,
  readTimerMode,
  storeTimerMode,
  type TimerMode,
} from "@/web/features/timer/manual-entry";
import { broadcastTimerChange } from "@/web/lib/timer";
import type { Project, Tag, TimeEntry } from "@/web/types";

interface CommandSuggestion {
  id: string;
  kind: DescriptionCommandKind;
  label: string;
}

interface TimerQuery {
  entry: TimeEntry | null;
  server_now: string;
}

interface RunningMetadataPatch {
  description?: string;
  project_id?: string | null;
  tag_ids?: string[];
  billable?: boolean;
  started_at?: string;
}

/** Colour of tags created from the timer bar (the tag editor's default). */
const NEW_TAG_COLOR = "#14852B";
const MAX_RECENT_SUGGESTIONS = 8;

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

/** True when a keyboard event comes from somewhere text is typed. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function GlobalTimerBar() {
  const me = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const descriptionInput = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState("");
  const [runningDraft, setRunningDraft] = useState<string | null>(null);
  const [rejectedDraft, setRejectedDraft] = useState<string | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [descriptionCursor, setDescriptionCursor] = useState(0);
  const [commandDismissed, setCommandDismissed] = useState(false);
  const [highlightedCommand, setHighlightedCommand] = useState(0);
  const [descriptionFocused, setDescriptionFocused] = useState(false);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(-1);
  const [projectId, setProjectId] = useState("");
  const [billable, setBillable] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [operationPending, setOperationPending] = useState(false);
  const [mode, setMode] = useState<TimerMode>(readTimerMode);
  const [manualDate, setManualDate] = useState("");
  const [manualStart, setManualStart] = useState("");
  const [manualEnd, setManualEnd] = useState("");
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
  const canManage = me.member.role !== "member";
  const weekStartsOn = me.workspace.week_start === "monday" ? 1 : 0;
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

  // `@project` / `#tag` command menu, listed in the order it is displayed.
  const commandProjects = useMemo<ProjectChoice[]>(() => {
    if (descriptionCommand?.kind !== "project") return [];
    return groupProjectsByClient(
      pickerProjects.filter((project) =>
        matchesDescriptionCommand(project.name, descriptionCommand.query),
      ),
    ).flatMap(([, items]) => items);
  }, [descriptionCommand, pickerProjects]);
  const commandTags = useMemo(() => {
    if (descriptionCommand?.kind !== "tag") return [];
    return [...pickerTags]
      .filter((tag) => matchesDescriptionCommand(tag.name, descriptionCommand.query))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((tag) => ({ ...tag, selected: displayedTagIds.includes(tag.id) }));
  }, [descriptionCommand, displayedTagIds, pickerTags]);
  const commandSuggestions = useMemo<CommandSuggestion[]>(
    () =>
      descriptionCommand?.kind === "project"
        ? [
            ...(descriptionCommand.query
              ? []
              : [{ id: "", kind: "project" as const, label: "No project" }]),
            ...commandProjects.map((project) => ({
              id: project.id,
              kind: "project" as const,
              label: project.name,
            })),
          ]
        : commandTags.map((tag) => ({ id: tag.id, kind: "tag" as const, label: tag.name })),
    [commandProjects, commandTags, descriptionCommand],
  );
  const commandMenuOpen = Boolean(descriptionCommand && !commandDismissed);
  const commandLoading =
    descriptionCommand?.kind === "project" ? projects.isLoading : tags.isLoading;

  const manualMode = mode === "manual" && !activeTimer;

  // Toggl's description dropdown: previous entries (and projects while the field is empty).
  const suggestionItems = useMemo<DescriptionSuggestion[]>(() => {
    if (activeTimer) return [];
    const needle = description.trim().toLowerCase();
    const seen = new Set<string>();
    const previous: DescriptionSuggestion[] = [];
    for (const item of recent.data?.recent ?? []) {
      const text = item.description.trim();
      if (!text || (needle && !text.toLowerCase().startsWith(needle))) continue;
      const key = `${text}\u0000${item.project_id ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const project =
        pickerProjects.find((candidate) => candidate.id === item.project_id) ??
        (item.project_id && item.project_name
          ? {
              id: item.project_id,
              name: item.project_name,
              color: item.project_color ?? "#64748b",
              client_name: item.client_name ?? "No client",
              billable_default: false,
            }
          : null);
      previous.push({ kind: "recent", key: `recent:${key}`, description: text, project });
    }
    if (needle) return previous.slice(0, MAX_RECENT_SUGGESTIONS);
    const projectItems: DescriptionSuggestion[] = [...pickerProjects]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((project) => ({ kind: "project", key: `project:${project.id}`, project }));
    return [...previous, ...projectItems];
  }, [activeTimer, description, pickerProjects, recent.data?.recent]);
  const suggestionsOpen =
    !activeTimer &&
    descriptionFocused &&
    !suggestionsDismissed &&
    !commandMenuOpen &&
    suggestionItems.length > 0;

  useEffect(() => {
    setHighlightedCommand(0);
  }, [descriptionCommand?.kind, descriptionCommand?.query]);

  useEffect(() => {
    setHighlightedSuggestion(-1);
  }, [description]);

  useEffect(() => {
    if (!commandMenuOpen) return;
    const option = commandSuggestions[highlightedCommand];
    if (!option) return;
    const element = document.getElementById(
      `timer-description-command-${option.kind}-${option.id}`,
    );
    // jsdom has no scrollIntoView.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    element?.scrollIntoView?.({ block: "nearest" });
  }, [commandMenuOpen, commandSuggestions, highlightedCommand]);

  useEffect(() => {
    if (!suggestionsOpen || highlightedSuggestion < 0) return;
    const element = document.getElementById(suggestionOptionId(highlightedSuggestion));
    // jsdom has no scrollIntoView.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    element?.scrollIntoView?.({ block: "nearest" });
  }, [suggestionsOpen, highlightedSuggestion]);

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

  const titleState = useMemo(
    () =>
      activeTimer
        ? {
            startedAt: Date.parse(activeTimer.started_at),
            description: activeTimer.description,
            projectName: activeTimer.project?.name ?? null,
          }
        : null,
    [activeTimer],
  );
  useTimerDocumentTitle(titleState, now);

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
      if (patch.started_at !== undefined) body.started_at = patch.started_at;
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

  const timezone = me.member.timezone;
  const nowFields = () => ({
    date: formatInTimeZone(Date.now(), timezone, "yyyy-MM-dd"),
    time: formatInTimeZone(Date.now(), timezone, "HH:mm"),
  });
  const effectiveManual = () => {
    const current = nowFields();
    return {
      date: manualDate || current.date,
      start: manualStart || current.time,
      end: manualEnd || current.time,
    };
  };
  const manualMutation = useMutation({
    mutationFn: () => {
      const fields = effectiveManual();
      const range = manualEntryRange(fields.date, fields.start, fields.end, timezone);
      if ("error" in range) throw new Error(range.error);
      return apiRequest("/time-entries", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({
          description,
          project_id: idleProjectId || null,
          tag_ids: selectedTags,
          billable: canSetBillable ? billable : false,
          ...range,
        }),
      });
    },
    onSuccess: async () => {
      setDescription("");
      setManualDate("");
      setManualStart("");
      setManualEnd("");
      await refreshTimerSurfaces();
    },
  });
  const switchMode = (next: TimerMode) => {
    setMode(next);
    storeTimerMode(next);
    manualMutation.reset();
  };

  const timerError =
    patchError ??
    startMutation.error?.message ??
    stopMutation.error?.message ??
    (manualMode ? manualMutation.error?.message : undefined);
  const metadataBusy = operationPending || stopMutation.isPending;

  const chooseProject = (id: string) => {
    setProjectId(id);
    setBillable(
      billableForProject(
        pickerProjects.find((item) => item.id === id) as ProjectChoice | undefined,
      ),
    );
  };
  const selectCommandSuggestion = (suggestion: CommandSuggestion) => {
    if (!descriptionCommand) return;
    const next = removeDescriptionCommand(displayedDescription, descriptionCommand);
    if (activeTimer) {
      runningDraftRef.current = next.description;
      setRunningDraft(next.description);
      void patchRunningMetadata({
        description: next.description,
        ...(suggestion.kind === "project"
          ? { project_id: suggestion.id || null }
          : { tag_ids: [...new Set([...displayedTagIds, suggestion.id])] }),
      }).catch(() => undefined);
    } else {
      if (suggestion.kind === "project") {
        chooseProject(suggestion.id);
      } else {
        setSelectedTags((current) =>
          current.includes(suggestion.id) ? current : [...current, suggestion.id],
        );
      }
      setDescription(next.description);
    }
    setDescriptionCursor(next.cursor);
    setCommandDismissed(false);
    window.setTimeout(() => {
      descriptionInput.current?.focus();
      descriptionInput.current?.setSelectionRange(next.cursor, next.cursor);
    }, 0);
  };
  const selectSuggestion = (item: DescriptionSuggestion) => {
    if (item.kind === "recent") {
      setDescription(item.description);
      setDescriptionCursor(item.description.length);
      chooseProject(
        item.project && pickerProjects.some((project) => project.id === item.project?.id)
          ? item.project.id
          : "",
      );
    } else {
      chooseProject(item.project.id);
    }
    setSuggestionsDismissed(true);
    descriptionInput.current?.focus();
  };
  const cancelRejectedDescription = () => {
    runningDraftRef.current = null;
    rejectedDraftRef.current = null;
    setRunningDraft(null);
    setRejectedDraft(null);
    setPatchError(null);
  };
  const handleDescriptionKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (activeTimer && !commandMenuOpen) {
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
    if (!commandMenuOpen || !descriptionCommand) {
      if (suggestionsOpen) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setHighlightedSuggestion((current) => Math.min(current + 1, suggestionItems.length - 1));
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setHighlightedSuggestion((current) => Math.max(current - 1, -1));
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setSuggestionsDismissed(true);
          return;
        }
        const highlighted = suggestionItems[highlightedSuggestion];
        if (event.key === "Enter" && highlighted) {
          event.preventDefault();
          selectSuggestion(highlighted);
          return;
        }
      } else if (event.key === "ArrowDown" && suggestionItems.length) {
        event.preventDefault();
        setSuggestionsDismissed(false);
        return;
      }
      // Toggl starts the timer (or adds the manual entry) when Enter is pressed in the description.
      if (event.key === "Enter") {
        event.preventDefault();
        if (manualMode) {
          if (!manualMutation.isPending) manualMutation.mutate();
        } else if (!startMutation.isPending) startMutation.mutate();
      }
      return;
    }
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

  /** Deletes the running entry: the API only deletes stopped entries, so stop it first. */
  const discardRunning = async () => {
    const entryId = activeTimer?.id;
    if (!entryId) return;
    try {
      await runExclusive(async () => {
        if (queryClient.getQueryData<TimerQuery>(["timer"])?.entry?.id !== entryId) return;
        await apiRequest("/timer/stop", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey() },
          body: "{}",
        });
        await apiRequest(`/time-entries/${entryId}`, { method: "DELETE" });
      });
      toast({
        title: "Success",
        message: "Time entry deleted successfully",
        action: {
          label: "UNDO",
          onSelect: () => {
            void apiRequest(`/time-entries/${entryId}/restore`, { method: "POST", body: "{}" })
              .then(refreshTimerSurfaces)
              .catch((error: unknown) =>
                toast({
                  message:
                    error instanceof Error ? error.message : "The entry could not be restored.",
                }),
              );
          },
        },
      });
    } catch (error) {
      setPatchError(error instanceof Error ? error.message : "The timer could not be deleted.");
    } finally {
      await refreshTimerSurfaces();
    }
  };

  const createTag = async (name: string): Promise<Tag> => {
    const result = await apiRequest<{ tag: Tag }>("/tags", {
      method: "POST",
      body: JSON.stringify({ name, color: NEW_TAG_COLOR }),
    });
    await queryClient.invalidateQueries({ queryKey: ["tags"] });
    return result.tag;
  };

  // Toggl shortcuts: `n` starts a new timer, `s` stops the running one. Ignored while typing.
  const shortcuts = useRef({ newTimer: () => {}, stop: () => {} });
  useEffect(() => {
    shortcuts.current = {
      newTimer: () => {
        if (!activeTimer && !startMutation.isPending) {
          switchMode("timer");
          setSuggestionsDismissed(true);
          startMutation.mutate();
        }
        descriptionInput.current?.focus();
      },
      stop: () => {
        if (activeTimer) void handleStop();
      },
    };
  });
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "n") {
        event.preventDefault();
        shortcuts.current.newTimer();
      } else if (event.key === "s") {
        event.preventDefault();
        shortcuts.current.stop();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const elapsed = activeTimer
    ? formatClockDuration(now - new Date(activeTimer.started_at).getTime())
    : "0:00:00";
  const manualFields = effectiveManual();
  const menuOpenId = commandMenuOpen
    ? "timer-description-command-menu"
    : suggestionsOpen
      ? "timer-description-suggestions"
      : undefined;
  const activeCommand = commandSuggestions[highlightedCommand];

  return (
    <header className="global-timer bg-surface relative z-20 shrink-0 pr-3 pl-14 leading-none shadow-[0_0_0_1px_var(--color-stroke)] md:pr-0 md:pl-0">
      <div className="flex min-h-[84px] w-full flex-wrap items-center gap-2 py-3 sm:h-[84px] sm:flex-nowrap sm:gap-0 sm:py-0">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto">
          <input
            ref={descriptionInput}
            value={displayedDescription}
            onChange={(event) => {
              const value = event.target.value;
              setDescriptionCursor(event.currentTarget.selectionStart ?? value.length);
              setCommandDismissed(false);
              setSuggestionsDismissed(false);
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
            onFocus={() => {
              setDescriptionFocused(true);
              setSuggestionsDismissed(false);
            }}
            onBlur={() => {
              setDescriptionFocused(false);
              if (!activeTimer) return;
              const draft = runningDraftRef.current ?? rejectedDraftRef.current;
              if (rejectedDraftRef.current !== null && draft === rejectedDraftRef.current) return;
              void persistRunningDescription();
            }}
            placeholder={
              activeTimer
                ? "Add a description"
                : manualMode
                  ? "What have you done?"
                  : "What are you working on?"
            }
            aria-label="Timer description"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={commandMenuOpen || suggestionsOpen}
            aria-controls={menuOpenId}
            aria-activedescendant={
              commandMenuOpen && activeCommand
                ? `timer-description-command-${activeCommand.kind}-${activeCommand.id}`
                : suggestionsOpen && highlightedSuggestion >= 0
                  ? suggestionOptionId(highlightedSuggestion)
                  : undefined
            }
            className="timer-description text-fg caret-accent-fg placeholder:text-fg-muted h-12 w-full border-0 bg-transparent pr-[5px] pl-5 text-[18px] leading-[18px] font-semibold outline-none sm:h-[70px]"
          />
          {suggestionsOpen ? (
            <SuggestionsDropdown
              id="timer-description-suggestions"
              items={suggestionItems}
              highlighted={highlightedSuggestion}
              onHighlight={setHighlightedSuggestion}
              onSelect={selectSuggestion}
            />
          ) : null}
          {commandMenuOpen && descriptionCommand ? (
            <CommandMenu
              command={descriptionCommand}
              projects={commandProjects}
              tags={commandTags}
              highlightedId={activeCommand?.id ?? null}
              loading={commandLoading}
              canCreate={canManage}
              onHighlight={(id) => {
                const index = commandSuggestions.findIndex((option) => option.id === id);
                if (index >= 0) setHighlightedCommand(index);
              }}
              onSelectProject={(project) =>
                selectCommandSuggestion({
                  id: project?.id ?? "",
                  kind: "project",
                  label: project?.name ?? "No project",
                })
              }
              onSelectTag={(tag) =>
                selectCommandSuggestion({ id: tag.id, kind: "tag", label: tag.name })
              }
            />
          ) : null}
          {timerError ? (
            <p
              className="text-error-fg absolute bottom-0 left-5 flex max-w-full flex-wrap items-center gap-2 text-[11px]"
              role="alert"
            >
              <span className="truncate">{timerError}</span>
              {rejectedDraft !== null ? (
                <>
                  <button
                    type="button"
                    className="text-accent-fg shrink-0 font-semibold underline"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void persistRunningDescription()}
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    className="text-fg shrink-0 font-semibold underline"
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
          canCreate={canManage}
          onChange={(value) => {
            if (activeTimer) {
              void patchRunningMetadata({ project_id: value || null }).catch(() => undefined);
              return;
            }
            chooseProject(value);
          }}
        />
        <TagPicker
          tags={pickerTags}
          value={displayedTagIds}
          disabled={metadataBusy}
          canCreate={canManage}
          onCreate={createTag}
          onChange={(value) => {
            if (activeTimer) {
              void patchRunningMetadata({ tag_ids: value }).catch(() => undefined);
              return;
            }
            setSelectedTags(value);
          }}
        />
        {me.workspace.members_can_set_billable ? (
          <BillableButton
            active={displayedBillable}
            disabled={metadataBusy}
            onToggle={() => {
              if (activeTimer) {
                void patchRunningMetadata({ billable: !activeTimer.billable }).catch(
                  () => undefined,
                );
                return;
              }
              setBillable((value) => !value);
            }}
          />
        ) : null}
        {manualMode ? (
          <ManualRangeFields
            date={manualFields.date}
            start={manualFields.start}
            end={manualFields.end}
            today={nowFields().date}
            weekStartsOn={weekStartsOn}
            disabled={manualMutation.isPending}
            onDateChange={setManualDate}
            onStartChange={setManualStart}
            onEndChange={setManualEnd}
          />
        ) : activeTimer ? (
          <div className="ml-auto sm:ml-[2px]">
            <RunningDuration
              entry={activeTimer}
              duration={elapsed}
              now={now}
              timezone={timezone}
              weekStartsOn={weekStartsOn}
              onChangeStart={(iso) => patchRunningMetadata({ started_at: iso })}
            />
          </div>
        ) : (
          <div
            aria-label="Time entry duration"
            className="text-fg-muted ml-auto w-[95px] shrink-0 text-center text-lg leading-[normal] font-semibold whitespace-nowrap tabular-nums sm:ml-[2px]"
          >
            <span>{elapsed}</span>
          </div>
        )}
        <div className={manualMode ? "sm:ml-6" : "sm:ml-2.5"}>
          {activeTimer ? (
            <button
              type="button"
              className="timer-disc-button timer-tip timer-tip-end"
              data-tip="Stop time entry"
              onClick={() => void handleStop()}
              disabled={stopMutation.isPending}
              aria-label="Stop timer"
            >
              <span className="timer-disc timer-disc-stop">
                <StopGlyph />
              </span>
            </button>
          ) : manualMode ? (
            <button
              type="button"
              className="timer-disc-button timer-tip timer-tip-end"
              data-tip="Add time entry"
              onClick={() => manualMutation.mutate()}
              disabled={manualMutation.isPending}
              aria-label="Add time entry"
            >
              <span className="timer-disc timer-disc-accent">
                <AddGlyph />
              </span>
            </button>
          ) : (
            <button
              type="button"
              className="timer-disc-button timer-tip timer-tip-end"
              data-tip="Start time entry"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              aria-label="Start timer"
            >
              <span className="timer-disc timer-disc-accent">
                <PlayGlyph />
              </span>
            </button>
          )}
        </div>
        <div className="relative flex shrink-0 justify-center px-2 sm:w-[65px] sm:px-0">
          {activeTimer ? (
            <fieldset className="timer-running-actions" disabled={metadataBusy}>
              <RowMenu
                label="Running entry actions"
                menuClassName="w-[130px]"
                items={[
                  {
                    label: "Delete",
                    danger: true,
                    disabled: metadataBusy,
                    onSelect: () => void discardRunning(),
                  },
                ]}
              />
            </fieldset>
          ) : (
            <div
              className="bg-surface-raised flex h-12 w-6 flex-col rounded-xl"
              role="group"
              aria-label="Time entry mode"
            >
              <button
                type="button"
                className={`timer-tip timer-tip-end grid h-6 w-6 place-items-center rounded-full ${mode === "timer" ? "text-fg" : "text-fg-muted hover:text-fg"}`}
                data-tip="Timer mode"
                aria-label="Timer mode"
                aria-pressed={mode === "timer"}
                onClick={() => switchMode("timer")}
              >
                <AutomaticModeGlyph />
              </button>
              <button
                type="button"
                className={`timer-tip timer-tip-end grid h-6 w-6 place-items-center rounded-full ${mode === "manual" ? "text-fg" : "text-fg-muted hover:text-fg"}`}
                data-tip="Manual mode"
                aria-label="Manual mode"
                aria-pressed={mode === "manual"}
                onClick={() => switchMode("manual")}
              >
                <ManualModeGlyph />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
