import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, KeyRound, ListFilter, Plus, Timer, UserRoundCheck, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useMe } from "@/web/app/context";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Loading,
  Field,
  Input,
  Modal,
  RowMenu,
  type RowMenuItem,
  SearchInput,
  Select,
  SortHeader,
  useToast,
} from "@/web/components/ui";
import { FormErrors } from "@/web/components/form-errors";
import { FormSelect } from "@/web/components/form-select";
import { InfoBox } from "@/web/features/management/info-box";
import {
  DEFAULT_MEMBER_STATUSES,
  MemberStatusFilter,
  type MemberStatus,
} from "@/web/features/members/status-filter";
import { apiRequest } from "@/web/lib/api";
import { formatDuration } from "@/web/lib/format";
import { timeZoneOptions } from "@/web/lib/time-zones";
import type { Member, Project } from "@/web/types";

const memberSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  display_name: z.string().trim().min(1, "This field is required."),
  role: z.enum(["member", "manager", "admin"]),
  timezone: z.string().trim().min(1, "This field is required."),
  weekly_target_hours: z
    .string()
    .refine(
      (value) => !value || (Number.isFinite(Number(value)) && Number(value) >= 0),
      "Enter a non-negative number.",
    ),
  project_ids: z.array(z.string()),
});
type MemberForm = z.infer<typeof memberSchema>;

