import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleDollarSign, Clock3, Contact, Eye } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { z } from "zod";

import { majorToMinor, minorToMajor } from "@/domain/billing/money";
import { useMe } from "@/web/app/context";
import { FormErrors } from "@/web/components/form-errors";
import { FormSelect } from "@/web/components/form-select";
import {
  Button,
  Checkbox,
  ErrorState,
  Field,
  Input,
  Loading,
  Modal,
  Switch,
  Textarea,
  useToast,
} from "@/web/components/ui";
import { ColorDotPicker, PROJECT_COLORS } from "@/web/features/manage/color-picker";
import { AdvancedToggle, OptionCard } from "@/web/features/manage/option-card";
import { apiRequest } from "@/web/lib/api";
import { formatDuration } from "@/web/lib/format";
import type { Client, Member, Project, TimeEntry } from "@/web/types";

const projectSchema = z.object({
  client_id: z.string().trim().min(1, "This field is required."),
  name: z.string().trim().min(1, "This field is required."),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  billable_default: z.boolean(),
  hourly_rate_major: z
    .string()
    .refine(
      (value) => !value || (Number.isFinite(Number(value)) && Number(value) >= 0),
      "Enter a non-negative number.",
    ),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Enter a three-letter currency code."),
  budget_hours: z
    .string()
    .refine(
      (value) => !value || (Number.isFinite(Number(value)) && Number(value) >= 0),
      "Enter a non-negative number.",
    ),
  visibility: z.enum(["all", "assigned"]),
  notes: z.string(),
  member_ids: z.array(z.string()),
});
type ProjectForm = z.infer<typeof projectSchema>;

const randomColor = () =>
  PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)] ?? PROJECT_COLORS[0];

