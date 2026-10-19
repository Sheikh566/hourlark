import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CirclePlay, Copy } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { majorToMinor, minorToMajor } from "@/domain/billing/money";
import { useMe } from "@/web/app/context";
import { Button, RowMenu, useToast } from "@/web/components/ui";
import {
  DescriptionField,
  EntryIconRow,
  EntryPopoverShell,
  EntryTimeRow,
  PopoverCloseButton,
  useEntryTimes,
  usePopoverEscape,
  type PopoverAnchor,
  type ProjectChoice,
} from "@/web/features/time/entry-popover";
import { toLocalDateTime } from "@/web/features/time/entry-popover-time";
import { ApiClientError, apiRequest, idempotencyKey } from "@/web/lib/api";
import { broadcastTimerChange } from "@/web/lib/timer";
import type { Project, Tag, TimeEntry } from "@/web/types";

function rateMajorFromEntry(entry: TimeEntry, workspaceCurrency: string): string {
  if (entry.rate_minor === null || entry.rate_minor === undefined) return "";
  return String(minorToMajor(entry.rate_minor, entry.rate_currency ?? workspaceCurrency));
}

/** Runs a request and retries it with an audit reason when the entry is locked. */
async function withOverrideReason<T>(run: (overrideReason?: string) => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiClientError && error.code === "override_reason_required") {
      const reason = window.prompt("This entry is locked. Enter an audit reason to override:");
      if (reason?.trim()) return run(reason.trim());
    }
    throw error;
  }
}

/**
 * Toggl-style edit popover for a calendar entry: continue, duplicate, "more" menu, description,
 * project/tag/billable icons and a time row with Save. Keeps Hourlark's locked-entry override,
 * version conflict handling and explicit hourly rate.
 */
