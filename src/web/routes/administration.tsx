import { zodResolver } from "@hookform/resolvers/zod";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, History, Plus, RotateCcw, Save, ShieldCheck, Tags } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useMe } from "@/web/app/context";
import { majorToMinor, minorToMajor } from "@/domain/billing/money";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Loading,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
} from "@/web/components/ui";
import { FormErrors } from "@/web/components/form-errors";
import { apiRequest } from "@/web/lib/api";
import type { Tag } from "@/web/types";

interface Settings {
  app_name: string;
  company_name: string;
  company_domain: string;
  timezone: string;
  currency: string;
  week_start: "monday" | "sunday";
  allowed_email_domains: string[];
  default_rate_minor: number | null;
  members_can_set_billable: number;
  lock_entries_after_days: number | null;
  rounding_increment_minutes: number;
  rounding_method: "nearest" | "up" | "down";
  report_show_descriptions: number;
  report_show_tags: number;
  report_show_members: number;
  version: number;
  access: {
    configured: boolean;
    team_domain: string | null;
    audience: string | null;
    bootstrap_admins_configured: boolean;
  };
}

interface AuditEvent {
  id: string;
  actor_name: string;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  reason: string | null;
  request_id: string;
  created_at: number;
}

const settingsSchema = z.object({
  app_name: z.string().trim().min(1, "This field is required."),
  company_name: z.string().trim().min(1, "This field is required."),
  company_domain: z.string().trim().min(1, "This field is required."),
  timezone: z.string().trim().min(1, "This field is required."),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Enter a three-letter currency code."),
  week_start: z.enum(["monday", "sunday"]),
  allowed_email_domains: z.string().trim().min(1, "This field is required."),
  default_rate_major: z
    .string()
    .refine(
      (value) => !value || (Number.isFinite(Number(value)) && Number(value) >= 0),
      "Enter a non-negative number.",
    ),
  members_can_set_billable: z.boolean(),
  lock_entries_after_days: z
    .string()
    .refine(
      (value) => !value || (Number.isInteger(Number(value)) && Number(value) >= 0),
      "Enter a whole number of days, zero or greater.",
    ),
  rounding_increment_minutes: z.enum(["0", "1", "5", "6", "10", "15", "30", "60"]),
  rounding_method: z.enum(["nearest", "up", "down"]),
  report_show_descriptions: z.boolean(),
  report_show_tags: z.boolean(),
  report_show_members: z.boolean(),
});
type SettingsForm = z.infer<typeof settingsSchema>;

type Tab = "workspace" | "tags" | "audit";

export function AdministrationPage() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>("workspace");
  if (!me.permissions.manage_members)
    return <ErrorState message="Only administrators can access workspace administration." />;
  return (
    <>
      <PageHeader
        title="Administration"
        description="Workspace policies, tags, security posture, and immutable audit history."
      />
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {(
          [
            ["workspace", ShieldCheck, "Workspace & security"],
            ["tags", Tags, "Tags"],
            ["audit", History, "Audit log"],
          ] as const
        ).map(([value, Icon, label]) => (
          <Button
            key={value}
            variant={tab === value ? "primary" : "ghost"}
            onClick={() => setTab(value)}
          >
            <Icon size={15} /> {label}
          </Button>
        ))}
      </div>
      {tab === "workspace" ? <WorkspaceSettings /> : null}
      {tab === "tags" ? <TagSettings /> : null}
      {tab === "audit" ? <AuditLog /> : null}
    </>
  );
}

function WorkspaceSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiRequest<{ settings: Settings }>("/settings"),
  });
  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      app_name: "",
      company_name: "",
      company_domain: "",
      timezone: "",
      currency: "USD",
      week_start: "monday",
      allowed_email_domains: "iomechs.com",
      default_rate_major: "",
      members_can_set_billable: false,
      lock_entries_after_days: "",
      rounding_increment_minutes: "0",
      rounding_method: "nearest",
      report_show_descriptions: true,
      report_show_tags: true,
      report_show_members: true,
    },
  });
  useEffect(() => {
    const value = settings.data?.settings;
    if (!value) return;
    form.reset({
      app_name: value.app_name,
      company_name: value.company_name,
      company_domain: value.company_domain,
      timezone: value.timezone,
      currency: value.currency,
      week_start: value.week_start,
      allowed_email_domains: value.allowed_email_domains.join(", "),
      default_rate_major:
        value.default_rate_minor === null
          ? ""
          : String(minorToMajor(value.default_rate_minor, value.currency)),
      members_can_set_billable: Boolean(value.members_can_set_billable),
      lock_entries_after_days:
        value.lock_entries_after_days === null ? "" : String(value.lock_entries_after_days),
      rounding_increment_minutes: String(
        value.rounding_increment_minutes,
      ) as SettingsForm["rounding_increment_minutes"],
      rounding_method: value.rounding_method,
      report_show_descriptions: Boolean(value.report_show_descriptions),
      report_show_tags: Boolean(value.report_show_tags),
      report_show_members: Boolean(value.report_show_members),
    });
  }, [form, settings.data]);
  const mutation = useMutation({
    mutationFn: (value: SettingsForm) =>
      apiRequest("/settings", {
        method: "PATCH",
        body: JSON.stringify({
          version: settings.data?.settings.version,
          app_name: value.app_name,
          company_name: value.company_name,
          company_domain: value.company_domain,
          timezone: value.timezone,
          currency: value.currency.toUpperCase(),
          week_start: value.week_start,
          allowed_email_domains: value.allowed_email_domains
            .split(",")
            .map((domain) => domain.trim().toLowerCase())
            .filter(Boolean),
          default_rate_minor: value.default_rate_major
            ? majorToMinor(value.default_rate_major, value.currency)
            : null,
          members_can_set_billable: value.members_can_set_billable,
          lock_entries_after_days: value.lock_entries_after_days
            ? Number(value.lock_entries_after_days)
            : null,
          rounding_increment_minutes: Number(value.rounding_increment_minutes),
          rounding_method: value.rounding_method,
          report_show_descriptions: value.report_show_descriptions,
          report_show_tags: value.report_show_tags,
          report_show_members: value.report_show_members,
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["settings"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
      ]);
    },
  });
  const access = settings.data?.settings.access;
  if (settings.isPending) return <Loading label="Loading workspace settings…" />;
  if (settings.error)
    return <ErrorState message={settings.error.message} onRetry={() => void settings.refetch()} />;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <form
        noValidate
        className="panel grid gap-4 p-5 sm:grid-cols-2"
        onSubmit={form.handleSubmit((value) => mutation.mutate(value))}
      >
        <fieldset disabled={mutation.isPending} className="contents">
          <FormErrors errors={form.formState.errors} />
          <div className="sm:col-span-2">
            <h2 className="font-bold text-slate-900">Company workspace</h2>
            <p className="mt-1 text-sm text-slate-500">
              These defaults drive entry behavior, report calculations, and exports.
            </p>
          </div>
          <Field label="Application name">
            <Input
              aria-invalid={Boolean(form.formState.errors.app_name)}
              {...form.register("app_name")}
            />
          </Field>
          <Field label="Company name">
            <Input
              aria-invalid={Boolean(form.formState.errors.company_name)}
              {...form.register("company_name")}
            />
          </Field>
          <Field label="Company domain">
            <Input
              aria-invalid={Boolean(form.formState.errors.company_domain)}
              {...form.register("company_domain")}
            />
          </Field>
          <Field label="Workspace timezone">
            <Input
              aria-invalid={Boolean(form.formState.errors.timezone)}
              {...form.register("timezone")}
            />
          </Field>
          <Field label="Default currency">
            <Input
              maxLength={3}
              aria-invalid={Boolean(form.formState.errors.currency)}
              {...form.register("currency")}
            />
          </Field>
          <Field label="Week starts">
            <Select
              aria-invalid={Boolean(form.formState.errors.week_start)}
              {...form.register("week_start")}
            >
              <option value="monday">Monday</option>
              <option value="sunday">Sunday</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field
              label="Allowed email domains"
              hint="Comma-separated; enforced when provisioning members."
            >
              <Input
                aria-invalid={Boolean(form.formState.errors.allowed_email_domains)}
                {...form.register("allowed_email_domains")}
              />
            </Field>
          </div>
          <Field label="Workspace hourly rate">
            <Input
              type="number"
              min="0"
              step="0.01"
              aria-invalid={Boolean(form.formState.errors.default_rate_major)}
              {...form.register("default_rate_major")}
            />
          </Field>
          <Field label="Lock entries after days" hint="Leave blank to disable locking.">
            <Input
              type="number"
              min="0"
              aria-invalid={Boolean(form.formState.errors.lock_entries_after_days)}
              {...form.register("lock_entries_after_days")}
            />
          </Field>
          <Field label="Report rounding">
            <Select
              aria-invalid={Boolean(form.formState.errors.rounding_increment_minutes)}
              {...form.register("rounding_increment_minutes")}
            >
              <option value="0">No rounding</option>
              <option value="1">1 minute</option>
              <option value="5">5 minutes</option>
              <option value="6">6 minutes</option>
              <option value="10">10 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">60 minutes</option>
            </Select>
          </Field>
          <Field label="Rounding direction">
            <Select
              aria-invalid={Boolean(form.formState.errors.rounding_method)}
              {...form.register("rounding_method")}
            >
              <option value="nearest">Nearest</option>
              <option value="up">Up</option>
              <option value="down">Down</option>
            </Select>
          </Field>
          <fieldset className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:col-span-2">
            <legend className="px-1 text-sm font-semibold">Policies and report defaults</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-invalid={Boolean(form.formState.errors.members_can_set_billable)}
                {...form.register("members_can_set_billable")}
              />
              Members may set billable status
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-invalid={Boolean(form.formState.errors.report_show_descriptions)}
                {...form.register("report_show_descriptions")}
              />
              Include descriptions by default
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-invalid={Boolean(form.formState.errors.report_show_tags)}
                {...form.register("report_show_tags")}
              />
              Include tags by default
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-invalid={Boolean(form.formState.errors.report_show_members)}
                {...form.register("report_show_members")}
              />
              Include member names by default
            </label>
          </fieldset>
          {mutation.error ? (
            <p role="alert" className="text-sm text-red-300 sm:col-span-2">
              {mutation.error.message}
            </p>
          ) : null}
          {mutation.isSuccess ? (
            <p role="status" className="text-sm text-[#fbbf24] sm:col-span-2">
              Workspace settings saved.
            </p>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={mutation.isPending}>
              <Save size={15} /> {mutation.isPending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </fieldset>
      </form>
      <aside className="panel h-fit p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-[#fbbf24]" />
          <h2 className="font-bold">Cloudflare Access</h2>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          Production authentication is configured outside this screen and fails closed.
        </p>
        <dl className="mt-4 grid gap-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Status</dt>
            <dd>
              <Badge color={access?.configured ? "#15803D" : "#B45309"}>
                {access?.configured ? "Configured" : "Placeholder"}
              </Badge>
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Team domain</dt>
            <dd className="truncate font-medium">{access?.team_domain ?? "Not set"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Audience</dt>
            <dd className="font-medium">{access?.audience ?? "Not set"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-slate-500">Bootstrap variable</dt>
            <dd className="font-medium">
              {access?.bootstrap_admins_configured ? "Present" : "Removed"}
            </dd>
          </div>
        </dl>
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          Remove or restrict the bootstrap administrator variable after the first administrator has
          successfully signed in.
        </p>
      </aside>
    </div>
  );
}

export function TagSettings() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [editing, setEditing] = useState<Tag | "new" | null>(null);
  const tags = useQuery({
    queryKey: ["tags", status],
    queryFn: () => apiRequest<{ tags: Tag[] }>(`/tags?status=${status}`),
  });
  const statusMutation = useMutation({
    mutationFn: ({ tag, action }: { tag: Tag; action: "archive" | "reactivate" }) =>
      apiRequest(`/tags/${tag.id}/${action}`, { method: "POST", body: "{}" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });
  return (
    <>
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div>
            <h2 className="font-bold">Tags</h2>
            <p className="text-sm text-slate-500">
              Reusable labels remain attached to historical entries.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select
              className="w-32"
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </Select>
            <Button onClick={() => setEditing("new")}>
              <Plus size={15} /> New tag
            </Button>
          </div>
        </div>
        {statusMutation.isPending ? (
          <p role="status" className="p-4 text-sm text-slate-500">
            Updating tag status…
          </p>
        ) : null}
        {statusMutation.error ? (
          <p role="alert" className="p-4 text-sm text-red-300">
            {statusMutation.error.message}
          </p>
        ) : null}
        {tags.isPending ? (
          <Loading label="Loading tags…" />
        ) : tags.error ? (
          <ErrorState message={tags.error.message} onRetry={() => void tags.refetch()} />
        ) : tags.data.tags.length === 0 ? (
          <EmptyState title="No tags found" description="Create a tag to classify time entries." />
        ) : (
          <div className="divide-y divide-slate-100">
            {tags.data.tags.map((tag) => (
              <div
                key={tag.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <button
                  className="flex min-w-0 flex-wrap items-center gap-3 text-left break-words"
                  onClick={() => setEditing(tag)}
                >
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
                  <span className="font-medium">{tag.name}</span>
                  <Badge>{tag.status}</Badge>
                </button>
                {tag.status === "active" ? (
                  <Button
                    variant="ghost"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ tag, action: "archive" })}
                  >
                    <Archive size={14} /> Archive
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ tag, action: "reactivate" })}
                  >
                    <RotateCcw size={14} /> Reactivate
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <TagEditor
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        open={editing !== null}
        tag={editing === "new" ? null : editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </>
  );
}

function TagEditor({
  open,
  tag,
  onOpenChange,
}: {
  open: boolean;
  tag: Tag | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const formId = useId();
  const nameErrorId = useId();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [color, setColor] = useState("#14852B");
  useEffect(() => {
    setName(tag?.name ?? "");
    setNameError(null);
    setColor(tag?.color ?? "#14852B");
  }, [open, tag]);
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest(tag ? `/tags/${tag.id}` : "/tags", {
        method: tag ? "PATCH" : "POST",
        body: JSON.stringify({
          name: name.trim(),
          color,
          ...(tag ? { version: tag.version } : {}),
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      onOpenChange(false);
    },
  });
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) onOpenChange(next);
      }}
      title={tag ? "Edit tag" : "New tag"}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={mutation.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save tag"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="grid gap-4 sm:grid-cols-[1fr_100px]"
        onSubmit={(event) => {
          event.preventDefault();
          if (mutation.isPending) return;
          if (!name.trim()) {
            setNameError("Enter a tag name.");
            return;
          }
          setNameError(null);
          mutation.mutate();
        }}
      >
        <button type="submit" hidden />
        <fieldset disabled={mutation.isPending} className="contents">
          <div>
            <Field label="Tag name">
              <Input
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? nameErrorId : undefined}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            {nameError ? (
              <span id={nameErrorId} role="alert" className="text-xs text-red-300">
                {nameError}
              </span>
            ) : null}
          </div>
          <Field label="Color">
            <Input
              type="color"
              className="p-1"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </Field>
          {mutation.error ? (
            <p role="alert" className="text-sm text-red-300 sm:col-span-2">
              {mutation.error.message}
            </p>
          ) : null}
        </fieldset>
      </form>
    </Modal>
  );
}

function AuditLog() {
  const audit = useInfiniteQuery({
    queryKey: ["audit-log"],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      apiRequest<{ events: AuditEvent[]; next_before: number | null }>(
        `/audit-log?limit=200${pageParam === null ? "" : `&before=${pageParam}`}`,
      ),
    getNextPageParam: (page) => page.next_before ?? undefined,
  });
  const events = audit.data?.pages.flatMap((page) => page.events) ?? [];
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 p-4">
        <h2 className="font-bold">Immutable audit history</h2>
        <p className="text-sm text-slate-500">
          Administrative changes and team time corrections include actor and request identifiers.
        </p>
      </div>
      {audit.isPending ? (
        <Loading label="Loading audit history…" />
      ) : audit.error && events.length === 0 ? (
        <ErrorState message={audit.error.message} onRetry={() => void audit.refetch()} />
      ) : events.length === 0 ? (
        <EmptyState
          title="No audit events yet"
          description="Security-sensitive changes will appear here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Request</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(event.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{event.actor_name}</div>
                    <div className="text-xs text-slate-400">{event.actor_email}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{event.action}</td>
                  <td className="px-4 py-3">
                    {event.entity_type}
                    {event.entity_id ? (
                      <div className="max-w-36 truncate font-mono text-xs text-slate-400">
                        {event.entity_id}
                      </div>
                    ) : null}
                  </td>
                  <td className="max-w-64 px-4 py-3 text-slate-500">{event.reason ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {event.request_id.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {audit.isFetchNextPageError ? (
        <p role="alert" className="p-4 text-sm text-red-300">
          {audit.error.message}
        </p>
      ) : null}
      {audit.hasNextPage ? (
        <div className="p-4">
          <Button
            variant="secondary"
            disabled={audit.isFetchingNextPage}
            onClick={() => void audit.fetchNextPage()}
          >
            {audit.isFetchingNextPage ? "Loading…" : "Load older events"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
