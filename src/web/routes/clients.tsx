import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { z } from "zod";

import { majorToMinor, minorToMajor } from "@/domain/billing/money";
import { useMe } from "@/web/app/context";
import {
  Button,
  EmptyState,
  ErrorState,
  Loading,
  Field,
  Input,
  Modal,
  PageHeader,
  PageToolbar,
  RowMenu,
  SearchInput,
  Select,
  type RowMenuItem,
} from "@/web/components/ui";
import { FormErrors } from "@/web/components/form-errors";
import { apiRequest } from "@/web/lib/api";
import type { Client, Project } from "@/web/types";

const clientFormSchema = z.object({
  name: z.string().trim().min(1, "This field is required."),
  billing_contact_name: z.string(),
  billing_email: z
    .string()
    .trim()
    .refine(
      (value) => !value || z.email().safeParse(value).success,
      "Enter a valid billing email address.",
    ),
  billing_address: z.string(),
  tax_identifier: z.string(),
  default_rate_major: z
    .string()
    .refine(
      (value) => !value || (Number.isFinite(Number(value)) && Number(value) >= 0),
      "Enter a non-negative number.",
    ),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Enter a three-letter currency code."),
  notes: z.string(),
});
type ClientForm = z.infer<typeof clientFormSchema>;

export function ClientsPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const clients = useQuery({
    queryKey: ["clients", status, search],
    queryFn: () =>
      apiRequest<{ clients: Client[] }>(
        `/clients?${new URLSearchParams({ status, ...(search ? { search } : {}) })}`,
      ),
  });
  const statusMutation = useMutation({
    mutationFn: ({ client, next }: { client: Client; next: "archive" | "reactivate" }) =>
      apiRequest(`/clients/${client.id}/${next}`, { method: "POST", body: "{}" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });
  const list = clients.data?.clients ?? [];
  const allExpanded = list.length > 0 && list.every((client) => expanded.has(client.id));
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <PageHeader
        title="Clients"
        description={
          me.permissions.manage_workspace
            ? "Manage billing profiles and review tracked time by client."
            : "Clients connected to projects available to you."
        }
        actions={
          me.permissions.manage_workspace ? (
            <Button onClick={() => setEditing("new")}>
              <Plus size={16} /> New client
            </Button>
          ) : undefined
        }
      />
      <PageToolbar>
        {me.permissions.manage_workspace ? (
          <Select
            className="w-40"
            aria-label="Filter clients by status"
            value={status}
            onValueChange={(value) => setStatus(value as typeof status)}
            options={[
              { value: "active", label: "Show active" },
              { value: "archived", label: "Show archived" },
            ]}
          />
        ) : null}
        <SearchInput label="Search clients" value={search} onChange={setSearch} />
      </PageToolbar>
      {statusMutation.isPending ? (
        <p role="status" className="px-5 py-3 text-sm text-[#a4a4a4]">
          Updating client status…
        </p>
      ) : null}
      {statusMutation.error ? (
        <p role="alert" className="px-5 py-3 text-sm text-red-300">
          {statusMutation.error.message}
        </p>
      ) : null}
      {clients.isPending ? (
        <Loading label="Loading clients…" />
      ) : clients.error ? (
        <ErrorState message={clients.error.message} onRetry={() => void clients.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          title="No clients found"
          description="Create a client before adding its first project."
          action={
            me.permissions.manage_workspace ? (
              <Button variant="secondary" onClick={() => setEditing("new")}>
                <Plus size={16} /> Add client
              </Button>
            ) : undefined
          }
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="w-12">
                <ExpandButton
                  expanded={allExpanded}
                  label={allExpanded ? "Collapse all clients" : "Expand all clients"}
                  onClick={() =>
                    setExpanded(allExpanded ? new Set() : new Set(list.map((client) => client.id)))
                  }
                />
              </th>
              <th scope="col">
                Clients <span className="text-[#5f5f5f]">|</span> Projects
              </th>
              <th scope="col" className="w-16">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((client) => (
              <ClientRows
                key={client.id}
                client={client}
                expanded={expanded.has(client.id)}
                onToggle={() => toggle(client.id)}
                actions={
                  me.permissions.manage_workspace
                    ? [
                        { label: "Edit", onSelect: () => setEditing(client) },
                        client.status === "active"
                          ? {
                              label: "Archive",
                              disabled: statusMutation.isPending,
                              onSelect: () => statusMutation.mutate({ client, next: "archive" }),
                            }
                          : {
                              label: "Restore",
                              disabled: statusMutation.isPending,
                              onSelect: () => statusMutation.mutate({ client, next: "reactivate" }),
                            },
                      ]
                    : []
                }
              />
            ))}
          </tbody>
        </table>
      )}
      <ClientEditor
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        open={editing !== null}
        client={editing === "new" ? null : editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </>
  );
}

function ExpandButton({
  expanded,
  label,
  onClick,
}: {
  expanded: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="grid h-7 w-7 place-items-center rounded-md text-[#fafafa] hover:bg-white/8"
      aria-label={label}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
    </button>
  );
}

function ClientRows({
  client,
  expanded,
  onToggle,
  actions,
}: {
  client: Client;
  expanded: boolean;
  onToggle: () => void;
  actions: RowMenuItem[];
}) {
  const projects = useQuery({
    queryKey: ["projects", "active", "", client.id],
    queryFn: () =>
      apiRequest<{ projects: Project[] }>(
        `/projects?${new URLSearchParams({ status: "active", client_id: client.id })}`,
      ),
    enabled: expanded,
  });
  return (
    <>
      <tr className={expanded ? "bg-white/6" : undefined}>
        <td>
          <ExpandButton
            expanded={expanded}
            label={`${expanded ? "Collapse" : "Expand"} ${client.name}`}
            onClick={onToggle}
          />
        </td>
        <td>
          <button type="button" className="text-left font-semibold" onClick={onToggle}>
            {client.name}
            <span className="ml-2 font-normal text-[#a4a4a4]">({client.project_count ?? 0})</span>
          </button>
        </td>
        <td className="text-right">
          <RowMenu label={`Actions for ${client.name}`} items={actions} />
        </td>
      </tr>
      {expanded ? (
        projects.isPending ? (
          <tr>
            <td />
            <td colSpan={2} className="text-[#a4a4a4]">
              Loading projects…
            </td>
          </tr>
        ) : (projects.data?.projects ?? []).length === 0 ? (
          <tr>
            <td />
            <td colSpan={2} className="text-[#a4a4a4]">
              No active projects
            </td>
          </tr>
        ) : (
          (projects.data?.projects ?? []).map((project) => (
            <tr key={project.id} className="bg-[#1b1b1b]">
              <td />
              <td colSpan={2}>
                <Link
                  to={`/projects?client_id=${encodeURIComponent(client.id)}`}
                  className="inline-flex items-center gap-2 pl-6 font-medium hover:underline"
                  style={{ color: project.color }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: project.color }}
                    aria-hidden="true"
                  />
                  {project.name}
                </Link>
              </td>
            </tr>
          ))
        )
      ) : null}
    </>
  );
}

