import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BriefcaseBusiness,
  Clock3,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useSearchParams } from "react-router";
import { z } from "zod";

import { majorToMinor, minorToMajor } from "@/domain/billing/money";
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
import type { Client, Member, Project, TimeEntry } from "@/web/types";

const projectSchema = z.object({
  client_id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  billable_default: z.boolean(),
  hourly_rate_major: z.string(),
  currency: z.string().length(3),
  budget_hours: z.string(),
  visibility: z.enum(["all", "assigned"]),
  notes: z.string(),
  member_ids: z.array(z.string()),
});
type ProjectForm = z.infer<typeof projectSchema>;

export function ProjectsPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [searchParameters] = useSearchParams();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [clientId, setClientId] = useState(() => searchParameters.get("client_id") ?? "");
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const parameters = new URLSearchParams({
    status,
    ...(search ? { search } : {}),
    ...(clientId ? { client_id: clientId } : {}),
  });
  const projects = useQuery({
    queryKey: ["projects", status, search, clientId],
    queryFn: () => apiRequest<{ projects: Project[] }>(`/projects?${parameters}`),
  });
  const clients = useQuery({
    queryKey: ["clients", "active"],
    queryFn: () => apiRequest<{ clients: Client[] }>("/clients?status=active"),
  });
  const statusMutation = useMutation({
    mutationFn: ({ project, next }: { project: Project; next: "archive" | "reactivate" }) =>
      apiRequest(`/projects/${project.id}/${next}`, { method: "POST", body: "{}" }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  return (
    <>
      <PageHeader
        title="Projects"
        description="Organize tracked work, access, rates, and budget targets."
        actions={
          me.permissions.manage_workspace ? (
            <Button onClick={() => setEditing("new")}>
              <Plus size={16} /> New project
            </Button>
          ) : undefined
        }
      />
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-3">
          <div className="relative min-w-64 flex-1">
            <Search className="absolute top-3 left-3 text-slate-400" size={15} />
            <Input
              className="pl-9"
              placeholder="Search projects"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {me.permissions.manage_workspace ? (
            <>
              <Select
                className="w-44"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
              >
                <option value="">All clients</option>
                {(clients.data?.clients ?? []).map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
              <Select
                className="w-36"
                value={status}
                onChange={(event) => setStatus(event.target.value as typeof status)}
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </Select>
            </>
          ) : null}
        </div>
        {(projects.data?.projects ?? []).length === 0 ? (
          <EmptyState
            title="No projects found"
            description="Adjust the filters or create a project to make it available for tracking."
            action={
              me.permissions.manage_workspace ? (
                <Button variant="secondary" onClick={() => setEditing("new")}>
                  <Plus size={16} /> Add project
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {(projects.data?.projects ?? []).map((project) => {
              const budgetMs = (project.budget_minutes ?? 0) * 60_000;
              const utilization =
                budgetMs > 0
                  ? Math.min(100, Math.round(((project.tracked_ms ?? 0) / budgetMs) * 100))
                  : null;
              return (
                <article key={project.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white"
                        style={{ backgroundColor: project.color }}
                      >
                        <BriefcaseBusiness size={18} />
                      </span>
                      <div className="min-w-0">
                        <h2 className="truncate font-bold text-slate-800">{project.name}</h2>
                        <p className="truncate text-xs text-slate-500">{project.client_name}</p>
                      </div>
                    </div>
                    {me.permissions.manage_workspace ? (
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => setEditing(project)}
                      >
                        <Pencil size={15} />
                        <span className="sr-only">Edit {project.name}</span>
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge>{project.status ?? "active"}</Badge>
                    <Badge>{project.billable_default ? "Billable default" : "Non-billable"}</Badge>
                    {project.visibility ? (
                      <Badge>
                        <Users size={11} />{" "}
                        {project.visibility === "all" ? "All members" : "Assigned"}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Tracked</span>
                      <strong>{formatDuration(project.tracked_ms ?? 0)}</strong>
                    </div>
                    {utilization !== null ? (
                      <div className="mt-2">
                        <div className="mb-1 flex justify-between text-xs text-slate-500">
                          <span>Budget utilization</span>
                          <span>{utilization}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="bg-brand-yellow h-full rounded-full"
                            style={{ width: `${utilization}%` }}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {me.permissions.manage_workspace ? (
                    <div className="mt-4">
                      {project.status !== "archived" ? (
                        <Button
                          variant="ghost"
                          className="text-slate-500"
                          onClick={() => statusMutation.mutate({ project, next: "archive" })}
                        >
                          <Archive size={14} /> Archive
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          onClick={() => statusMutation.mutate({ project, next: "reactivate" })}
                        >
                          <RotateCcw size={14} /> Reactivate
                        </Button>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
      <ProjectEditor
        open={editing !== null}
        project={editing === "new" ? null : editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </>
  );
}

function ProjectEditor({
  open,
  project,
  onOpenChange,
}: {
  open: boolean;
  project: Project | null;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useMe();
  const queryClient = useQueryClient();
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
      color: "#36546D",
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
      color: project?.color ?? "#36546D",
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
      visibility: project?.visibility ?? "all",
      notes: project?.notes ?? "",
      member_ids: project?.member_ids_json ? (JSON.parse(project.member_ids_json) as string[]) : [],
    });
  }, [form, me.workspace.currency, open, project]);
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
          error.message.includes("Historical entries will keep their client snapshot") &&
          window.confirm(`${error.message} Continue with this client change?`)
        ) {
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
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      onOpenChange(false);
    },
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={project ? "Edit project" : "New project"}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void form.handleSubmit((values) => mutation.mutate(values))()}>
            Save project
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => event.preventDefault()}>
        <div className="sm:col-span-2">
          <Field label="Client">
            <Select {...form.register("client_id")}>
              <option value="">Select a client</option>
              {(clients.data?.clients ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Project name">
          <Input {...form.register("name")} />
        </Field>
        <Field label="Project color">
          <Input type="color" className="p-1" {...form.register("color")} />
        </Field>
        <Field label="Currency">
          <Input maxLength={3} {...form.register("currency")} />
        </Field>
        <Field label="Hourly rate">
          <Input type="number" min="0" step="0.01" {...form.register("hourly_rate_major")} />
        </Field>
        <Field label="Budget hours">
          <Input type="number" min="0" step="0.25" {...form.register("budget_hours")} />
        </Field>
        <Field label="Visibility">
          <Select {...form.register("visibility")}>
            <option value="all">All active members</option>
            <option value="assigned">Assigned members only</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:col-span-2">
          <input type="checkbox" {...form.register("billable_default")} />
          Billable by default
        </label>
        {form.watch("visibility") === "assigned" ? (
          <fieldset className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:col-span-2">
            <legend className="px-1 text-sm font-semibold">Assigned members</legend>
            {(members.data?.members ?? [])
              .filter((member) => member.status !== "inactive")
              .map((member) => (
                <label key={member.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" value={member.id} {...form.register("member_ids")} />
                  {member.display_name} <span className="text-slate-400">({member.email})</span>
                </label>
              ))}
          </fieldset>
        ) : null}
        <div className="sm:col-span-2">
          <Field label="Notes">
            <textarea
              className="min-h-24 rounded-lg border border-slate-300 p-3 text-sm"
              {...form.register("notes")}
            />
          </Field>
        </div>
        {project ? (
          <section className="rounded-lg border border-slate-200 p-3 sm:col-span-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Clock3 size={15} /> Recent time
            </h3>
            {recentEntries.isLoading ? (
              <p className="mt-2 text-sm text-slate-500">Loading recent entries…</p>
            ) : (recentEntries.data?.entries.length ?? 0) === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No time has been tracked yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {(recentEntries.data?.entries ?? []).map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-700">
                        {entry.description || "Untitled entry"}
                      </p>
                      <p className="text-xs text-slate-500">
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
        {mutation.error ? (
          <p className="text-sm text-red-600 sm:col-span-2">{mutation.error.message}</p>
        ) : null}
      </form>
    </Modal>
  );
}
