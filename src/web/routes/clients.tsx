import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Building2, FolderOpen, Pencil, Plus, RotateCcw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
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
import type { Client } from "@/web/types";

const clientFormSchema = z.object({
  name: z.string().min(1),
  billing_contact_name: z.string(),
  billing_email: z.union([z.literal(""), z.email()]),
  billing_address: z.string(),
  tax_identifier: z.string(),
  default_rate_major: z.string(),
  currency: z.string().length(3),
  notes: z.string(),
});
type ClientForm = z.infer<typeof clientFormSchema>;

export function ClientsPage() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [search, setSearch] = useState("");
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
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["clients"] }),
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
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-3">
          <div className="relative min-w-64 flex-1">
            <Search className="absolute top-3 left-3 text-slate-400" size={15} />
            <Input
              className="pl-9"
              placeholder="Search clients"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {me.permissions.manage_workspace ? (
            <Select
              className="w-40"
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </Select>
          ) : null}
        </div>
        {(clients.data?.clients ?? []).length === 0 ? (
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
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {(clients.data?.clients ?? []).map((client) => (
              <article key={client.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="bg-frosted-mint-50 text-frosted-mint-700 grid h-10 w-10 shrink-0 place-items-center rounded-lg">
                      <Building2 size={19} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate font-bold text-slate-800">{client.name}</h2>
                      <Badge>{client.status}</Badge>
                    </div>
                  </div>
                  {me.permissions.manage_workspace ? (
                    <Button
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => setEditing(client)}
                    >
                      <Pencil size={15} />
                      <span className="sr-only">Edit {client.name}</span>
                    </Button>
                  ) : null}
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Projects</dt>
                    <dd className="font-semibold">{client.project_count ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Tracked</dt>
                    <dd className="font-semibold">{formatDuration(client.tracked_ms ?? 0)}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => navigate(`/projects?client_id=${encodeURIComponent(client.id)}`)}
                  >
                    <FolderOpen size={14} /> View projects
                  </Button>
                  {me.permissions.manage_workspace ? (
                    client.status === "active" ? (
                      <Button
                        variant="ghost"
                        className="text-slate-500"
                        onClick={() => statusMutation.mutate({ client, next: "archive" })}
                      >
                        <Archive size={14} /> Archive
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        onClick={() => statusMutation.mutate({ client, next: "reactivate" })}
                      >
                        <RotateCcw size={14} /> Reactivate
                      </Button>
                    )
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <ClientEditor
        open={editing !== null}
        client={editing === "new" ? null : editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
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
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
      onOpenChange(false);
    },
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={client ? "Edit client" : "New client"}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void form.handleSubmit((values) => mutation.mutate(values))()}>
            Save client
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => event.preventDefault()}>
        <div className="sm:col-span-2">
          <Field label="Client name">
            <Input {...form.register("name")} />
          </Field>
        </div>
        <Field label="Billing contact">
          <Input {...form.register("billing_contact_name")} />
        </Field>
        <Field label="Billing email">
          <Input type="email" {...form.register("billing_email")} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Billing address">
            <textarea
              className="min-h-20 rounded-lg border border-slate-300 p-3 text-sm"
              {...form.register("billing_address")}
            />
          </Field>
        </div>
        <Field label="Tax / registration ID">
          <Input {...form.register("tax_identifier")} />
        </Field>
        <Field label="Currency">
          <Input maxLength={3} {...form.register("currency")} />
        </Field>
        <Field label="Default hourly rate">
          <Input type="number" min="0" step="0.01" {...form.register("default_rate_major")} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes">
            <textarea
              className="min-h-24 rounded-lg border border-slate-300 p-3 text-sm"
              {...form.register("notes")}
            />
          </Field>
        </div>
        {mutation.error ? (
          <p className="text-sm text-red-600 sm:col-span-2">{mutation.error.message}</p>
        ) : null}
      </form>
    </Modal>
  );
}