function ClientEditor({
  open,
  client,
  onOpenChange,
}: {
  open: boolean;
  client: Client | null;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useMe();
  const queryClient = useQueryClient();
  const form = useForm<ClientForm>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: {
      name: "",
      billing_contact_name: "",
      billing_email: "",
      billing_address: "",
      tax_identifier: "",
      default_rate_major: "",
      currency: me.workspace.currency,
      notes: "",
    },
  });
  useEffect(() => {
    form.reset({
      name: client?.name ?? "",
      billing_contact_name: client?.billing_contact_name ?? "",
      billing_email: client?.billing_email ?? "",
      billing_address: client?.billing_address ?? "",
      tax_identifier: client?.tax_identifier ?? "",
      default_rate_major:
        client?.default_rate_minor === null || client?.default_rate_minor === undefined
          ? ""
          : String(
              minorToMajor(client.default_rate_minor, client.currency ?? me.workspace.currency),
            ),
      currency: client?.currency ?? me.workspace.currency,
      notes: client?.notes ?? "",
    });
  }, [client, form, me.workspace.currency, open]);
  const mutation = useMutation({
    mutationFn: (values: ClientForm) => {
      const body = {
        name: values.name,
        billing_contact_name: values.billing_contact_name || null,
        billing_email: values.billing_email || null,
        billing_address: values.billing_address || null,
        tax_identifier: values.tax_identifier || null,
        default_rate_minor: values.default_rate_major
          ? majorToMinor(values.default_rate_major, values.currency)
          : null,
        currency: values.currency.toUpperCase(),
        notes: values.notes || null,
        ...(client ? { version: client.version } : {}),
      };
      return apiRequest(client ? `/clients/${client.id}` : "/clients", {
        method: client ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
    },
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
      title={client ? "Edit client" : "New client"}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={mutation.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={mutation.isPending}
            onClick={() =>
              void form.handleSubmit((values) => !mutation.isPending && mutation.mutate(values))()
            }
          >
            {mutation.isPending ? "Saving…" : "Save client"}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={form.handleSubmit((values) => !mutation.isPending && mutation.mutate(values))}
      >
        <fieldset disabled={mutation.isPending} className="contents">
          <FormErrors errors={form.formState.errors} />
          <div className="sm:col-span-2">
            <Field label="Client name">
              <Input
                aria-invalid={Boolean(form.formState.errors.name)}
                {...form.register("name")}
              />
            </Field>
          </div>
          <Field label="Billing contact">
            <Input
              aria-invalid={Boolean(form.formState.errors.billing_contact_name)}
              {...form.register("billing_contact_name")}
            />
          </Field>
          <Field label="Billing email">
            <Input
              type="email"
              aria-invalid={Boolean(form.formState.errors.billing_email)}
              {...form.register("billing_email")}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Billing address">
              <textarea
                className="min-h-20 rounded-lg border border-slate-300 p-3 text-sm"
                aria-invalid={Boolean(form.formState.errors.billing_address)}
                {...form.register("billing_address")}
              />
            </Field>
          </div>
          <Field label="Tax / registration ID">
            <Input
              aria-invalid={Boolean(form.formState.errors.tax_identifier)}
              {...form.register("tax_identifier")}
            />
          </Field>
          <Field label="Currency">
            <Input
              maxLength={3}
              aria-invalid={Boolean(form.formState.errors.currency)}
              {...form.register("currency")}
            />
          </Field>
          <Field label="Default hourly rate">
            <Input
              type="number"
              min="0"
              step="0.01"
              aria-invalid={Boolean(form.formState.errors.default_rate_major)}
              {...form.register("default_rate_major")}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <textarea
                className="min-h-24 rounded-lg border border-slate-300 p-3 text-sm"
                aria-invalid={Boolean(form.formState.errors.notes)}
                {...form.register("notes")}
              />
            </Field>
          </div>
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
