import { zodResolver } from "@hookform/resolvers/zod";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { twMerge } from "tailwind-merge";

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
  PageHeader,
  Switch,
  useToast,
} from "@/web/components/ui";
import { FormErrors } from "@/web/components/form-errors";
import { FormSelect } from "@/web/components/form-select";
import { InfoBox } from "@/web/features/management/info-box";
import { apiRequest } from "@/web/lib/api";

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

type Tab = "workspace" | "audit";

export function AdministrationPage() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>("workspace");
  if (!me.permissions.manage_members)
    return <ErrorState message="Only administrators can access workspace administration." />;
  return (
    <>
      <PageHeader
        title="Settings"
        description="Workspace policies, security posture, and immutable audit history."
      >
        <nav className="-ml-1 flex" aria-label="Settings sections">
          {(
            [
              ["workspace", "General"],
              ["audit", "Audit Log"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-current={tab === value ? "page" : undefined}
              className={twMerge(
                "text-fg-subtle inline-flex h-[30px] items-center justify-center rounded-lg px-3 py-1.5 text-sm leading-5 font-semibold",
                tab !== value && "hover:text-fg",
              )}
              onClick={() => setTab(value)}
            >
              <span
                className={twMerge(
                  // Toggl underlines only the label (2px) and leaves 6px of button padding.
                  "border-b-2 [border-style:none_none_solid_none] [border-bottom-color:transparent] text-left",
                  tab === value && "text-accent-fg [border-bottom-color:var(--color-accent-fg)]",
                )}
              >
                {label}
              </span>
            </button>
          ))}
        </nav>
      </PageHeader>
      <div className="p-5">
        {tab === "workspace" ? <WorkspaceSettings /> : null}
        {tab === "audit" ? <AuditLog /> : null}
      </div>
    </>
  );
}

function WorkspaceSettings() {
  const queryClient = useQueryClient();
  const toast = useToast();
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
      toast({ title: "Success", message: "Workspace settings saved." });
    },
  });
  const access = settings.data?.settings.access;
  if (settings.isPending) return <Loading label="Loading workspace settings…" />;
  if (settings.error)
    return <ErrorState message={settings.error.message} onRetry={() => void settings.refetch()} />;

  const fieldWidth = "w-full max-w-[270px]";
  const inputClass = "h-[37px]";
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[1fr_340px]">
      <form
        noValidate
        className="grid gap-5"
        onSubmit={form.handleSubmit((value) => mutation.mutate(value))}
      >
        <fieldset disabled={mutation.isPending} className="contents">
          <FormErrors errors={form.formState.errors} />
          <SettingsCard
            title="Company workspace"
            description="These defaults drive entry behavior, report calculations, and exports."
          >
            <div className="grid gap-x-5 gap-y-5 sm:grid-cols-[repeat(2,minmax(0,270px))]">
              <div className={fieldWidth}>
                <Field label="Application name">
                  <Input
                    className={inputClass}
                    aria-invalid={Boolean(form.formState.errors.app_name)}
                    {...form.register("app_name")}
                  />
                </Field>
              </div>
              <div className={fieldWidth}>
                <Field label="Company name">
                  <Input
                    className={inputClass}
                    aria-invalid={Boolean(form.formState.errors.company_name)}
                    {...form.register("company_name")}
                  />
                </Field>
              </div>
              <div className={fieldWidth}>
                <Field label="Company domain">
                  <Input
                    className={inputClass}
                    aria-invalid={Boolean(form.formState.errors.company_domain)}
                    {...form.register("company_domain")}
                  />
                </Field>
              </div>
              <div className={fieldWidth}>
                <Field label="Workspace timezone">
                  <Input
                    className={inputClass}
                    aria-invalid={Boolean(form.formState.errors.timezone)}
                    {...form.register("timezone")}
                  />
                </Field>
              </div>
              <div className={fieldWidth}>
                <Field label="Default currency">
                  <Input
                    className={inputClass}
                    maxLength={3}
                    aria-invalid={Boolean(form.formState.errors.currency)}
                    {...form.register("currency")}
                  />
                </Field>
              </div>
              <div className={fieldWidth}>
                <Field label="Week starts">
                  <FormSelect
                    control={form.control}
                    name="week_start"
                    options={[
                      { value: "monday", label: "Monday" },
                      { value: "sunday", label: "Sunday" },
                    ]}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2 sm:max-w-[560px]">
                <Field
                  label="Allowed email domains"
                  hint="Comma-separated; enforced when provisioning members."
                >
                  <Input
                    className={inputClass}
                    aria-invalid={Boolean(form.formState.errors.allowed_email_domains)}
                    {...form.register("allowed_email_domains")}
                  />
                </Field>
              </div>
            </div>
          </SettingsCard>
          <SettingsCard
            title="Rates, locking and rounding"
            description="Defaults for billing, for locking old entries and for how reports total time."
          >
            <div className="grid gap-x-5 gap-y-5 sm:grid-cols-[repeat(2,minmax(0,270px))]">
              <div className={fieldWidth}>
                <Field label="Workspace hourly rate">
                  <Input
                    className={inputClass}
                    type="number"
                    min="0"
                    step="0.01"
                    aria-invalid={Boolean(form.formState.errors.default_rate_major)}
                    {...form.register("default_rate_major")}
                  />
                </Field>
              </div>
              <div className={fieldWidth}>
                <Field label="Lock entries after days" hint="Leave blank to disable locking.">
                  <Input
                    className={inputClass}
                    type="number"
                    min="0"
                    aria-invalid={Boolean(form.formState.errors.lock_entries_after_days)}
                    {...form.register("lock_entries_after_days")}
                  />
                </Field>
              </div>
              <div className={fieldWidth}>
                <Field label="Report rounding">
                  <FormSelect
                    control={form.control}
                    name="rounding_increment_minutes"
                    options={[
                      { value: "0", label: "No rounding" },
                      { value: "1", label: "1 minute" },
                      ...["5", "6", "10", "15", "30", "60"].map((value) => ({
                        value,
                        label: `${value} minutes`,
                      })),
                    ]}
                  />
                </Field>
              </div>
              <div className={fieldWidth}>
                <Field label="Rounding direction">
                  <FormSelect
                    control={form.control}
                    name="rounding_method"
                    options={[
                      { value: "nearest", label: "Nearest" },
                      { value: "up", label: "Up" },
                      { value: "down", label: "Down" },
                    ]}
                  />
                </Field>
              </div>
            </div>
          </SettingsCard>
          <SettingsCard
            title="Policies and report defaults"
            description="What members may change and what reports include unless a filter says otherwise."
          >
            <div className="grid gap-5">
              {(
                [
                  [
                    "members_can_set_billable",
                    "Members may set billable status",
                    "Let members change the billable flag on their own time entries.",
                  ],
                  [
                    "report_show_descriptions",
                    "Include descriptions by default",
                    "Show entry descriptions in report tables and exports.",
                  ],
                  [
                    "report_show_tags",
                    "Include tags by default",
                    "Show entry tags in report tables and exports.",
                  ],
                  [
                    "report_show_members",
                    "Include member names by default",
                    "Show who tracked each entry in report tables and exports.",
                  ],
                ] as const
              ).map(([name, title, description]) => (
                <Controller
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <SettingToggle
                      title={title}
                      description={description}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  )}
                />
              ))}
            </div>
          </SettingsCard>
          {mutation.error ? (
            <p role="alert" className="text-error-fg text-sm font-medium">
              {mutation.error.message}
            </p>
          ) : null}
          <div>
            {/* Toggl autosaves each control; Hourlark validates the whole form, so it keeps Save. */}
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </fieldset>
      </form>
      <aside className="grid gap-5">
        <SettingsCard
          title="Cloudflare Access"
          description="Production authentication is configured outside this screen and fails closed."
          icon={<ShieldCheck size={16} className="text-accent-fg" aria-hidden="true" />}
        >
          <dl className="grid gap-3 text-sm font-medium">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-fg-subtle">Status</dt>
              <dd>
                <Badge color={access?.configured ? "#15803D" : "#B45309"}>
                  {access?.configured ? "Configured" : "Placeholder"}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-subtle">Team domain</dt>
              <dd className="truncate">{access?.team_domain ?? "Not set"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-subtle">Audience</dt>
              <dd>{access?.audience ?? "Not set"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-subtle">Bootstrap variable</dt>
              <dd>{access?.bootstrap_admins_configured ? "Present" : "Removed"}</dd>
            </div>
          </dl>
          <InfoBox icon={TriangleAlert} className="mt-5">
            Remove or restrict the bootstrap administrator variable after the first administrator
            has successfully signed in.
          </InfoBox>
        </SettingsCard>
      </aside>
    </div>
  );
}

