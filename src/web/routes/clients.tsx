import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { useMe } from "@/web/app/context";
import {
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  RowMenu,
  SearchInput,
  Select,
  useToast,
  type RowMenuItem,
} from "@/web/components/ui";
import { BulkBar } from "@/web/features/manage/bulk-bar";
import { ClientEditor } from "@/web/features/manage/client-editor";
import { apiRequest } from "@/web/lib/api";
import type { Client, Project } from "@/web/types";

export function ClientsPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const manage = me.permissions.manage_workspace;
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const clients = useQuery({
    queryKey: ["clients", status, search],
    queryFn: () =>
      apiRequest<{ clients: Client[] }>(
        `/clients?${new URLSearchParams({ status, ...(search ? { search } : {}) })}`,
      ),
  });
  const statusMutation = useMutation({
    mutationFn: async ({ items, next }: { items: Client[]; next: "archive" | "reactivate" }) => {
      // One at a time: each call bumps the client version and the list is refreshed afterwards.
      for (const client of items) {
        await apiRequest(`/clients/${client.id}/${next}`, { method: "POST", body: "{}" });
      }
    },
    onSuccess: async (_result, { items, next }) => {
      await queryClient.invalidateQueries();
      setSelection(new Set());
      const noun = items.length === 1 ? "Client" : `${items.length} clients`;
      toast({
        message: `${noun} ${next === "archive" ? "archived" : "restored"}.`,
        action: {
          label: "Undo",
          onSelect: () =>
            statusMutation.mutate({ items, next: next === "archive" ? "reactivate" : "archive" }),
        },
      });
    },
  });
  const list = clients.data?.clients ?? [];
  const expandable = list.filter((client) => (client.project_count ?? 0) > 0);
  const allExpanded =
    expandable.length > 0 && expandable.every((client) => expanded.has(client.id));
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selected = list.filter((client) => selection.has(client.id));
  const allSelected = list.length > 0 && selected.length === list.length;
  const toggleSelected = (id: string) =>
    setSelection((current) => {
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
          manage
            ? "Manage billing profiles and review tracked time by client."
            : "Clients connected to projects available to you."
        }
        actions={
          manage ? (
            <Button icon={<Plus size={20} strokeWidth={1.5} />} onClick={() => setEditing("new")}>
              New client
            </Button>
          ) : undefined
        }
      />
      <div className="page-toolbar py-0">
        {manage ? (
          <Select
            className="[&_svg]:text-fg h-9 w-auto border-0 bg-transparent shadow-[inset_0_0_0_1px_var(--color-stroke-tertiary)]"
            aria-label="Filter clients by status"
            value={status}
            onValueChange={(value) => {
              setStatus(value as typeof status);
              setSelection(new Set());
            }}
            options={[
              { value: "active", label: "Show active" },
              { value: "archived", label: "Show archived" },
            ]}
          />
        ) : null}
        <SearchInput label="Search clients" value={search} onChange={setSearch} />
      </div>
      {statusMutation.error ? (
        <p role="alert" className="text-error-fg px-5 py-3 text-sm">
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
            manage ? (
              <Button
                variant="outline"
                icon={<Plus size={14} strokeWidth={1.5} />}
                onClick={() => setEditing("new")}
              >
                New client
              </Button>
            ) : undefined
          }
        />
      ) : (
        <table className="data-table">
          <colgroup>
            <col className="w-[50px]" />
            <col className="w-[50px]" />
            <col />
            <col className="w-[42px]" />
          </colgroup>
          <thead>
            {manage && selected.length > 0 ? (
              <BulkBar
                count={selected.length}
                noun="item"
                columns={4}
                onClear={() => setSelection(new Set())}
                actions={[
                  status === "active"
                    ? {
                        label: "Archive",
                        icon: <Archive size={14} strokeWidth={1.5} />,
                        disabled: statusMutation.isPending,
                        onSelect: () => statusMutation.mutate({ items: selected, next: "archive" }),
                      }
                    : {
                        label: "Restore",
                        icon: <RotateCcw size={14} strokeWidth={1.5} />,
                        disabled: statusMutation.isPending,
                        onSelect: () =>
                          statusMutation.mutate({ items: selected, next: "reactivate" }),
                      },
                ]}
              />
            ) : null}
            <tr>
              <th scope="col" className="h-12 pr-0 pl-5">
                {manage ? (
                  <Checkbox
                    aria-label="Select all clients"
                    checked={allSelected}
                    indeterminate={selected.length > 0 && !allSelected}
                    onChange={() =>
                      setSelection(
                        allSelected ? new Set() : new Set(list.map((client) => client.id)),
                      )
                    }
                  />
                ) : null}
              </th>
              <th scope="col" className="h-12 p-0">
                <ExpandButton
                  expanded={allExpanded}
                  label={allExpanded ? "Collapse all clients" : "Expand all clients"}
                  onClick={() =>
                    setExpanded(
                      allExpanded ? new Set() : new Set(expandable.map((client) => client.id)),
                    )
                  }
                />
              </th>
              <th
                scope="col"
                className="h-12 cursor-default px-0 text-[11px] leading-4 font-semibold tracking-[0.44px] whitespace-normal"
              >
                Clients <span aria-hidden="true">|</span> Projects
              </th>
              <th scope="col" className="h-12 p-0">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((client) => (
              <ClientRows
                key={client.id}
                client={client}
                manage={manage}
                selected={selection.has(client.id)}
                onSelect={() => toggleSelected(client.id)}
                expanded={expanded.has(client.id)}
                onToggle={() => toggle(client.id)}
                actions={
                  manage
                    ? [
                        { label: "Edit", onSelect: () => setEditing(client) },
                        client.status === "active"
                          ? {
                              label: "Archive",
                              disabled: statusMutation.isPending,
                              onSelect: () =>
                                statusMutation.mutate({ items: [client], next: "archive" }),
                            }
                          : {
                              label: "Restore",
                              disabled: statusMutation.isPending,
                              onSelect: () =>
                                statusMutation.mutate({ items: [client], next: "reactivate" }),
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

/** Toggl's 32x32 chevron button: 7.5x12 pointing right, 12x7.5 pointing down when open. */
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
      className="text-fg grid size-8 place-items-center rounded-lg"
      aria-label={label}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {expanded ? (
        <svg
          width="12"
          height="7.5"
          viewBox="0 0 12 7.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M1 1l5 5 5-5" />
        </svg>
      ) : (
        <svg
          width="7.5"
          height="12"
          viewBox="0 0 7.5 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M1 1l5 5-5 5" />
        </svg>
      )}
    </button>
  );
}

function ClientRows({
  client,
  manage,
  selected,
  onSelect,
  expanded,
  onToggle,
  actions,
}: {
  client: Client;
  manage: boolean;
  selected: boolean;
  onSelect: () => void;
  expanded: boolean;
  onToggle: () => void;
  actions: RowMenuItem[];
}) {
  const count = client.project_count ?? 0;
  const projects = useQuery({
    queryKey: ["projects", "active", "", client.id],
    queryFn: () =>
      apiRequest<{ projects: Project[] }>(
        `/projects?${new URLSearchParams({ status: "active", client_id: client.id })}`,
      ),
    enabled: expanded && count > 0,
  });
  const open = expanded && count > 0;
  return (
    <>
      <tr className={open ? "group/row bg-surface-hover" : "group/row"}>
        <td className="h-12 pr-0 pl-5">
          {manage ? (
            <Checkbox
              aria-label={`Select ${client.name}`}
              checked={selected}
              className="opacity-0 group-hover/row:opacity-100 checked:opacity-100 focus-visible:opacity-100"
              onChange={onSelect}
            />
          ) : null}
        </td>
        <td className="h-12 p-0">
          {count > 0 ? (
            <ExpandButton
              expanded={open}
              label={`${open ? "Collapse" : "Expand"} ${client.name}`}
              onClick={onToggle}
            />
          ) : null}
        </td>
        <td className="h-12 px-0">
          {count > 0 ? (
            <button type="button" className="flex gap-2 text-left leading-5" onClick={onToggle}>
              <span>{client.name}</span>
              <span className="text-fg-subtle tabular-nums">({count})</span>
            </button>
          ) : (
            <div className="flex gap-2 leading-5">
              <span>{client.name}</span>
              <span className="text-fg-subtle tabular-nums">({count})</span>
            </div>
          )}
        </td>
        <td className="h-12 p-0 pr-3">
          <RowMenu label={`Actions for ${client.name}`} items={actions} />
        </td>
      </tr>
      {open ? (
        projects.isPending ? (
          <tr className="bg-surface-secondary hover:bg-surface-secondary">
            <td className="h-12" />
            <td className="h-12" />
            <td colSpan={2} className="text-fg-subtle h-12 px-0 pl-6">
              Loading projects…
            </td>
          </tr>
        ) : (projects.data?.projects ?? []).length === 0 ? (
          <tr className="bg-surface-secondary hover:bg-surface-secondary">
            <td className="h-12" />
            <td className="h-12" />
            <td colSpan={2} className="text-fg-subtle h-12 px-0 pl-6">
              No active projects
            </td>
          </tr>
        ) : (
          (projects.data?.projects ?? []).map((project) => (
            <tr key={project.id} className="bg-surface-secondary hover:bg-surface-secondary">
              <td className="h-12" />
              <td className="h-12" />
              <td colSpan={2} className="h-12 px-0 pl-6">
                <Link
                  to={`/projects?client_id=${encodeURIComponent(client.id)}`}
                  className="flex items-center leading-5 hover:underline"
                  style={{ color: project.color }}
                >
                  <span
                    className="mr-[5px] font-[Arial,sans-serif] text-[26px] leading-[8px] font-bold"
                    aria-hidden="true"
                  >
                    •
                  </span>
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
