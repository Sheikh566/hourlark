import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, Search, Timer, UserRoundCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useMe } from "@/web/app/context";
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
import { formatDuration } from "@/web/lib/format";
import type { Member, Project } from "@/web/types";

const memberSchema = z.object({
  email: z.string().email(),
  display_name: z.string().min(1),
  role: z.enum(["member", "manager", "admin"]),
  timezone: z.string().min(1),
  weekly_target_hours: z.string(),
  status: z.enum(["active", "inactive"]),
  project_ids: z.array(z.string()),
});
type MemberForm = z.infer<typeof memberSchema>;

export function MembersPage() {
  const me = useMe();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const members = useQuery({
    queryKey: ["members"],
    queryFn: () => apiRequest<{ members: Member[] }>("/members"),
  });
  const filtered = (members.data?.members ?? []).filter((member) =>
    `${member.display_name} ${member.email}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Members"
        description="Directory, project access, weekly progress, and current timer status."
        actions={
          me.permissions.manage_members ? (
            <Button onClick={() => setEditing("new")}>
              <Plus size={16} /> Add member
            </Button>
          ) : undefined
        }
      />
      <section className="panel overflow-hidden">
        <div className="border-b border-slate-200 p-3">
          <div className="relative max-w-lg">
            <Search className="absolute top-3 left-3 text-slate-400" size={15} />
            <Input
              className="pl-9"
              placeholder="Search members"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            title="No members found"
            description="Pre-provision a company email so Cloudflare Access can bind it on first login."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">This week</th>
                  <th className="px-4 py-3">Timer</th>
                  <th className="px-4 py-3">Last seen</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((member) => (
                  <tr key={member.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{member.display_name}</div>
                      <div className="text-xs text-slate-500">{member.email}</div>
                    </td>
                    <td className="px-4 py-3 capitalize">{member.role}</td>
                    <td className="px-4 py-3">
                      <Badge>{member.status}</Badge>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {formatDuration(member.week_tracked_ms)}
                      {member.weekly_target_minutes ? (
                        <span className="ml-1 text-xs text-slate-400">
                          / {formatDuration(member.weekly_target_minutes * 60_000)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {member.running_entry_id ? (
                        <Badge color="#4E7C1D">
                          <Timer size={11} /> Running
                        </Badge>
                      ) : (
                        <span className="text-slate-400">Stopped</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {member.last_seen_at
                        ? new Intl.DateTimeFormat(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(member.last_seen_at)
                        : "Never"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => setEditing(member)}
                      >
                        <Pencil size={15} />
                        <span className="sr-only">Edit {member.display_name}</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <MemberEditor
        open={editing !== null}
        member={editing === "new" ? null : editing}
        canManageIdentity={me.permissions.manage_members}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </>
  );
}

function MemberEditor({
  open,
  member,
  canManageIdentity,
  onOpenChange,
}: {
  open: boolean;
  member: Member | null;
  canManageIdentity: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useMe();
  const queryClient = useQueryClient();
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
      status: "active",
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
      status: member?.status === "inactive" ? "inactive" : "active",
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
                ...(canManageIdentity ? { ...base, status: values.status } : {}),
                project_ids: values.project_ids,
              }
            : { ...base, email: values.email },
        ),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["members"] });
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
      await queryClient.invalidateQueries({ queryKey: ["members"] });
      setConfirmReset(false);
    },
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={member ? "Member details" : "Add member"}
      description={
        member
          ? "Changes are enforced by the API and recorded when security-sensitive."
          : "Cloudflare Access handles login after this email is provisioned."
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void form.handleSubmit((values) => mutation.mutate(values))()}>
            Save member
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => event.preventDefault()}>
        <div className="sm:col-span-2">
          <Field label="Company email">
            <Input disabled={Boolean(member)} type="email" {...form.register("email")} />
          </Field>
        </div>
        <Field label="Display name">
          <Input
            disabled={!canManageIdentity && Boolean(member)}
            {...form.register("display_name")}
          />
        </Field>
        <Field label="Role">
          <Select disabled={!canManageIdentity} {...form.register("role")}>
            <option value="member">Member</option>
            <option value="manager">Manager</option>
            <option value="admin">Administrator</option>
          </Select>
        </Field>
        <Field label="Timezone">
          <Input disabled={!canManageIdentity && Boolean(member)} {...form.register("timezone")} />
        </Field>
        <Field label="Weekly target hours">
          <Input
            disabled={!canManageIdentity && Boolean(member)}
            type="number"
            min="0"
            step="0.5"
            {...form.register("weekly_target_hours")}
          />
        </Field>
        {member && canManageIdentity ? (
          <Field label="Account status">
            <Select {...form.register("status")}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        ) : null}
        <fieldset className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border border-slate-200 p-3 sm:col-span-2">
          <legend className="px-1 text-sm font-semibold">Direct project assignments</legend>
          {(projects.data?.projects ?? []).map((project) => (
            <label key={project.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" value={project.id} {...form.register("project_ids")} />
              <span style={{ color: project.color }}>●</span> {project.name}
              <span className="text-slate-400">· {project.client_name}</span>
            </label>
          ))}
        </fieldset>
        {member && canManageIdentity ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 sm:col-span-2">
            <div className="flex items-start gap-2">
              <KeyRound className="mt-0.5 text-amber-700" size={17} />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-amber-900">Cloudflare Access binding</h3>
                <p className="mt-1 text-xs text-amber-800">
                  Reset only when the member&apos;s identity subject has legitimately changed.
                </p>
                {!confirmReset ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-2 text-amber-900"
                    onClick={() => setConfirmReset(true)}
                  >
                    <KeyRound size={14} /> Reset binding
                  </Button>
                ) : (
                  <div className="mt-2 flex items-center gap-2">
                    <Button type="button" variant="danger" onClick={() => resetMutation.mutate()}>
                      Confirm {member.email}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setConfirmReset(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : null}
        {mutation.error || resetMutation.error ? (
          <p className="text-sm text-red-600 sm:col-span-2">
            {mutation.error?.message ?? resetMutation.error?.message}
          </p>
        ) : null}
        {!member ? (
          <div className="bg-frosted-mint-50 text-frosted-mint-800 flex gap-2 rounded-lg p-3 text-xs sm:col-span-2">
            <UserRoundCheck size={17} className="shrink-0" />
            The account becomes usable when this exact email authenticates through Cloudflare
            Access.
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