/** Toggl settings section: #1b1b1b card with a 1px #3a3a3a ring, radius 8 and a ruled header. */
function SettingsCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-surface rounded-lg px-5 shadow-[0_0_0_1px_var(--color-stroke)]">
      <header className="border-stroke border-b py-[18px]">
        <h2 className="text-fg flex items-center gap-2 text-sm leading-[22.96px] font-semibold">
          {icon}
          {title}
        </h2>
        {description ? (
          <p className="text-fg-subtle text-sm leading-[21.98px] font-medium">{description}</p>
        ) : null}
      </header>
      <div className="py-5">{children}</div>
    </section>
  );
}

/** Switch with Toggl's bold title and grey description beside it. */
function SettingToggle({
  title,
  description,
  checked,
  onCheckedChange,
  onBlur,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onBlur: () => void;
}) {
  const id = useId();
  return (
    <div className="flex gap-[11px]">
      <Switch
        className="mt-[3.5px]"
        checked={checked}
        onCheckedChange={onCheckedChange}
        onBlur={onBlur}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
      />
      <div className="min-w-0">
        <p id={`${id}-title`} className="text-fg text-sm leading-[22.96px] font-semibold">
          {title}
        </p>
        <p
          id={`${id}-description`}
          className="text-fg-subtle text-sm leading-[21.98px] font-medium"
        >
          {description}
        </p>
      </div>
    </div>
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
    <section className="bg-surface overflow-hidden rounded-lg shadow-[0_0_0_1px_var(--color-stroke)]">
      <div className="border-stroke border-b px-5 py-[18px]">
        <h2 className="text-fg text-sm leading-[22.96px] font-semibold">Immutable audit history</h2>
        <p className="text-fg-subtle text-sm leading-[21.98px] font-medium">
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
          <table className="data-table min-w-[850px]">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Reason</th>
                <th>Request</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="text-fg-subtle whitespace-nowrap">
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(event.created_at)}
                  </td>
                  <td>
                    <div className="font-medium">{event.actor_name}</div>
                    <div className="text-fg-muted text-xs">{event.actor_email}</div>
                  </td>
                  <td className="font-mono text-xs">{event.action}</td>
                  <td>
                    {event.entity_type}
                    {event.entity_id ? (
                      <div className="text-fg-muted max-w-36 truncate font-mono text-xs">
                        {event.entity_id}
                      </div>
                    ) : null}
                  </td>
                  <td className="text-fg-subtle max-w-64">{event.reason ?? "—"}</td>
                  <td className="text-fg-muted font-mono text-xs">
                    {event.request_id.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {audit.isFetchNextPageError ? (
        <p role="alert" className="text-error-fg p-4 text-sm">
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
