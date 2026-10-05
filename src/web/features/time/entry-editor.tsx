import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addSeconds } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { useEffect, useMemo, useRef, type ChangeEvent } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { majorToMinor, minorToMajor } from "@/domain/billing/money";
import { localDateTimeToEpoch } from "@/domain/dates/time";
import { useMe } from "@/web/app/context";
import { Button, Field, Input, Modal, Select } from "@/web/components/ui";
import { ApiClientError, apiRequest } from "@/web/lib/api";
import { formatClockDuration, parseClockDuration } from "@/web/lib/format";
import type { Project, Tag, TimeEntry } from "@/web/types";

type EditorValues = {
  description: string;
  project_id: string;
  started_at: string;
  stopped_at: string;
  duration_clock: string;
  billable: boolean;
  tag_ids: string[];
  rate_major: string;
};

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

function localValueWithSeconds(iso: string, timezone: string): string {
  return formatInTimeZone(new Date(iso), timezone, "yyyy-MM-dd'T'HH:mm:ss");
}

function replaceDate(value: string, date: string): string {
  const time =
    LOCAL_DATE_TIME.exec(value)?.[2] ?? (value.includes("T") ? value.slice(11) : "00:00:00");
  return `${date}T${time || "00:00:00"}`;
}

function replaceTime(value: string, time: string): string {
  const date = LOCAL_DATE_TIME.exec(value)?.[1] ?? value.slice(0, 10);
  return `${date}T${time}`;
}

function durationClockBetween(start: Date, stop: Date): string {
  return formatClockDuration(Math.max(1000, stop.getTime() - start.getTime()));
}

function projectOptionLabel(project: { name: string; client_name: string }): string {
  if (!project.client_name || project.client_name === "No client") return project.name;
  return `${project.name} • ${project.client_name}`;
}

function rateMajorFromSource(
  source: TimeEntry | null | undefined,
  workspaceCurrency: string,
): string {
  if (source?.rate_minor === null || source?.rate_minor === undefined) return "";
  return String(minorToMajor(source.rate_minor, source.rate_currency ?? workspaceCurrency));
}

function createEditorSchema(timezone: string, running: boolean) {
  return z
    .object({
      description: z.string().max(500, "Description must be 500 characters or fewer."),
      project_id: z.string(),
      started_at: z.string(),
      stopped_at: z.string(),
      duration_clock: z.string().refine((value) => running || parseClockDuration(value) !== null, {
        message: "Enter a duration in h:mm:ss, up to 168 hours.",
      }),
      billable: z.boolean(),
      tag_ids: z.array(z.string()),
      rate_major: z
        .string()
        .refine((value) => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0), {
          message: "Enter a valid rate.",
        }),
    })
    .superRefine((value, ctx) => {
      const start = parseLocalDateTime(value.started_at, timezone);
      const stop = parseLocalDateTime(value.stopped_at, timezone);
      if (!start) {
        ctx.addIssue({
          code: "custom",
          path: ["started_at"],
          message: "Enter a valid start date and time.",
        });
      }
      if (!stop) {
        ctx.addIssue({
          code: "custom",
          path: ["stopped_at"],
          message: "Enter a valid stop date and time.",
        });
      }
      if (!running && start && stop && stop <= start) {
        ctx.addIssue({
          code: "custom",
          path: ["stopped_at"],
          message: "Stop must be after start.",
        });
      }
    });
}