export function CalendarEntryPopover({
  entry,
  anchor,
  targetMemberId,
  projects,
  tags,
  onClose,
}: {
  entry: TimeEntry;
  anchor: PopoverAnchor;
  targetMemberId?: string;
  projects: Project[];
  tags: Tag[];
  onClose: () => void;
}) {
  const me = useMe();
  const queryClient = useQueryClient();
  const showToast = useToast();
  const timezone = me.member.timezone;
  const running = entry.running;
  const canSetBillable = me.workspace.members_can_set_billable || me.member.role !== "member";
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [description, setDescription] = useState(entry.description);
  const [projectId, setProjectId] = useState(entry.project?.id ?? "");
  const [tagIds, setTagIds] = useState(entry.tags.map((tag) => tag.id));
  const [billable, setBillable] = useState(entry.billable);
  const originalRate = rateMajorFromEntry(entry, me.workspace.currency);
  const [rateMajor, setRateMajor] = useState(originalRate);
  const [openPicker, setOpenPicker] = useState<"project" | "tags" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const times = useEntryTimes({
    initial: {
      startedAt: toLocalDateTime(entry.started_at, timezone),
      stoppedAt: toLocalDateTime(entry.stopped_at ?? new Date(), timezone),
    },
    timezone,
    running,
    onStartChange: "stop",
  });

  const availableProjects = useMemo(() => {
    const merged = new Map<string, ProjectChoice>(projects.map((project) => [project.id, project]));
    if (entry.project && !merged.has(entry.project.id)) {
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

  const refresh = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
        queryClient.invalidateQueries({ queryKey: ["timer"] }),
      ]),
    [queryClient],
  );

  const saveMutation = useMutation({
    mutationFn: async (range: { start: Date; stop: Date | null }) => {
      const rateChanged = rateMajor !== originalRate;
      const currency = entry.rate_currency ?? me.workspace.currency;
      const unchangedStart = times.startedAt === toLocalDateTime(entry.started_at, timezone);
      const unchangedStop =
        entry.stopped_at !== null &&
        times.stoppedAt === toLocalDateTime(entry.stopped_at, timezone);
      const body = {
        description,
        project_id: projectId || null,
        tag_ids: tagIds,
        started_at: unchangedStart ? entry.started_at : range.start.toISOString(),
        ...(!running && range.stop
          ? {
              stopped_at:
                unchangedStop && entry.stopped_at ? entry.stopped_at : range.stop.toISOString(),
            }
          : {}),
        billable: canSetBillable ? billable : entry.billable,
        ...(me.permissions.financial && billable && rateChanged && rateMajor
          ? { rate_minor: majorToMinor(rateMajor, currency), rate_currency: currency }
          : {}),
      };
      return withOverrideReason((overrideReason) =>
        apiRequest(`/time-entries/${entry.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...body,
            version: entry.version,
            ...(overrideReason ? { override_reason: overrideReason } : {}),
          }),
        }),
      );
    },
    onSuccess: async () => {
      await refresh();
      if (mounted.current) onClose();
    },
  });

  const continueMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/time-entries/${entry.id}/continue`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: "{}",
      }),
    onSuccess: async () => {
      broadcastTimerChange();
      await refresh();
      if (mounted.current) onClose();
    },
    onError: (error) => setActionError(error.message),
  });

  const duplicateMutation = useMutation({
    mutationFn: () =>
      apiRequest<{ entry: TimeEntry }>("/time-entries", {
        method: "POST",
        body: JSON.stringify({
          ...(targetMemberId ? { member_id: targetMemberId } : {}),
          description: entry.description,
          project_id: entry.project?.id ?? null,
          tag_ids: entry.tags.filter((tag) => tag.status === "active").map((tag) => tag.id),
          started_at: entry.started_at,
          stopped_at: entry.stopped_at ?? new Date().toISOString(),
          billable: canSetBillable && entry.billable,
        }),
      }),
    onSuccess: async () => {
      await refresh();
      if (mounted.current) onClose();
    },
    onError: (error) => setActionError(error.message),
  });

  const restoreEntry = useCallback(async () => {
    try {
      await withOverrideReason((overrideReason) =>
        apiRequest(
          `/time-entries/${entry.id}/restore${
            overrideReason ? `?override_reason=${encodeURIComponent(overrideReason)}` : ""
          }`,
          { method: "POST", body: "{}" },
        ),
      );
      if (running) broadcastTimerChange();
      await refresh();
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : "The entry could not be restored.",
      });
    }
  }, [entry.id, refresh, running, showToast]);

  const deleteMutation = useMutation({
    mutationFn: () =>
      withOverrideReason((overrideReason) =>
        apiRequest(
          `/time-entries/${entry.id}${
            overrideReason ? `?override_reason=${encodeURIComponent(overrideReason)}` : ""
          }`,
          { method: "DELETE" },
        ),
      ),
    onSuccess: async () => {
      if (running) broadcastTimerChange();
      await refresh();
      showToast({
        message: "The time entry was deleted.",
        action: { label: "Undo", onSelect: () => void restoreEntry() },
      });
      if (mounted.current) onClose();
    },
    onError: (error) => setActionError(error.message),
  });

  const closePicker = useCallback(() => setOpenPicker(null), []);
  usePopoverEscape(openPicker, closePicker, onClose);

  const pending =
    saveMutation.isPending ||
    continueMutation.isPending ||
    duplicateMutation.isPending ||
    deleteMutation.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    if (description.length > 500) {
      times.setError("Description must be 500 characters or fewer.");
      return;
    }
    const range = times.resolve();
    if (!range) return;
    setActionError(null);
    saveMutation.mutate(range);
  };

  const error = actionError ?? (saveMutation.error ? saveMutation.error.message : null);

  return (
    <EntryPopoverShell
      anchor={anchor}
      label="Edit calendar time entry"
      busy={pending}
      onDismiss={openPicker ? closePicker : onClose}
      onSubmit={submit}
    >
      <PopoverCloseButton label="Close entry editor" onClick={onClose} />
      <div className="flex h-[30px] items-center gap-1">
        <button
          type="button"
          disabled={pending}
          className="text-fg -ml-[3px] inline-flex size-[30px] items-center justify-center rounded-[50%] border-[3px] border-transparent disabled:opacity-50"
          aria-label={running ? "Entry is running" : "Continue time entry"}
          title={running ? "This entry is running" : "Continue time entry"}
          onClick={() => continueMutation.mutate()}
          hidden={running || (targetMemberId !== undefined && targetMemberId !== me.member.id)}
        >
          <CirclePlay size={24} className="text-accent-fg" aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={pending}
          className="text-fg-muted hover:bg-surface-hover ml-1 grid size-[30px] place-items-center rounded-lg disabled:opacity-50"
          aria-label="Duplicate time entry"
          onClick={() => duplicateMutation.mutate()}
        >
          <Copy size={16} aria-hidden="true" />
        </button>
        <RowMenu
          label="More actions"
          items={[
            {
              label: "Copy description",
              disabled: !entry.description,
              onSelect: () => void navigator.clipboard.writeText(entry.description),
            },
            { label: "Delete", danger: true, onSelect: () => deleteMutation.mutate() },
          ]}
        />
      </div>
      <fieldset disabled={pending} className="mt-3 min-w-0 border-0 p-0">
        <DescriptionField
          plain
          label="Entry description"
          value={description}
          onChange={setDescription}
        />
        <EntryIconRow
          projects={availableProjects}
          tags={availableTags}
          projectId={projectId}
          tagIds={tagIds}
          billable={billable}
          canSetBillable={canSetBillable}
          showRate={me.permissions.financial && billable}
          rateMajor={rateMajor}
          rateLabel={`Explicit hourly rate (${entry.rate_currency ?? me.workspace.currency})`}
          disabled={pending}
          onProjectChange={setProjectId}
          onTagsChange={setTagIds}
          onBillableChange={setBillable}
          onRateChange={setRateMajor}
          openPicker={openPicker}
          onOpenPickerChange={setOpenPicker}
        />
        <EntryTimeRow
          times={times}
          running={running}
          disabled={pending}
          action={
            <Button type="submit" className="w-[85px] px-3 leading-[normal]" disabled={pending}>
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          }
        />
      </fieldset>
      {error ? (
        <p className="text-error-fg mt-2 text-xs leading-4 font-medium" role="alert">
          {error}
        </p>
      ) : null}
    </EntryPopoverShell>
  );
}
