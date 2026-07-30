import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, History, Plus, RotateCcw, Save, ShieldCheck, Tags } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { majorToMinor, minorToMajor } from "@/domain/billing/money";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
} from "@/web/components/ui";
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
  app_name: z.string().min(1),
  company_name: z.string().min(1),
  company_domain: z.string().min(1),
  timezone: z.string().min(1),
  currency: z.string().length(3),
  week_start: z.enum(["monday", "sunday"]),
  allowed_email_domains: z.string().min(1),
  default_rate_major: z.string(),
  members_can_set_billable: z.boolean(),
  lock_entries_after_days: z.string(),
  rounding_increment_minutes: z.enum(["0", "1", "5", "6", "10", "15", "30", "60"]),
  rounding_method: z.enum(["nearest", "up", "down"]),
  report_show_descriptions: z.boolean(),
  report_show_tags: z.boolean(),
  report_show_members: z.boolean(),
});
type SettingsForm = z.infer<typeof settingsSchema>;

type Tab = "workspace" | "tags" | "audit";

export function AdministrationPage() {
  const [tab, setTab] = useState<Tab>("workspace");
  return (
    <>
      <PageHeader
        title="Administration"
        description="Workspace policies, tags, security posture, and immutable audit history."
      />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
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

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <form
        className="panel grid gap-4 p-5 sm:grid-cols-2"
        onSubmit={form.handleSubmit((value) => mutation.mutate(value))}
      >
        <div className="sm:col-span-2">
          <h2 className="font-bold text-slate-900">Company workspace</h2>
          <p className="mt-1 text-sm text-slate-500">
            These defaults drive entry behavior, report calculations, and exports.
          </p>
        </div>
        <Field label="Application name">
          <Input {...form.register("app_name")} />
        </Field>
        <Field label="Company name">
          <Input {...form.register("company_name")} />
        </Field>
        <Field label="Company domain">
          <Input {...form.register("company_domain")} />
        </Field>
        <Field label="Workspace timezone">
          <Input {...form.register("timezone")} />
        </Field>
        <Field label="Default currency">
          <Input maxLength={3} {...form.register("currency")} />
        </Field>
        <Field label="Week starts">
          <Select {...form.register("week_start")}>
            <option value="monday">Monday</option>
            <option value="sunday">Sunday</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field
            label="Allowed email domains"
            hint="Comma-separated; enforced when provisioning members."
          >
            <Input {...form.register("allowed_email_domains")} />
          </Field>
        </div>
        <Field label="Workspace hourly rate">
          <Input type="number" min="0" step="0.01" {...form.register("default_rate_major")} />
        </Field>
        <Field label="Lock entries after days" hint="Leave blank to disable locking.">
          <Input type="number" min="0" {...form.register("lock_entries_after_days")} />
        </Field>
        <Field label="Report rounding">
          <Select {...form.register("rounding_increment_minutes")}>
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
          <Select {...form.register("rounding_method")}>
            <option value="nearest">Nearest</option>
            <option value="up">Up</option>
            <option value="down">Down</option>
          </Select>
        </Field>
        <fieldset className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:col-span-2">
          <legend className="px-1 text-sm font-semibold">Policies and report defaults</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("members_can_set_billable")} />
            Members may set billable status
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("report_show_descriptions")} />
            Include descriptions by default
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("report_show_tags")} />
            Include tags by default
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register("report_show_members")} />
            Include member names by default
          </label>
        </fieldset>
        {mutation.error ? (
          <p className="text-sm text-red-600 sm:col-span-2">{mutation.error.message}</p>
        ) : null}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={mutation.isPending}>
            <Save size={15} /> Save settings
          </Button>
        </div>
      </form>
      <aside className="panel h-fit p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-frosted-mint-700" />
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

function TagSettings() {
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
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["tags"] }),
  });
  return (
    <>
      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div>
            <h2 className="font-bold">Tags</h2>
            <p className="text-sm text-slate-500">
              Reusable labels remain attached to historical entries.
            </p>
          </div>
          <div className="flex gap-2">
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
        {(tags.data?.tags ?? []).length === 0 ? (
          <EmptyState title="No tags found" description="Create a tag to classify time entries." />
        ) : (
          <div className="divide-y divide-slate-100">
            {(tags.data?.tags ?? []).map((tag) => (
              <div key={tag.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <button className="flex items-center gap-3" onClick={() => setEditing(tag)}>
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
                  <span className="font-medium">{tag.name}</span>
                  <Badge>{tag.status}</Badge>
                </button>
                {tag.status === "active" ? (
                  <Button
                    variant="ghost"
                    onClick={() => statusMutation.mutate({ tag, action: "archive" })}
                  >
                    <Archive size={14} /> Archive
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
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
  const [name, setName] = useState("");
  const [color, setColor] = useState("#14852B");
  useEffect(() => {
    setName(tag?.name ?? "");
    setColor(tag?.color ?? "#14852B");
  }, [open, tag]);
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest(tag ? `/tags/${tag.id}` : "/tags", {
        method: tag ? "PATCH" : "POST",
        body: JSON.stringify({ name, color, ...(tag ? { version: tag.version } : {}) }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tags"] });
      onOpenChange(false);
    },
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={tag ? "Edit tag" : "New tag"}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!name.trim()} onClick={() => mutation.mutate()}>
            Save tag
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_100px]">
        <Field label="Tag name">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Color">
          <Input
            type="color"
            className="p-1"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </Field>
        {mutation.error ? (
          <p className="text-sm text-red-600 sm:col-span-2">{mutation.error.message}</p>
        ) : null}
      </div>
    </Modal>
  );
}

function AuditLog() {
  const audit = useQuery({
    queryKey: ["audit-log"],
    queryFn: () =>
      apiRequest<{ events: AuditEvent[]; next_before: number | null }>("/audit-log?limit=200"),
  });
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 p-4">
        <h2 className="font-bold">Immutable audit history</h2>
        <p className="text-sm text-slate-500">
          Administrative changes and team time corrections include actor and request identifiers.
        </p>
      </div>
      {(audit.data?.events ?? []).length === 0 ? (
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
              {(audit.data?.events ?? []).map((event) => (
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
    </section>
  );
}
