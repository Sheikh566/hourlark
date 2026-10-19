import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CaseSensitive, Contact, Plus, RotateCcw, Users } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { twMerge } from "tailwind-merge";

import { useMe } from "@/web/app/context";
import {
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  RowMenu,
  SortHeader,
  useToast,
} from "@/web/components/ui";
import { BulkBar } from "@/web/features/manage/bulk-bar";
import {
  ChecklistPopoverBody,
  ClearFiltersButton,
  ChipFilter,
  FilterPopover,
  PopoverSearch,
} from "@/web/features/manage/filter-chip";
import { parseMemberIds, ProjectEditor } from "@/web/features/manage/project-editor";
import { projectPageNameColor } from "@/web/features/manage/project-page-color";
import { apiRequest, idempotencyKey } from "@/web/lib/api";
import { formatDuration } from "@/web/lib/format";
import { broadcastTimerChange } from "@/web/lib/timer";
import type { Client, Member, Project } from "@/web/types";

type SortKey = "name" | "client" | "tracked";
type Status = "active" | "archived";
type FilterKey = "status" | "client" | "member" | "name";

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

/** Toggl's round "start timer" disc: a 16px accent circle with an 8px dark triangle. */
function StartGlyph() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
      <path d="M1.5 0.6 7.3 4 1.5 7.4z" />
    </svg>
  );
}

