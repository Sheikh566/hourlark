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
  SearchInput,
  Select,
  SortHeader,
  useToast,
} from "@/web/components/ui";
import { TagEditor } from "@/web/features/tags/tag-editor";
import { TagRowMenu } from "@/web/features/tags/tag-row-menu";
import { apiRequest } from "@/web/lib/api";
import type { Tag } from "@/web/types";

export function TagsPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
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
    onSuccess: async (_result, { tag, action }) => {
      await queryClient.invalidateQueries();
      toast({
        title: "Success",
        message: action === "archive" ? "Tag archived successfully" : "Tag restored successfully",
        // Archiving is reversible, so offer Toggl's UNDO (it has no tag delete confirmation).
        action:
          action === "archive"
            ? {
                label: "Undo",
                onSelect: () => statusMutation.mutate({ tag, action: "reactivate" }),
              }
            : undefined,
      });
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
          <Button
            icon={<Plus size={20} />}
            className="leading-[normal]"
            onClick={() => setEditing("new")}
          >
            New Tag
          </Button>
        }
      />
      <PageToolbar>
        <SearchInput label="Search tags" value={search} onChange={setSearch} />
        <Select
          className="h-9 w-40"
          aria-label="Filter tags by status"
          value={status}
          onValueChange={(value) => setStatus(value as typeof status)}
          options={[
            { value: "active", label: "Show active" },
            { value: "archived", label: "Show archived" },
          ]}
        />
      </PageToolbar>
      {statusMutation.error ? (
        <p role="alert" className="text-error-fg px-5 py-3 text-sm">
          {statusMutation.error.message}
        </p>
      ) : null}
      {tags.isPending ? (
        <Loading label="Loading tags…" />
      ) : tags.error ? (
        <ErrorState message={tags.error.message} onRetry={() => void tags.refetch()} />
      ) : visible.length === 0 ? (
        <div className="pt-24">
          <EmptyState
            title="Nothing to see here..."
            description={
              needle || status === "archived"
                ? "Try different filters or keywords to find the tags you are looking for."
                : "Create a tag to classify time entries."
            }
            action={
              <Button variant="outline" className="gap-2" onClick={() => setEditing("new")}>
                <Plus size={14} aria-hidden="true" /> New tag
              </Button>
            }
          />
        </div>
      ) : (
        // Toggl's table ends 10px before the content edge (its 55px action cell holds the kebab).
        <div className="pr-2.5">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">
                  {/* Toggl's header leads with a select-all box; keep its 24px offset so names align. */}
                  <div className="pl-6">
                    <SortHeader
                      label="Tag"
                      direction={sort}
                      onToggle={() => setSort((value) => (value === "asc" ? "desc" : "asc"))}
                    />
                  </div>
                </th>
                <th scope="col" className="w-[55px] !pr-[9px]">
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
                      className="flex min-w-0 items-center gap-[11px] text-left font-medium"
                      onClick={() => setEditing(tag)}
                    >
                      <span
                        className="grid size-3.5 shrink-0 place-items-center"
                        aria-hidden="true"
                      >
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                      </span>
                      <span className="truncate">{tag.name}</span>
                    </button>
                  </td>
                  <td className="!pr-[9px] text-right">
                    <TagRowMenu
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
        </div>
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
