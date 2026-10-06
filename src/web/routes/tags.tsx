import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router";

import { useMe } from "@/web/app/context";
import {
  Button,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  PageToolbar,
  RowMenu,
  SearchInput,
  Select,
  SortHeader,
} from "@/web/components/ui";
import { TagEditor } from "@/web/routes/administration";
import { apiRequest } from "@/web/lib/api";
import type { Tag } from "@/web/types";

export function TagsPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const [editing, setEditing] = useState<Tag | "new" | null>(null);
  const tags = useQuery({
    queryKey: ["tags", status],
    queryFn: () => apiRequest<{ tags: Tag[] }>(`/tags?status=${status}`),
    enabled: me.permissions.manage_workspace,
  });
  const statusMutation = useMutation({
    mutationFn: ({ tag, action }: { tag: Tag; action: "archive" | "reactivate" }) =>
      apiRequest(`/tags/${tag.id}/${action}`, { method: "POST", body: "{}" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });
  if (!me.permissions.manage_workspace) return <Navigate to="/time" replace />;

  const needle = search.trim().toLocaleLowerCase();
  const visible = (tags.data?.tags ?? [])
    .filter((tag) => !needle || tag.name.toLocaleLowerCase().includes(needle))
    .sort((left, right) =>
      sort === "asc" ? left.name.localeCompare(right.name) : right.name.localeCompare(left.name),
    );

  return (
    <>
      <PageHeader
        title="Tags"
        description="Create and maintain reusable labels for classifying time."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus size={16} /> New Tag
          </Button>
        }
      />
      <PageToolbar>
        <Select
          className="w-40"
          aria-label="Filter tags by status"
          value={status}
          onValueChange={(value) => setStatus(value as typeof status)}
          options={[
            { value: "active", label: "Show active" },
            { value: "archived", label: "Show archived" },
          ]}
        />
        <SearchInput label="Search tags" value={search} onChange={setSearch} />
      </PageToolbar>
      {statusMutation.isPending ? (
        <p role="status" className="px-5 py-3 text-sm text-[#a4a4a4]">
          Updating tag status…
        </p>
      ) : null}
      {statusMutation.error ? (
        <p role="alert" className="px-5 py-3 text-sm text-red-300">
          {statusMutation.error.message}
        </p>
      ) : null}
      {tags.isPending ? (
        <Loading label="Loading tags…" />
      ) : tags.error ? (
        <ErrorState message={tags.error.message} onRetry={() => void tags.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={needle ? "No matching tags" : "No tags found"}
          description={
            needle ? "Try a different search." : "Create a tag to classify time entries."
          }
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">
                <SortHeader
                  label="Tag"
                  direction={sort}
                  onToggle={() => setSort((value) => (value === "asc" ? "desc" : "asc"))}
                />
              </th>
              <th scope="col" className="w-16">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((tag) => (
              <tr key={tag.id}>
                <td>
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2.5 text-left font-semibold hover:text-[#fbbf24]"
                    onClick={() => setEditing(tag)}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{tag.name}</span>
                  </button>
                </td>
                <td className="text-right">
                  <RowMenu
                    label={`Actions for ${tag.name}`}
                    items={[
                      { label: "Edit", onSelect: () => setEditing(tag) },
                      tag.status === "active"
                        ? {
                            label: "Archive",
                            disabled: statusMutation.isPending,
                            onSelect: () => statusMutation.mutate({ tag, action: "archive" }),
                          }
                        : {
                            label: "Restore",
                            disabled: statusMutation.isPending,
                            onSelect: () => statusMutation.mutate({ tag, action: "reactivate" }),
                          },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <TagEditor
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        open={editing !== null}
        tag={editing === "new" ? null : editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </>
  );
}