export function parseMemberIds(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Toggl's "Create new project" dialog (520px): colour dot + name first, a Client card, a Privacy
 * card whose panel lists assigned members, "Advanced options" for rates, budget, billing and
 * notes, and one full-width 36px primary button. Edit mode adds the recent-time list.
 */
export function ProjectEditor({
  open,
  project,
  initialSection = "details",
  onOpenChange,
}: {
  open: boolean;
  project: Project | null;
  /**
   * `members` is the row menu's "Add member": Toggl only assigns members to private projects, so
   * the dialog opens with the privacy switch on and its member panel expanded.
   */
  initialSection?: "details" | "members";
  onOpenChange: (open: boolean) => void;
}) {
  const me = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const advancedId = useId();
  const [advanced, setAdvanced] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const clients = useQuery({
    queryKey: ["clients", "active"],
    queryFn: () => apiRequest<{ clients: Client[] }>("/clients?status=active"),
    enabled: open,
  });
  const members = useQuery({
    queryKey: ["members"],
    queryFn: () => apiRequest<{ members: Member[] }>("/members"),
    enabled: open,
  });
  const recentEntries = useQuery({
    queryKey: ["projects", project?.id, "recent"],
    queryFn: () => apiRequest<{ entries: TimeEntry[] }>(`/projects/${String(project?.id)}/recent`),
    enabled: open && Boolean(project),
  });
  const form = useForm<ProjectForm>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      client_id: "",
      name: "",
      color: randomColor(),
      billable_default: false,
      hourly_rate_major: "",
      currency: me.workspace.currency,
      budget_hours: "",
      visibility: "all",
      notes: "",
      member_ids: [],
    },
  });
  useEffect(() => {
    form.reset({
      client_id: project?.client_id ?? "",
      name: project?.name ?? "",
      color: project?.color ?? randomColor(),
      billable_default: Boolean(project?.billable_default),
      hourly_rate_major:
        project?.hourly_rate_minor === null || project?.hourly_rate_minor === undefined
          ? ""
          : String(
              minorToMajor(project.hourly_rate_minor, project.currency ?? me.workspace.currency),
            ),
      currency: project?.currency ?? me.workspace.currency,
      budget_hours:
        project?.budget_minutes === null || project?.budget_minutes === undefined
          ? ""
          : String(project.budget_minutes / 60),
      visibility: initialSection === "members" ? "assigned" : (project?.visibility ?? "all"),
      notes: project?.notes ?? "",
      member_ids: parseMemberIds(project?.member_ids_json),
    });
    setAdvanced(false);
    setMembersOpen(project?.visibility === "assigned" || initialSection === "members");
  }, [form, initialSection, me.workspace.currency, open, project]);
  const mutation = useMutation({
    mutationFn: async (values: ProjectForm) => {
      const body = {
        client_id: values.client_id,
        name: values.name,
        color: values.color,
        billable_default: values.billable_default,
        hourly_rate_minor: values.hourly_rate_major
          ? majorToMinor(values.hourly_rate_major, values.currency)
          : null,
        currency: values.currency.toUpperCase(),
        budget_minutes: values.budget_hours ? Math.round(Number(values.budget_hours) * 60) : null,
        visibility: values.visibility,
        notes: values.notes || null,
        member_ids: values.visibility === "assigned" ? values.member_ids : [],
        ...(project ? { version: project.version } : {}),
      };
      try {
        return await apiRequest(project ? `/projects/${project.id}` : "/projects", {
          method: project ? "PATCH" : "POST",
          body: JSON.stringify(body),
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("Historical entries will keep their client snapshot")
        ) {
          if (!window.confirm(`${error.message} Continue with this client change?`)) {
            throw new Error(
              "Client change cancelled. Your edits are still here; choose the original client or save again to confirm the change.",
              { cause: error },
            );
          }
          if (!project) throw error;
          return apiRequest(`/projects/${project.id}`, {
            method: "PATCH",
            body: JSON.stringify({ ...body, confirm_client_change: true }),
          });
        }
        throw error;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast({ message: project ? "Project updated." : "Project created." });
      onOpenChange(false);
    },
  });

  const errors = form.formState.errors;
  const visibility = form.watch("visibility");
  const color = form.watch("color");
  const memberIds = form.watch("member_ids");
  const assignedMembers = (members.data?.members ?? []).filter(
    (member) => member.status !== "inactive",
  );
  const otherErrors: FieldErrors<ProjectForm> = { ...errors };
  delete otherErrors.name;
  delete otherErrors.client_id;
  const hasAdvancedErrors = Boolean(
    errors.client_id ??
    errors.currency ??
    errors.hourly_rate_major ??
    errors.budget_hours ??
    errors.notes,
  );
  useEffect(() => {
    if (hasAdvancedErrors) setAdvanced(true);
  }, [hasAdvancedErrors]);
  const submit = () =>
    void form.handleSubmit((values) => !mutation.isPending && mutation.mutate(values))();

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) onOpenChange(next);
      }}
      size="md"
      align="top"
      borderless
      offsetX={80}
      title={project ? "Edit project" : "Create new project"}
      footer={
        <Button
          className="w-full"
          disabled={
            mutation.isPending ||
            clients.isPending ||
            Boolean(clients.error) ||
            (visibility === "assigned" && (members.isPending || Boolean(members.error)))
          }
          onClick={submit}
        >
          {mutation.isPending ? "Saving…" : project ? "Save" : "Create project"}
        </Button>
      }
    >
      <form
        noValidate
        className="-mb-1 grid gap-3 pt-1.5"
        onSubmit={form.handleSubmit((values) => !mutation.isPending && mutation.mutate(values))}
      >
        <fieldset disabled={mutation.isPending} className="contents">
          <div className="mb-[7px] flex items-start pr-4 pl-2">
            <ColorDotPicker value={color} onChange={(next) => form.setValue("color", next)} />
            <div className="min-w-0 flex-1">
              <input
                data-autofocus
                aria-label="Project name"
                aria-invalid={Boolean(errors.name)}
                placeholder="Project name"
                autoComplete="off"
                className="hl-name-field bg-surface-hover text-fg placeholder:text-fg-subtle box-border h-10 w-full rounded-lg px-[11px] text-base font-semibold aria-invalid:bg-[#331d1b]"
                {...form.register("name")}
              />
              {errors.name ? (
                <p role="alert" className="mt-[5px] px-3 text-xs font-medium text-[#e32817]">
                  Please enter a Project name
                </p>
              ) : null}
            </div>
          </div>
          <div className="empty:hidden">
            <FormErrors errors={otherErrors} />
          </div>
          {clients.isPending ? (
            <Loading label="Loading clients…" />
          ) : clients.error ? (
            <ErrorState message={clients.error.message} onRetry={() => void clients.refetch()} />
          ) : null}
          <div>
            <OptionCard
              icon={<Eye size={14} strokeWidth={1.5} />}
              label="Privacy"
              className={visibility === "assigned" && membersOpen ? "rounded-b-none" : undefined}
            >
              <Switch
                aria-label="Private, visible only to project members"
                checked={visibility === "assigned"}
                onCheckedChange={(next) => {
                  form.setValue("visibility", next ? "assigned" : "all");
                  setMembersOpen(next);
                }}
              />
              <span className="text-fg-subtle ml-2 min-w-0 flex-1 text-xs leading-[17px] font-medium">
                Private, visible only to project members
              </span>
              {visibility === "assigned" ? (
                <button
                  type="button"
                  aria-label="Manage project members"
                  aria-expanded={membersOpen}
                  className="text-fg hover:bg-surface-hover mr-[5px] grid size-[34px] place-items-center rounded-lg"
                  onClick={() => setMembersOpen((current) => !current)}
                >
                  <svg
                    width="14"
                    height="9"
                    viewBox="0 0 14 9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className={membersOpen ? "rotate-180" : undefined}
                  >
                    <path d="M1 1.5 7 7.5l6-6" />
                  </svg>
                </button>
              ) : null}
            </OptionCard>
            {visibility === "assigned" && membersOpen ? (
              <fieldset className="bg-surface-secondary border-stroke mx-[18px] grid gap-2 rounded-b-lg border border-t-0 px-4 pt-6 pb-6">
                <legend className="sr-only">Assigned members</legend>
                <p className="text-fg text-[11px] leading-[14px] font-semibold tracking-[0.4px] uppercase">
                  Assigned members
                </p>
                {members.error ? (
                  <ErrorState
                    message={members.error.message}
                    onRetry={() => void members.refetch()}
                  />
                ) : null}
                {assignedMembers.map((member) => {
                  const checked = memberIds.includes(member.id);
                  return (
                    <label
                      key={member.id}
                      className="hover:bg-surface-hover -mx-2 flex h-[30px] cursor-pointer items-center gap-2.5 rounded-lg px-2"
                    >
                      <Checkbox
                        value={member.id}
                        checked={checked}
                        onChange={() =>
                          form.setValue(
                            "member_ids",
                            checked
                              ? memberIds.filter((id) => id !== member.id)
                              : [...memberIds, member.id],
                          )
                        }
                      />
                      <span className="min-w-0 truncate">
                        {member.display_name}{" "}
                        <span className="text-fg-subtle">({member.email})</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ) : null}
          </div>
          <AdvancedToggle
            open={advanced}
            controls={advancedId}
            onClick={() => setAdvanced((current) => !current)}
          />
          {advanced ? (
            <div id={advancedId} className="grid gap-3">
              {/* Toggl keeps the Client picker under "Advanced Options", not in the main dialog. */}
              <OptionCard
                icon={<Contact size={14} strokeWidth={1.5} />}
                label="Client"
                className="pl-3.5"
              >
                <div className="min-w-0 flex-1">
                  <FormSelect
                    control={form.control}
                    name="client_id"
                    placeholder="Select a client"
                    aria-label="Client"
                    className="h-10"
                    options={[
                      ...(project &&
                      !clients.isPending &&
                      !clients.data?.clients.some((client) => client.id === project.client_id)
                        ? [{ value: project.client_id, label: `${project.client_name} (archived)` }]
                        : []),
                      ...(clients.data?.clients ?? []).map((client) => ({
                        value: client.id,
                        label: client.name,
                      })),
                    ]}
                  />
                </div>
              </OptionCard>
              {errors.client_id ? (
                <p role="alert" className="-mt-1.5 px-[28px] text-xs font-medium text-[#e32817]">
                  Please select a Client
                </p>
              ) : null}
              <OptionCard
                icon={<CircleDollarSign size={14} strokeWidth={1.5} />}
                label="Rate"
                className="py-1 pr-0"
              >
                <div className="flex min-w-0 flex-1 gap-1.5">
                  <Input
                    aria-label="Currency"
                    maxLength={3}
                    className="h-10 w-16 shrink-0 uppercase"
                    aria-invalid={Boolean(errors.currency)}
                    {...form.register("currency")}
                  />
                  <Input
                    aria-label="Hourly rate"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Hourly rate"
                    className="h-10"
                    aria-invalid={Boolean(errors.hourly_rate_major)}
                    {...form.register("hourly_rate_major")}
                  />
                </div>
              </OptionCard>
              <OptionCard
                icon={<Clock3 size={14} strokeWidth={1.5} />}
                label="Time estimate"
                className="py-1 pr-0"
              >
                <div className="min-w-0 flex-1">
                  <Input
                    aria-label="Budget hours"
                    type="number"
                    min="0"
                    step="0.25"
                    placeholder="Budget hours"
                    className="h-10"
                    aria-invalid={Boolean(errors.budget_hours)}
                    {...form.register("budget_hours")}
                  />
                </div>
              </OptionCard>
              <OptionCard icon={<CircleDollarSign size={14} strokeWidth={1.5} />} label="Billable">
                <Switch
                  aria-label="Billable by default"
                  checked={form.watch("billable_default")}
                  onCheckedChange={(next) => form.setValue("billable_default", next)}
                />
                <span className="text-fg-subtle ml-2 text-xs leading-[17px] font-medium">
                  Billable by default
                </span>
              </OptionCard>
              <div className="mx-3">
                <Field label="Notes">
                  <Textarea aria-invalid={Boolean(errors.notes)} {...form.register("notes")} />
                </Field>
              </div>
              {project ? (
                <section className="border-stroke mx-3 rounded-lg border p-3">
                  <h3 className="text-fg-muted flex items-center gap-2 text-[11px] leading-4 font-semibold tracking-[0.44px] uppercase">
                    <Clock3 size={14} strokeWidth={1.5} aria-hidden="true" /> Recent time
                  </h3>
                  {recentEntries.isLoading ? (
                    <p className="text-fg-subtle mt-2 text-sm">Loading recent entries…</p>
                  ) : recentEntries.error ? (
                    <ErrorState
                      message={recentEntries.error.message}
                      onRetry={() => void recentEntries.refetch()}
                    />
                  ) : (recentEntries.data?.entries.length ?? 0) === 0 ? (
                    <p className="text-fg-subtle mt-2 text-sm">No time has been tracked yet.</p>
                  ) : (
                    <ul className="divide-stroke mt-2 divide-y">
                      {(recentEntries.data?.entries ?? []).map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-center justify-between gap-3 py-2 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="truncate">{entry.description || "Untitled entry"}</p>
                            <p className="text-fg-subtle text-xs">
                              {entry.member.name} ·{" "}
                              {new Intl.DateTimeFormat(undefined, {
                                dateStyle: "medium",
                                timeZone: me.member.timezone,
                              }).format(new Date(entry.started_at))}
                            </p>
                          </div>
                          <span className="shrink-0 font-semibold">
                            {formatDuration(entry.duration_ms)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}
            </div>
          ) : null}
          {mutation.error ? (
            <p role="alert" className="text-error-fg mx-3 text-sm">
              {mutation.error.message}
            </p>
          ) : null}
        </fieldset>
      </form>
    </Modal>
  );
}