export function MembersPage() {
  const me = useMe();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const members = useQuery({
    queryKey: ["members"],
    queryFn: () => apiRequest<{ members: Member[] }>("/members"),
    enabled: me.permissions.view_team,
  });
  const [statuses, setStatuses] = useState<MemberStatus[]>([...DEFAULT_MEMBER_STATUSES]);
  const [role, setRole] = useState("");
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const filtered = (members.data?.members ?? [])
    .filter(
      (member) =>
        (statuses.length === 0 || statuses.includes(member.status)) &&
        (!role || member.role === role) &&
        `${member.display_name} ${member.email}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((left, right) =>
      sort === "asc"
        ? left.display_name.localeCompare(right.display_name)
        : right.display_name.localeCompare(left.display_name),
    );

  const statusMutation = useMutation({
    mutationFn: ({ member, status }: { member: Member; status: "active" | "inactive" }) =>
      apiRequest(`/members/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ version: member.version, status }),
      }),
    onSuccess: async (_, { member, status }) => {
      await queryClient.invalidateQueries();
      toast({
        title: "Success",
        message: `${member.display_name} ${status === "inactive" ? "deactivated" : "reactivated"}`,
      });
    },
    onError: (error) => toast({ title: "Error", message: error.message }),
  });
  const setStatus = (member: Member, status: "active" | "inactive") => {
    if (
      status === "inactive" &&
      !window.confirm(`Deactivate ${member.email}? Any running timer will be stopped.`)
    )
      return;
    statusMutation.mutate({ member, status });
  };
  const rowActions = (member: Member): RowMenuItem[] => {
    const items: RowMenuItem[] = [{ label: "Edit", onSelect: () => setEditing(member) }];
    // Admins change account status; nobody deactivates their own account from here.
    if (!me.permissions.manage_members || member.id === me.member.id) return items;
    items.push(
      member.status === "inactive"
        ? {
            label: "Reactivate",
            disabled: statusMutation.isPending,
            onSelect: () => setStatus(member, "active"),
          }
        : {
            label: "Deactivate",
            danger: true,
            disabled: statusMutation.isPending,
            onSelect: () => setStatus(member, "inactive"),
          },
    );
    return items;
  };

  if (!me.permissions.view_team)
    return <ErrorState message="You do not have permission to view members." />;

  const addMember = me.permissions.manage_members ? (
    <Button
      icon={<Plus size={20} />}
      className="leading-[normal]"
      onClick={() => setEditing("new")}
    >
      Add member
    </Button>
  ) : undefined;

  return (
    <>
      {/* Toggl's organization team header is 50px (the shared PageHeader is 66). */}
      <header className="page-header page-header--compact">
        <div className="flex min-w-0 items-center gap-6">
          <h1 className="text-fg shrink-0 text-base leading-[20.8px] font-semibold">Members</h1>
          <p className="sr-only">
            Directory, project access, weekly progress, and current timer status.
          </p>
        </div>
        {addMember ? <div className="flex shrink-0 flex-wrap gap-2">{addMember}</div> : null}
      </header>
      {/* 50px toolbar around Toggl's 38px status dropdown, 34px access chip and 36px search. */}
      <div className="page-toolbar !gap-2 !py-1.5">
        <MemberStatusFilter selected={statuses} onChange={setStatuses} />
        <span className="text-fg mr-2 text-[11px] leading-[11px] font-semibold tracking-[0.4px] whitespace-nowrap uppercase">
          Filters:
        </span>
        <Select
          className="border-stroke-tertiary hover:bg-surface-hover !h-[34px] !w-[110px] bg-transparent !px-2 leading-[14px] [&>svg:last-child]:hidden"
          aria-label="Filter members by access"
          icon={<ListFilter size={18} />}
          value={role}
          onValueChange={setRole}
          options={[
            { value: "", label: "Access" },
            { value: "admin", label: "Admin" },
            { value: "manager", label: "Manager" },
            { value: "member", label: "Member" },
          ]}
        />
        <button
          type="button"
          className="text-fg-secondary hover:bg-surface-hover inline-flex size-9 items-center justify-center gap-2 rounded-lg border border-transparent font-semibold"
          aria-label="Clear filters"
          onClick={() => {
            setRole("");
            setStatuses([...DEFAULT_MEMBER_STATUSES]);
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
        <SearchInput
          className="ml-auto w-[320px] max-w-[320px]"
          label="Search members"
          value={search}
          onChange={setSearch}
        />
      </div>
      {members.isPending ? (
        <Loading label="Loading members…" />
      ) : members.error ? (
        <ErrorState message={members.error.message} onRetry={() => void members.refetch()} />
      ) : filtered.length === 0 ? (
        <div className="pt-24">
          <EmptyState
            title="Nothing to see here..."
            description="Try different filters or keywords to find the members you are looking for."
            action={
              me.permissions.manage_members ? (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    setEditing("new");
                  }}
                >
                  <Plus size={14} aria-hidden="true" /> Add member
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="data-table data-table-static min-w-[850px]">
            <thead>
              <tr>
                <th scope="col">
                  {/* Toggl aligns the NAME label with the member names, past the avatar. */}
                  <div className="pl-9">
                    <SortHeader
                      label="Name"
                      direction={sort}
                      onToggle={() => setSort((value) => (value === "asc" ? "desc" : "asc"))}
                    />
                  </div>
                </th>
                <th scope="col">
                  <span className="inline-flex items-center gap-1">
                    Access rights
                    <span title="Access rights decide what a member can see and change.">
                      <Info size={16} className="text-fg-muted" aria-hidden="true" />
                    </span>
                  </span>
                </th>
                <th scope="col">This week</th>
                <th scope="col">Timer</th>
                <th scope="col">Last seen</th>
                <th scope="col" className="w-16">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((member) => (
                <tr
                  key={member.id}
                  className={member.status === "inactive" ? "opacity-60" : undefined}
                >
                  <td>
                    <div className="flex items-center gap-2.5">
                      <span
                        className="bg-accent-muted text-accent-fg grid size-[26px] shrink-0 place-items-center rounded-full text-xs font-bold"
                        aria-hidden="true"
                      >
                        {initials(member.display_name)}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium">{member.display_name}</span>
                          {member.status === "inactive" ? <Badge>Inactive</Badge> : null}
                          {member.status === "pending" ? <Badge>Invited</Badge> : null}
                        </span>
                        <span className="text-fg-muted block truncate text-xs font-normal">
                          {member.email}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="text-fg pl-3 font-normal capitalize">{member.role}</td>
                  <td className="font-medium tabular-nums">
                    {formatDuration(member.week_tracked_ms)}
                    {member.weekly_target_minutes ? (
                      <span className="text-fg-muted ml-1 text-xs">
                        / {formatDuration(member.weekly_target_minutes * 60_000)}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {member.running_entry_id ? (
                      <Badge color="#4E7C1D">
                        <Timer size={11} /> Running
                      </Badge>
                    ) : (
                      <span className="text-fg-muted">Stopped</span>
                    )}
                  </td>
                  <td className="text-fg-muted">
                    {member.last_seen_at
                      ? new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(member.last_seen_at)
                      : "Never"}
                  </td>
                  <td className="!pr-[5px] text-right">
                    <div className="flex justify-end">
                      <RowMenu
                        label={`Actions for ${member.display_name}`}
                        menuClassName="w-[216px]"
                        items={rowActions(member)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <MemberEditor
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        open={editing !== null}
        member={editing === "new" ? null : editing}
        canManageIdentity={me.permissions.manage_members}
        onBindingReset={() =>
          toast({
            title: "Success",
            message: "Account unlinked. The member's next sign-in links their new account.",
          })
        }
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </>
  );
}

function MemberEditor({
  open,
  member,
  canManageIdentity,
  onBindingReset,
  onOpenChange,
}: {
  open: boolean;
  member: Member | null;
  canManageIdentity: boolean;
  onBindingReset: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const projects = useQuery({
    queryKey: ["projects", "active"],
    queryFn: () => apiRequest<{ projects: Project[] }>("/projects?status=active"),
    enabled: open,
  });
  const form = useForm<MemberForm>({
    resolver: zodResolver(memberSchema),
    defaultValues: {
      email: "",
      display_name: "",
      role: "member",
      timezone: me.workspace.timezone,
      weekly_target_hours: "",
      project_ids: [],
    },
  });
  useEffect(() => {
    form.reset({
      email: member?.email ?? "",
      display_name: member?.display_name ?? "",
      role: member?.role ?? "member",
      timezone: member?.timezone ?? me.workspace.timezone,
      weekly_target_hours: member?.weekly_target_minutes
        ? String(member.weekly_target_minutes / 60)
        : "",
      project_ids: member?.project_ids_json
        ? (JSON.parse(member.project_ids_json) as string[])
        : [],
    });
    setConfirmReset(false);
  }, [form, me.workspace.timezone, member, open]);
  const mutation = useMutation({
    mutationFn: (values: MemberForm) => {
      const base = {
        display_name: values.display_name,
        role: values.role,
        timezone: values.timezone,
        weekly_target_minutes: values.weekly_target_hours
          ? Math.round(Number(values.weekly_target_hours) * 60)
          : null,
      };
      return apiRequest(member ? `/members/${member.id}` : "/members", {
        method: member ? "PATCH" : "POST",
        body: JSON.stringify(
          member
            ? {
                version: member.version,
                ...(canManageIdentity ? base : {}),
                project_ids: values.project_ids,
              }
            : { ...base, email: values.email },
        ),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast({
        title: "Success",
        message: member ? "Member updated successfully" : "Member added successfully",
      });
      onOpenChange(false);
    },
  });
  const resetMutation = useMutation({
    mutationFn: () => {
      if (!member) throw new Error("A member is required.");
      return apiRequest(`/members/${member.id}/reset-access-binding`, {
        method: "POST",
        body: JSON.stringify({ confirm_email: member.email }),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      setConfirmReset(false);
      onBindingReset();
      onOpenChange(false);
    },
  });

  const formId = useId();
  const busy = mutation.isPending || resetMutation.isPending;
  const submit = form.handleSubmit((values) => !mutation.isPending && mutation.mutate(values));
  return (
    <Modal
      // Toggl's invite dialog is a 360px single column opened 100px from the top; editing keeps a
      // wider two-column form for the extra fields. Toggl titles the invite 16/600.
      size={member ? "md" : "sm"}
      titleSize={member ? "sm" : "md"}
      align="top"
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title={member ? "Member details" : "Add member"}
      footer={
        <Button
          type="submit"
          form={formId}
          className="w-full"
          disabled={busy || (Boolean(member) && (projects.isPending || Boolean(projects.error)))}
        >
          {mutation.isPending ? "Saving…" : "Save member"}
        </Button>
      }
      description={
        member ? "Changes are enforced by the API and recorded when security-sensitive." : undefined
      }
    >
      <form
        id={formId}
        noValidate
        className={member ? "grid gap-4 sm:grid-cols-2" : "flex flex-col gap-4"}
        onSubmit={submit}
      >
        <fieldset disabled={busy} className="contents">
          <FormErrors errors={form.formState.errors} />
          {!member ? (
            <InfoBox icon={UserRoundCheck}>
              The account becomes usable when this exact email authenticates through Cloudflare
              Access.
            </InfoBox>
          ) : null}
          <div className="sm:col-span-2">
            <Field label="Company email">
              <Input
                disabled={Boolean(member)}
                type="email"
                aria-invalid={Boolean(form.formState.errors.email)}
                {...form.register("email")}
              />
            </Field>
          </div>
          <Field label="Display name">
            <Input
              disabled={!canManageIdentity && Boolean(member)}
              aria-invalid={Boolean(form.formState.errors.display_name)}
              {...form.register("display_name")}
            />
          </Field>
          <Field label="Role">
            <FormSelect
              control={form.control}
              name="role"
              className="h-9"
              disabled={!canManageIdentity}
              options={[
                { value: "member", label: "Member" },
                { value: "manager", label: "Manager" },
                { value: "admin", label: "Administrator" },
              ]}
            />
          </Field>
          <Field label="Timezone">
            <FormSelect
              control={form.control}
              name="timezone"
              className="h-9"
              disabled={!canManageIdentity && Boolean(member)}
              options={timeZoneOptions(member?.timezone ?? me.workspace.timezone)}
            />
          </Field>
          <Field label="Weekly target hours">
            <Input
              disabled={!canManageIdentity && Boolean(member)}
              type="number"
              min="0"
              step="0.5"
              aria-invalid={Boolean(form.formState.errors.weekly_target_hours)}
              {...form.register("weekly_target_hours")}
            />
          </Field>
          {member ? (
            <>
              {projects.isPending ? (
                <Loading label="Loading projects…" />
              ) : projects.error ? (
                <ErrorState
                  message={projects.error.message}
                  onRetry={() => void projects.refetch()}
                />
              ) : null}
              <fieldset className="border-stroke grid max-h-48 gap-2 overflow-y-auto rounded-lg border p-3 sm:col-span-2">
                <legend className="text-fg-subtle px-1 text-[11px] leading-4 font-semibold tracking-[0.04em] uppercase">
                  Direct project assignments
                </legend>
                {(projects.data?.projects ?? []).map((project) => (
                  <label key={project.id} className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox
                      value={project.id}
                      aria-invalid={Boolean(form.formState.errors.project_ids)}
                      {...form.register("project_ids")}
                    />
                    <span style={{ color: project.color }}>●</span> {project.name}
                    <span className="text-fg-subtle">· {project.client_name}</span>
                  </label>
                ))}
              </fieldset>
            </>
          ) : null}
          {member && canManageIdentity ? (
            <InfoBox icon={KeyRound} className="sm:col-span-2">
              <h3 className="text-fg">Linked sign-in account</h3>
              <p className="mt-1">
                This member is linked to the account they first signed in with. Unlink it only if
                they now sign in with a different account under the same email, for example after it
                was recreated. Their next sign-in links the new account.
              </p>
              {!confirmReset ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-3"
                  onClick={() => setConfirmReset(true)}
                >
                  <KeyRound size={14} aria-hidden="true" /> Unlink account
                </Button>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="danger"
                    disabled={resetMutation.isPending}
                    className="h-auto min-h-9 max-w-full py-1 break-all whitespace-normal"
                    onClick={() => resetMutation.mutate()}
                  >
                    {resetMutation.isPending ? "Unlinking…" : `Unlink ${member.email}`}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setConfirmReset(false)}>
                    Cancel
                  </Button>
                </div>
              )}
            </InfoBox>
          ) : null}
          {mutation.error || resetMutation.error ? (
            <p role="alert" className="text-error-fg text-sm sm:col-span-2">
              {mutation.error?.message ?? resetMutation.error?.message}
            </p>
          ) : null}
        </fieldset>
      </form>
    </Modal>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