export function ProjectsPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const manage = me.permissions.manage_workspace;
  const [searchParameters] = useSearchParams();
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [statuses, setStatuses] = useState<ReadonlySet<Status>>(() => new Set(["active"]));
  const [clientIds, setClientIds] = useState<ReadonlySet<string>>(() => {
    const initial = searchParameters.get("client_id");
    return new Set(initial ? [initial] : []);
  });
  const [memberIds, setMemberIds] = useState<ReadonlySet<string>>(() => new Set());
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  // "Add member" opens the same dialog with the Privacy member panel expanded (Toggl only
  // assigns members to private projects).
  const [editorSection, setEditorSection] = useState<"details" | "members">("details");
  const openEditor = (project: Project | "new", section: "details" | "members" = "details") => {
    setEditorSection(section);
    setEditing(project);
  };
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const closeFilter = useCallback(() => setOpenFilter(null), []);
  const toggleFilter = (key: FilterKey) => {
    if (key === "name") setSearchDraft(search);
    setOpenFilter((current) => (current === key ? null : key));
  };

  // Both statuses selected means "all": the API only filters on a single status.
  const statusParameter = statuses.size === 1 ? [...statuses][0] : "all";
  const parameters = new URLSearchParams({
    status: statusParameter ?? "all",
    ...(search ? { search } : {}),
  });
  const projects = useQuery({
    queryKey: ["projects", statusParameter, search],
    queryFn: () => apiRequest<{ projects: Project[] }>(`/projects?${parameters}`),
  });
  const clients = useQuery({
    queryKey: ["clients", "active"],
    queryFn: () => apiRequest<{ clients: Client[] }>("/clients?status=active"),
  });
  const members = useQuery({
    queryKey: ["members"],
    queryFn: () => apiRequest<{ members: Member[] }>("/members"),
    enabled: manage,
  });
  const memberNames = useMemo(
    () => new Map((members.data?.members ?? []).map((member) => [member.id, member.display_name])),
    [members.data],
  );

  const refreshTimerSurfaces = async () => {
    broadcastTimerChange();
    await Promise.all(
      ["timer", "time-entries", "calendar", "reports", "recent-time"].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
  };
  const startMutation = useMutation({
    mutationFn: (project: Project) =>
      apiRequest("/timer/start", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ description: "", project_id: project.id, tag_ids: [] }),
      }),
    onSuccess: async (_result, project) => {
      await refreshTimerSurfaces();
      toast({ message: `Timer started on ${project.name}.` });
    },
    onError: (error) => toast({ message: error.message }),
  });
  const statusMutation = useMutation({
    mutationFn: async ({ items, next }: { items: Project[]; next: "archive" | "reactivate" }) => {
      // One at a time: each call bumps the project version and the list is refreshed afterwards.
      for (const project of items) {
        await apiRequest(`/projects/${project.id}/${next}`, { method: "POST", body: "{}" });
      }
    },
    onSuccess: async (_result, { items, next }) => {
      await queryClient.invalidateQueries();
      setSelection(new Set());
      const noun = items.length === 1 ? "Project" : `${items.length} projects`;
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

  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "name",
    direction: "asc",
  });
  const visible = (projects.data?.projects ?? []).filter(
    (project) =>
      (clientIds.size === 0 || clientIds.has(project.client_id)) &&
      (memberIds.size === 0 ||
        project.visibility !== "assigned" ||
        parseMemberIds(project.member_ids_json).some((id) => memberIds.has(id))),
  );
  const sorted = [...visible].sort((left, right) => {
    const order =
      sort.key === "tracked"
        ? (left.tracked_ms ?? 0) - (right.tracked_ms ?? 0)
        : sort.key === "client"
          ? left.client_name.localeCompare(right.client_name)
          : left.name.localeCompare(right.name);
    return sort.direction === "asc" ? order : -order;
  });
  const toggleSort = (key: SortKey) =>
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  const directionFor = (key: SortKey) => (sort.key === key ? sort.direction : null);

  const selected = sorted.filter((project) => selection.has(project.id));
  const selectedActive = selected.filter((project) => project.status !== "archived");
  const selectedArchived = selected.filter((project) => project.status === "archived");
  const allSelected = sorted.length > 0 && selected.length === sorted.length;
  const toggleSelected = (id: string) =>
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const filterCount = (statuses.size === 1 && statuses.has("active") ? 0 : 1) + (search ? 1 : 0);
  const filtersApplied = clientIds.size > 0 || memberIds.size > 0 || filterCount > 0;
  const clearFilters = () => {
    setStatuses(new Set(["active"]));
    setClientIds(new Set());
    setMemberIds(new Set());
    setSearch("");
    setSearchDraft("");
  };
  // Toggl defaults to every status except Archived; Hourlark only has Active and Archived.
  const statusLabel =
    statuses.size === STATUS_OPTIONS.length
      ? "All"
      : statuses.has("active")
        ? "All, except Archived"
        : "Archived";

  return (
    <>
      <PageHeader
        title="Projects"
        description="Organize tracked work, access, rates, and budget targets."
        actions={
          manage ? (
            <Button icon={<Plus size={20} strokeWidth={1.5} />} onClick={() => openEditor("new")}>
              New project
            </Button>
          ) : undefined
        }
      />
      <div className="page-toolbar py-0">
        {manage ? (
          <StatusFilter
            label={statusLabel}
            open={openFilter === "status"}
            onToggle={() => toggleFilter("status")}
            onClose={closeFilter}
            statuses={statuses}
            onChange={setStatuses}
          />
        ) : null}
        <span className="text-fg relative -top-0.5 mr-1.5 ml-3.5 text-[11px] leading-[11px] font-semibold tracking-[0.4px] whitespace-nowrap uppercase">
          Filters:
        </span>
        <div className="flex flex-wrap gap-2">
          <ChipFilter
            label="Client"
            icon={<Contact size={18} strokeWidth={1.25} />}
            count={clientIds.size}
            open={openFilter === "client"}
            onToggle={() => toggleFilter("client")}
            onClose={closeFilter}
          >
            <ClientFilterBody
              clients={clients.data?.clients ?? []}
              selected={clientIds}
              onChange={setClientIds}
            />
          </ChipFilter>
          {manage ? (
            <ChipFilter
              label="Member"
              icon={<Users size={18} strokeWidth={1.25} />}
              count={memberIds.size}
              open={openFilter === "member"}
              onToggle={() => toggleFilter("member")}
              onClose={closeFilter}
            >
              <MemberFilterBody
                members={(members.data?.members ?? []).filter(
                  (member) => member.status !== "inactive",
                )}
                selected={memberIds}
                onChange={setMemberIds}
              />
            </ChipFilter>
          ) : null}
          <ChipFilter
            label="Project name"
            icon={<CaseSensitive size={18} strokeWidth={1.25} />}
            count={search ? 1 : 0}
            open={openFilter === "name"}
            onToggle={() => toggleFilter("name")}
            onClose={closeFilter}
          >
            <PopoverSearch
              label="Project name"
              placeholder="Find project..."
              value={searchDraft}
              onChange={setSearchDraft}
              onEnter={() => {
                setSearch(searchDraft.trim());
                closeFilter();
              }}
            />
          </ChipFilter>
        </div>
        {filtersApplied ? <ClearFiltersButton onClick={clearFilters} /> : null}
      </div>
      {statusMutation.error ? (
        <p role="alert" className="text-error-fg px-5 py-3 text-sm">
          {statusMutation.error.message}
        </p>
      ) : null}
      {projects.isPending ? (
        <Loading label="Loading projects…" />
      ) : projects.error ? (
        <ErrorState message={projects.error.message} onRetry={() => void projects.refetch()} />
      ) : sorted.length === 0 ? (
        <EmptyState
          title="No projects found"
          description="Try different filters or keywords to find the projects you are looking for."
          action={
            manage ? (
              <Button
                variant="outline"
                icon={<Plus size={14} strokeWidth={1.5} />}
                onClick={() => openEditor("new")}
              >
                New project
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="relative overflow-x-auto">
          <table className="data-table min-w-[720px] table-fixed">
            <colgroup>
              <col className="w-[50px]" />
              <col className="w-[34.75%]" />
              <col className="w-[13.9%]" />
              <col className="w-[14.6%]" />
              <col className="w-[13.4%]" />
              <col />
              <col className="w-[50px]" />
            </colgroup>
            <thead>
              {manage && selected.length > 0 ? (
                <BulkBar
                  count={selected.length}
                  noun="item"
                  columns={7}
                  onClear={() => setSelection(new Set())}
                  actions={[
                    ...(selectedActive.length > 0
                      ? [
                          {
                            label: "Archive",
                            icon: <Archive size={14} strokeWidth={1.5} />,
                            disabled: statusMutation.isPending,
                            onSelect: () =>
                              statusMutation.mutate({ items: selectedActive, next: "archive" }),
                          },
                        ]
                      : []),
                    ...(selectedArchived.length > 0
                      ? [
                          {
                            label: "Restore",
                            icon: <RotateCcw size={14} strokeWidth={1.5} />,
                            disabled: statusMutation.isPending,
                            onSelect: () =>
                              statusMutation.mutate({
                                items: selectedArchived,
                                next: "reactivate",
                              }),
                          },
                        ]
                      : []),
                  ]}
                />
              ) : null}
              <tr>
                <th scope="col" className="w-[50px]">
                  <span className="sr-only">Start timer</span>
                </th>
                <th scope="col" className="cursor-default whitespace-normal">
                  <div className="flex items-center">
                    {manage ? (
                      <span className="mr-[7px] -ml-2.5 grid h-9 w-7 place-items-center">
                        <Checkbox
                          aria-label="Select all projects"
                          checked={allSelected}
                          indeterminate={selected.length > 0 && !allSelected}
                          onChange={() =>
                            setSelection(
                              allSelected
                                ? new Set()
                                : new Set(sorted.map((project) => project.id)),
                            )
                          }
                        />
                      </span>
                    ) : null}
                    <SortHeader
                      label="Project"
                      direction={directionFor("name")}
                      onToggle={() => toggleSort("name")}
                    />
                  </div>
                </th>
                <th scope="col" className="cursor-default whitespace-normal">
                  <SortHeader
                    label="Client"
                    direction={directionFor("client")}
                    onToggle={() => toggleSort("client")}
                  />
                </th>
                <th scope="col" className="cursor-default whitespace-normal">
                  Billable
                </th>
                <th scope="col" className="cursor-default whitespace-normal">
                  <SortHeader
                    label="Time status"
                    direction={directionFor("tracked")}
                    onToggle={() => toggleSort("tracked")}
                  />
                </th>
                <th scope="col" className="cursor-default whitespace-normal">
                  Team
                </th>
                <th scope="col" className="w-[50px]">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((project) => {
                const budgetMs = (project.budget_minutes ?? 0) * 60_000;
                const assignedIds = parseMemberIds(project.member_ids_json);
                const assignedNames = assignedIds.map((id) => memberNames.get(id)).filter(Boolean);
                const archived = project.status === "archived";
                return (
                  <tr key={project.id} className="group/row">
                    <td className="w-[50px] pr-2.5 pl-5">
                      {!archived ? (
                        <button
                          type="button"
                          aria-label={`Start timer for ${project.name}`}
                          disabled={startMutation.isPending}
                          className="bg-accent text-surface hover:bg-accent-hover grid size-4 place-items-center rounded-full opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                          onClick={() => startMutation.mutate(project)}
                        >
                          <StartGlyph />
                        </button>
                      ) : null}
                    </td>
                    <td>
                      <div className="flex items-center">
                        {manage ? (
                          <span className="mr-[7px] -ml-2.5 grid h-9 w-7 place-items-center">
                            <Checkbox
                              aria-label={`Select ${project.name}`}
                              checked={selection.has(project.id)}
                              className="opacity-0 group-hover/row:opacity-100 checked:opacity-100 focus-visible:opacity-100"
                              onChange={() => toggleSelected(project.id)}
                            />
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className="max-w-72 truncate text-left font-medium hover:underline disabled:no-underline"
                          style={{ color: projectPageNameColor(project.color) }}
                          disabled={!manage}
                          onClick={() => openEditor(project)}
                        >
                          {project.name}
                        </button>
                      </div>
                    </td>
                    <td className="text-fg">{project.client_name}</td>
                    <td className="text-fg-subtle">{project.billable_default ? "Yes" : "No"}</td>
                    <td className="text-fg-subtle tabular-nums">
                      {formatDuration(project.tracked_ms ?? 0)}
                      {budgetMs > 0 ? (
                        <span className="ml-1">
                          / {formatDuration(budgetMs)} (
                          {Math.round(((project.tracked_ms ?? 0) / budgetMs) * 100)}%)
                        </span>
                      ) : null}
                    </td>
                    <td className="leading-[normal]">
                      {project.visibility === "assigned" ? (
                        <span className="block max-w-[215px] truncate font-bold">
                          {assignedNames.length > 0
                            ? assignedNames.join(", ")
                            : `${assignedIds.length} ${assignedIds.length === 1 ? "member" : "members"}`}
                        </span>
                      ) : (
                        <span className="italic">Everyone</span>
                      )}
                    </td>
                    <td className="w-[50px] pr-0 pl-2.5">
                      <div className="opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100">
                        <RowMenu
                          label={`Actions for ${project.name}`}
                          menuClassName="w-[133px]"
                          items={
                            manage
                              ? [
                                  {
                                    label: "Edit project",
                                    onSelect: () => openEditor(project),
                                  },
                                  {
                                    label: "Add member",
                                    onSelect: () => openEditor(project, "members"),
                                  },
                                  // Toggl groups the archive/delete actions behind a divider.
                                  ...(!archived
                                    ? [
                                        {
                                          label: "Archive",
                                          separatorBefore: true,
                                          disabled: statusMutation.isPending,
                                          onSelect: () =>
                                            statusMutation.mutate({
                                              items: [project],
                                              next: "archive",
                                            }),
                                        },
                                      ]
                                    : [
                                        {
                                          label: "Restore",
                                          separatorBefore: true,
                                          disabled: statusMutation.isPending,
                                          onSelect: () =>
                                            statusMutation.mutate({
                                              items: [project],
                                              next: "reactivate",
                                            }),
                                        },
                                      ]),
                                ]
                              : []
                          }
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ProjectEditor
        key={`${editing === "new" ? "new" : (editing?.id ?? "closed")}:${editorSection}`}
        open={editing !== null}
        project={editing === "new" ? null : editing}
        initialSection={editorSection}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </>
  );
}

function ClientFilterBody({
  clients,
  selected,
  onChange,
}: {
  clients: Client[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [query, setQuery] = useState("");
  const options = clients
    .filter((client) => client.name.toLowerCase().includes(query.trim().toLowerCase()))
    .map((client) => ({ value: client.id, label: client.name }));
  return (
    <>
      <PopoverSearch
        label="Find client"
        placeholder="Find client..."
        value={query}
        onChange={setQuery}
      />
      <ChecklistPopoverBody
        title="Client"
        options={options}
        selected={selected}
        onChange={onChange}
      />
    </>
  );
}

function MemberFilterBody({
  members,
  selected,
  onChange,
}: {
  members: Member[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [query, setQuery] = useState("");
  const options = members
    .filter((member) => member.display_name.toLowerCase().includes(query.trim().toLowerCase()))
    .map((member) => ({ value: member.id, label: member.display_name }));
  return (
    <>
      <PopoverSearch
        label="Find members"
        placeholder="Find members..."
        value={query}
        onChange={setQuery}
      />
      <ChecklistPopoverBody
        title="Members"
        options={options}
        selected={selected}
        onChange={onChange}
      />
    </>
  );
}

function StatusFilter({
  label,
  open,
  onToggle,
  onClose,
  statuses,
  onChange,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  statuses: ReadonlySet<Status>;
  onChange: (next: ReadonlySet<Status>) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label="Filter projects by status"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="border-control bg-surface text-fg box-border flex h-[38px] shrink-0 items-center rounded-lg border px-3 text-left text-sm leading-5 font-medium"
        onClick={onToggle}
      >
        <span>
          <span className="text-fg-subtle mr-1">Show</span>
          {label}
        </span>
        <svg
          width="8"
          height="5"
          viewBox="0 0 8 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="text-fg-subtle ml-1 shrink-0"
        >
          <path d="M1 1l3 3 3-3" />
        </svg>
      </button>
      {open ? (
        <FilterPopover
          anchor={anchor}
          label="Project status"
          onClose={onClose}
          className="w-[292px] px-[2.5px] pb-1.5"
        >
          {STATUS_OPTIONS.map((option) => {
            const checked = statuses.has(option.value);
            return (
              <label
                key={option.value}
                className={twMerge(
                  "hover:bg-surface-hover flex h-[30px] cursor-pointer items-center gap-2.5 rounded-lg px-2.5",
                  checked && "bg-surface-hover",
                )}
              >
                <Checkbox
                  checked={checked}
                  onChange={() => {
                    // At least one status stays selected, like Toggl's multi-select.
                    if (checked && statuses.size === 1) return;
                    const next = new Set(statuses);
                    if (checked) next.delete(option.value);
                    else next.add(option.value);
                    onChange(next);
                  }}
                />
                {option.label}
              </label>
            );
          })}
        </FilterPopover>
      ) : null}
    </>
  );
}