function DateTimeFields({
  label,
  value,
  error,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const date = value.slice(0, 10);
  const time = value.includes("T") ? value.slice(value.indexOf("T") + 1) : "";
  const dateValue = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
  const timeValue = /^\d{2}:\d{2}(?::\d{2})?$/.test(time) ? time : "";

  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 rounded-lg border border-[#3b3b3b] bg-[#1b1b1b] p-2.5 disabled:opacity-50"
    >
      <legend className="px-1 text-[10px] font-bold tracking-wider text-[#a4a4a4] uppercase">
        {label}
      </legend>
      <div className="grid min-w-0 gap-2">
        <label className="grid min-w-0 gap-1 text-[10px] font-bold tracking-wider text-[#a4a4a4] uppercase">
          Date
          <Input
            type="date"
            className="h-9 min-h-9 px-2 text-xs"
            value={dateValue}
            aria-label={`${label} date`}
            aria-invalid={Boolean(error)}
            onChange={(event) => onChange(replaceDate(value, event.target.value))}
          />
        </label>
        <label className="grid min-w-0 gap-1 text-[10px] font-bold tracking-wider text-[#a4a4a4] uppercase">
          Time
          <Input
            type="time"
            step={1}
            className="h-9 min-h-9 px-2 text-xs tabular-nums"
            value={timeValue}
            aria-label={`${label} time`}
            aria-invalid={Boolean(error)}
            onChange={(event) => onChange(replaceTime(value, event.target.value))}
          />
        </label>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export function EntryEditor({
  open,
  onOpenChange,
  entry,
  template,
  targetMemberId,
  initialStart,
  initialStop,
  projects,
  tags,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry?: TimeEntry | null;
  template?: TimeEntry | null;
  targetMemberId?: string;
  initialStart?: Date;
  initialStop?: Date;
  projects: Project[];
  tags: Tag[];
}) {
  const me = useMe();
  const queryClient = useQueryClient();
  const source = entry ?? template;
  const timezone = me.member.timezone;
  const canSetBillable = me.workspace.members_can_set_billable || me.member.role !== "member";
  const defaultStopMs = initialStop?.getTime() ?? Date.now();
  const defaultStartMs = initialStart?.getTime() ?? defaultStopMs - 60 * 60_000;
  const initialStartMs = initialStart?.getTime();
  const initialStopMs = initialStop?.getTime();
  const generationRef = useRef(0);
  const originalRateMajorRef = useRef("");
  const running = entry?.running ?? false;
  const schema = useMemo(() => createEditorSchema(timezone, running), [timezone, running]);
  const form = useForm<EditorValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      description: "",
      project_id: "",
      started_at: localValueWithSeconds(new Date(defaultStartMs).toISOString(), timezone),
      stopped_at: localValueWithSeconds(new Date(defaultStopMs).toISOString(), timezone),
      duration_clock: formatClockDuration(Math.max(1000, defaultStopMs - defaultStartMs)),
      billable: false,
      tag_ids: [],
      rate_major: "",
    },
  });

  const availableProjects = useMemo(() => {
    const merged = new Map<string, Project>(projects.map((project) => [project.id, project]));
    if (source?.project && !merged.has(source.project.id)) {
      merged.set(source.project.id, {
        id: source.project.id,
        name: source.project.name ?? "Archived project",
        color: source.project.color ?? "#64748b",
        client_id: source.client?.id ?? "",
        client_name: source.client?.name ?? "Archived",
        billable_default: false,
      });
    }
    return [...merged.values()];
  }, [projects, source]);

  const availableTags = useMemo(() => {
    const merged = new Map(tags.map((tag) => [tag.id, tag]));
    for (const tag of source?.tags ?? []) merged.set(tag.id, tag);
    return [...merged.values()];
  }, [source, tags]);

  const mutation = useMutation({
    mutationFn: async ({ values }: { values: EditorValues; generation: number }) => {
      const start = parseLocalDateTime(values.started_at, timezone);
      const stop = parseLocalDateTime(values.stopped_at, timezone);
      if (!start || !stop) throw new Error("Enter a valid start and stop time.");
      if (!running && stop <= start) throw new Error("Stop must be after start.");

      const rateChanged = values.rate_major !== originalRateMajorRef.current;
      const body = {
        ...(targetMemberId && !entry ? { member_id: targetMemberId } : {}),
        description: values.description,
        project_id: values.project_id || null,
        tag_ids: values.tag_ids,
        started_at:
          entry && values.started_at === localValueWithSeconds(entry.started_at, timezone)
            ? entry.started_at
            : start.toISOString(),
        ...(!running
          ? {
              stopped_at:
                entry?.stopped_at &&
                values.stopped_at === localValueWithSeconds(entry.stopped_at, timezone)
                  ? entry.stopped_at
                  : stop.toISOString(),
            }
          : {}),
        billable: canSetBillable ? values.billable : (entry?.billable ?? false),
        ...(me.permissions.financial && values.billable && rateChanged && values.rate_major
          ? {
              rate_minor: majorToMinor(
                values.rate_major,
                source?.rate_currency ?? me.workspace.currency,
              ),
              rate_currency: source?.rate_currency ?? me.workspace.currency,
            }
          : {}),
      };
      if (!entry)
        return apiRequest("/time-entries", { method: "POST", body: JSON.stringify(body) });
      const save = (overrideReason?: string) =>
        apiRequest(`/time-entries/${entry.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...body,
            version: entry.version,
            ...(overrideReason ? { override_reason: overrideReason } : {}),
          }),
        });
      try {
        return await save();
      } catch (error) {
        if (error instanceof ApiClientError && error.code === "override_reason_required") {
          const reason = window.prompt("This entry is locked. Enter an audit reason to override:");
          if (reason?.trim()) return save(reason.trim());
        }
        throw error;
      }
    },
    onSuccess: async (_data, submitted) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
        queryClient.invalidateQueries({ queryKey: ["timer"] }),
      ]);
      if (submitted.generation === generationRef.current) onOpenChange(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    generationRef.current += 1;
    mutation.reset();
    const current = entry ?? template;
    const stopIso = current?.stopped_at ?? initialStop?.toISOString() ?? new Date().toISOString();
    const startIso =
      current?.started_at ??
      initialStart?.toISOString() ??
      new Date(new Date(stopIso).getTime() - 60 * 60_000).toISOString();
    const rateMajor = rateMajorFromSource(current, me.workspace.currency);
    originalRateMajorRef.current = rateMajor;
    form.reset({
      description: current?.description ?? "",
      project_id: current?.project?.id ?? "",
      started_at: localValueWithSeconds(startIso, timezone),
      stopped_at: localValueWithSeconds(stopIso, timezone),
      duration_clock: durationClockBetween(new Date(startIso), new Date(stopIso)),
      billable: current?.billable ?? false,
      tag_ids: current?.tags.map((tag) => tag.id) ?? [],
      rate_major: rateMajor,
    });
    // Reset drafts and mutation errors only when a new dialog session opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    entry?.id,
    template?.id,
    initialStartMs,
    initialStopMs,
    timezone,
    me.workspace.currency,
  ]);

  const syncDurationFromTimes = (startedAt: string, stoppedAt: string) => {
    const start = parseLocalDateTime(startedAt, timezone);
    const stop = parseLocalDateTime(stoppedAt, timezone);
    if (!start || !stop || stop <= start) return;
    form.setValue("duration_clock", durationClockBetween(start, stop), {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const updateDuration = (value: string) => {
    const seconds = parseClockDuration(value);
    if (seconds === null) return;
    const started = form.getValues("started_at");
    const start = parseLocalDateTime(started, timezone);
    if (!start) return;
    form.setValue(
      "stopped_at",
      formatInTimeZone(addSeconds(start, seconds), timezone, "yyyy-MM-dd'T'HH:mm:ss"),
      { shouldDirty: true, shouldValidate: true },
    );
  };

  const setStartedAt = (next: string) => {
    form.setValue("started_at", next, { shouldDirty: true, shouldValidate: true });
    syncDurationFromTimes(next, form.getValues("stopped_at"));
  };

  const setStoppedAt = (next: string) => {
    form.setValue("stopped_at", next, { shouldDirty: true, shouldValidate: true });
    syncDurationFromTimes(form.getValues("started_at"), next);
  };

  const submit = form.handleSubmit(
    (values) => {
      if (mutation.isPending) return;
      mutation.mutate({ values, generation: generationRef.current });
    },
    () => undefined,
  );

  const startedAt = form.watch("started_at");
  const stoppedAt = form.watch("stopped_at");
  const billable = form.watch("billable");

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={entry ? "Edit time entry" : "Add time entry"}
      description={`Timezone: ${timezone}`}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save entry"}
          </Button>
        </>
      }
    >
      <form
        className="grid min-w-0 gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={mutation.isPending} className="grid min-w-0 gap-4 border-0 p-0">
          <Field label="Description" error={form.formState.errors.description?.message}>
            <Input placeholder="What did you work on?" {...form.register("description")} />
          </Field>
          <Field label="Project">
            <Select {...form.register("project_id")}>
              <option value="">No project</option>
              {availableProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {projectOptionLabel(project)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <DateTimeFields
              label="Start"
              value={startedAt}
              error={form.formState.errors.started_at?.message}
              onChange={setStartedAt}
            />
            <DateTimeFields
              label="Stop"
              disabled={running}
              value={stoppedAt}
              error={form.formState.errors.stopped_at?.message}
              onChange={setStoppedAt}
            />
          </div>
          <Field
            label="Duration (h:mm:ss)"
            hint={
              running
                ? "This entry is running. Stop it with the timer control."
                : "Changing duration preserves the start time."
            }
            error={form.formState.errors.duration_clock?.message}
          >
            <Input
              type="text"
              disabled={running}
              aria-label="Duration (h:mm:ss)"
              {...form.register("duration_clock", {
                onChange: (event: ChangeEvent<HTMLInputElement>) =>
                  updateDuration(event.currentTarget.value),
              })}
            />
          </Field>
          {availableTags.length > 0 ? (
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-[#a4a4a4]">Tags</legend>
              <div className="flex min-w-0 flex-wrap gap-2">
                {availableTags.map((tag) => (
                  <label
                    key={tag.id}
                    className="flex items-center gap-2 rounded-lg border border-[#3b3b3b] px-2.5 py-1.5 text-sm text-[#fafafa]"
                  >
                    <input type="checkbox" value={tag.id} {...form.register("tag_ids")} />
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {canSetBillable ? (
            <label className="flex items-center gap-2 text-sm font-medium text-[#a4a4a4]">
              <input type="checkbox" {...form.register("billable")} />
              Billable
            </label>
          ) : null}
          {me.permissions.financial && billable ? (
            <Field
              label={`Explicit hourly rate (${source?.rate_currency ?? me.workspace.currency})`}
              hint="Leave blank to keep the inherited rate."
              error={form.formState.errors.rate_major?.message}
            >
              <Input
                type="number"
                min="0"
                step="0.01"
                aria-label={`Explicit hourly rate (${source?.rate_currency ?? me.workspace.currency})`}
                {...form.register("rate_major")}
              />
            </Field>
          ) : null}
          {mutation.error ? (
            <p className="rounded-lg bg-red-950/40 p-3 text-sm text-red-300" role="alert">
              {mutation.error.message}
            </p>
          ) : null}
        </fieldset>
      </form>
    </Modal>
  );
}
