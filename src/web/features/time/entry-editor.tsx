import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addMinutes } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { useEffect, type ChangeEvent } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { majorToMinor, minorToMajor } from "@/domain/billing/money";
import { useMe } from "@/web/app/context";
import { Button, Field, Input, Modal, Select } from "@/web/components/ui";
import { apiRequest } from "@/web/lib/api";
import type { Project, Tag, TimeEntry } from "@/web/types";

const editorSchema = z
  .object({
    description: z.string().max(500),
    project_id: z.string(),
    started_at: z.string().min(1),
    stopped_at: z.string().min(1),
    duration_minutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60 * 7),
    billable: z.boolean(),
    tag_ids: z.array(z.string()),
    rate_major: z.string().optional(),
  })
  .refine((value) => new Date(value.stopped_at) > new Date(value.started_at), {
    message: "Stop must be after start.",
    path: ["stopped_at"],
  });

type EditorValues = z.infer<typeof editorSchema>;

function localValue(iso: string, timezone: string): string {
  return formatInTimeZone(new Date(iso), timezone, "yyyy-MM-dd'T'HH:mm");
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
  const defaultStopMs = initialStop?.getTime() ?? Date.now();
  const defaultStartMs = initialStart?.getTime() ?? defaultStopMs - 60 * 60_000;
  const form = useForm<EditorValues>({
    resolver: zodResolver(editorSchema),
    defaultValues: {
      description: "",
      project_id: "",
      started_at: localValue(new Date(defaultStartMs).toISOString(), me.member.timezone),
      stopped_at: localValue(new Date(defaultStopMs).toISOString(), me.member.timezone),
      duration_minutes: Math.max(1, Math.round((defaultStopMs - defaultStartMs) / 60_000)),
      billable: false,
      tag_ids: [],
      rate_major: "",
    },
  });

  useEffect(() => {
    const stop = source?.stopped_at ?? initialStop?.toISOString() ?? new Date().toISOString();
    const start =
      source?.started_at ??
      initialStart?.toISOString() ??
      new Date(new Date(stop).getTime() - 60 * 60_000).toISOString();
    form.reset({
      description: source?.description ?? "",
      project_id: source?.project?.id ?? "",
      started_at: localValue(start, me.member.timezone),
      stopped_at: localValue(stop, me.member.timezone),
      duration_minutes: Math.max(
        1,
        Math.round((new Date(stop).getTime() - new Date(start).getTime()) / 60_000),
      ),
      billable: source?.billable ?? false,
      tag_ids: source?.tags.map((tag) => tag.id) ?? [],
      rate_major:
        source?.rate_minor === null || source?.rate_minor === undefined
          ? ""
          : String(minorToMajor(source.rate_minor, source.rate_currency ?? me.workspace.currency)),
    });
  }, [form, initialStart, initialStop, me.member.timezone, me.workspace.currency, open, source]);

  const mutation = useMutation({
    mutationFn: async (values: EditorValues) => {
      const body = {
        ...(targetMemberId && !entry ? { member_id: targetMemberId } : {}),
        description: values.description,
        project_id: values.project_id || null,
        tag_ids: values.tag_ids,
        started_at: fromZonedTime(values.started_at, me.member.timezone).toISOString(),
        stopped_at: fromZonedTime(values.stopped_at, me.member.timezone).toISOString(),
        billable: values.billable,
        ...(me.permissions.financial && values.rate_major
          ? {
              rate_minor: majorToMinor(values.rate_major, me.workspace.currency),
              rate_currency: me.workspace.currency,
            }
          : {}),
      };
      return entry
        ? apiRequest(`/time-entries/${entry.id}`, {
            method: "PATCH",
            body: JSON.stringify({ ...body, version: entry.version }),
          })
        : apiRequest("/time-entries", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
      ]);
      onOpenChange(false);
    },
  });

  const updateDuration = (minutes: number) => {
    const started = form.getValues("started_at");
    if (!started) return;
    const start = fromZonedTime(started, me.member.timezone);
    form.setValue(
      "stopped_at",
      formatInTimeZone(addMinutes(start, minutes), me.member.timezone, "yyyy-MM-dd'T'HH:mm"),
      { shouldValidate: true },
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={entry ? "Edit time entry" : "Add time entry"}
      description="Times are saved as exact timestamps and displayed in your configured timezone."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void form.handleSubmit((values) => mutation.mutate(values))()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Save entry"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit((values) => mutation.mutate(values))();
        }}
      >
        <Field label="Description">
          <Input placeholder="What did you work on?" {...form.register("description")} />
        </Field>
        <Field label="Project">
          <Select {...form.register("project_id")}>
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.client_name} · {project.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Start">
            <Input type="datetime-local" {...form.register("started_at")} />
          </Field>
          <Field label="Stop">
            <Input type="datetime-local" {...form.register("stopped_at")} />
          </Field>
          <Field label="Duration (minutes)" hint="Changing duration preserves the start time.">
            <Input
              type="number"
              min={1}
              {...form.register("duration_minutes", {
                valueAsNumber: true,
                onChange: (event: ChangeEvent<HTMLInputElement>) =>
                  updateDuration(Number(event.currentTarget.value)),
              })}
            />
          </Field>
        </div>
        {form.formState.errors.stopped_at ? (
          <p className="text-sm text-red-600">{form.formState.errors.stopped_at.message}</p>
        ) : null}
        {tags.length > 0 ? (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-700">Tags</legend>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <label
                  key={tag.id}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
                >
                  <input type="checkbox" value={tag.id} {...form.register("tag_ids")} />
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" {...form.register("billable")} />
          Billable
        </label>
        {me.permissions.financial && form.watch("billable") ? (
          <Field
            label={`Explicit hourly rate (${me.workspace.currency})`}
            hint="Leave blank to keep the inherited rate."
          >
            <Input type="number" min="0" step="0.01" {...form.register("rate_major")} />
          </Field>
        ) : null}
        {mutation.error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{mutation.error.message}</p>
        ) : null}
      </form>
    </Modal>
  );
}
