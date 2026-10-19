import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { useMe } from "@/web/app/context";
import { Button } from "@/web/components/ui";
import {
  DescriptionField,
  EntryIconRow,
  EntryPopoverShell,
  EntryTimeRow,
  PopoverCloseButton,
  useEntryTimes,
  usePopoverEscape,
  type PopoverAnchor,
} from "@/web/features/time/entry-popover";
import { toLocalDateTime } from "@/web/features/time/entry-popover-time";
import { apiRequest } from "@/web/lib/api";
import type { Project, Tag, TimeEntry } from "@/web/types";

interface CalendarQuickEntryProps {
  start: Date;
  stop: Date;
  targetMemberId?: string;
  projects: Project[];
  tags: Tag[];
  /** Viewport position of the popover's top-left corner; centred in the viewport when omitted. */
  anchor?: PopoverAnchor;
  onClose: () => void;
}

const FALLBACK_ANCHOR: PopoverAnchor = { x: 400, y: 200 };

/** Toggl-style add popover shown after dragging a range in the calendar. */
export function CalendarQuickEntry({
  start,
  stop,
  targetMemberId,
  projects,
  tags,
  anchor,
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
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [billable, setBillable] = useState(false);
  const [openPicker, setOpenPicker] = useState<"project" | "tags" | null>(null);
  const times = useEntryTimes({
    initial: {
      startedAt: toLocalDateTime(start, timezone),
      stoppedAt: toLocalDateTime(stop, timezone),
    },
    timezone,
    onStartChange: "duration",
  });

  const mutation = useMutation({
    mutationFn: (range: { start: Date; stop: Date }) =>
      apiRequest<{ entry: TimeEntry }>("/time-entries", {
        method: "POST",
        body: JSON.stringify({
          ...(targetMemberId ? { member_id: targetMemberId } : {}),
          description,
          project_id: projectId || null,
          tag_ids: tagIds,
          started_at: range.start.toISOString(),
          stopped_at: range.stop.toISOString(),
          billable: canSetBillable ? billable : false,
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
      ]);
      if (mounted.current) onClose();
    },
  });

  const closePicker = useCallback(() => setOpenPicker(null), []);
  usePopoverEscape(openPicker, closePicker, onClose);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const range = times.resolve();
    if (!range?.stop) return;
    mutation.mutate({ start: range.start, stop: range.stop });
  };

  const pending = mutation.isPending;

  return (
    <EntryPopoverShell
      anchor={anchor ?? FALLBACK_ANCHOR}
      label="Add calendar time entry"
      busy={pending}
      onDismiss={openPicker ? closePicker : onClose}
      onSubmit={submit}
    >
      <PopoverCloseButton label="Cancel new entry" onClick={onClose} />
      <fieldset disabled={pending} className="min-w-0 border-0 p-0">
        <div className="pt-[18px]">
          <DescriptionField
            autoFocus
            label="New entry description"
            value={description}
            onChange={setDescription}
          />
        </div>
        <EntryIconRow
          projects={projects}
          tags={tags}
          projectId={projectId}
          tagIds={tagIds}
          billable={billable}
          canSetBillable={canSetBillable}
          showRate={false}
          rateMajor=""
          rateLabel=""
          disabled={pending}
          onProjectChange={(value) => {
            setProjectId(value);
            if (!canSetBillable) return;
            const project = projects.find((item) => item.id === value);
            setBillable(project?.billable_default === true || project?.billable_default === 1);
          }}
          onTagsChange={setTagIds}
          onBillableChange={setBillable}
          onRateChange={() => undefined}
          openPicker={openPicker}
          onOpenPickerChange={setOpenPicker}
        />
        <EntryTimeRow
          times={times}
          running={false}
          disabled={pending}
          action={
            <Button type="submit" className="w-[85px] px-3 leading-[normal]" disabled={pending}>
              {pending ? "Adding…" : "Add"}
            </Button>
          }
        />
      </fieldset>
      {mutation.error ? (
        <p className="text-error-fg mt-2 text-xs leading-4 font-medium" role="alert">
          {mutation.error.message}
        </p>
      ) : null}
    </EntryPopoverShell>
  );
}
