import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BriefcaseBusiness,
  Check,
  CircleDollarSign,
  Play,
  Search,
  Square,
  Tags,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useMe } from "@/web/app/context";
import { useNow } from "@/web/hooks/use-now";
import { apiRequest, idempotencyKey } from "@/web/lib/api";
import { formatDuration } from "@/web/lib/format";
import { broadcastTimerChange } from "@/web/lib/timer";
import type { Project, Tag, TimeEntry } from "@/web/types";

interface RecentTime {
  description: string;
  project_id: string | null;
  project_name: string | null;
  client_name: string | null;
}

export function GlobalTimerBar() {
  const me = useMe();
  const queryClient = useQueryClient();
  const now = useNow();
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [billable, setBillable] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const projects = useQuery({
    queryKey: ["projects", "active"],
    queryFn: () => apiRequest<{ projects: Project[] }>("/projects?status=active"),
  });
  const tags = useQuery({
    queryKey: ["tags", "active"],
    queryFn: () => apiRequest<{ tags: Tag[] }>("/tags?status=active"),
  });
  const recent = useQuery({
    queryKey: ["recent-time"],
    queryFn: () => apiRequest<{ recent: RecentTime[] }>("/me/recent"),
  });
  const timer = useQuery({
    queryKey: ["timer"],
    queryFn: () => apiRequest<{ entry: TimeEntry | null; server_now: string }>("/timer"),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const activeTimer = timer.data?.entry ?? null;

  const refreshTimerSurfaces = async () => {
    broadcastTimerChange();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["timer"] }),
      queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
      queryClient.invalidateQueries({ queryKey: ["calendar"] }),
      queryClient.invalidateQueries({ queryKey: ["reports"] }),
      queryClient.invalidateQueries({ queryKey: ["recent-time"] }),
    ]);
  };
  const startMutation = useMutation({
    mutationFn: () =>
      apiRequest("/timer/start", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({
          description,
          project_id: projectId || null,
          tag_ids: selectedTags,
          billable,
        }),
      }),
    onSuccess: async () => {
      setDescription("");
      await refreshTimerSurfaces();
    },
    onError: refreshTimerSurfaces,
  });
  const stopMutation = useMutation({
    mutationFn: () =>
      apiRequest("/timer/stop", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: "{}",
      }),
    onSuccess: refreshTimerSurfaces,
    onError: refreshTimerSurfaces,
  });

  const selectedProject = projects.data?.projects.find(
    (project) => project.id === (activeTimer?.project?.id ?? projectId),
  );
  const timerError = startMutation.error ?? stopMutation.error;

  return (
    <header className="global-timer sticky top-0 z-20 border-b border-white/10 bg-[#111710]/97 pr-3 pl-14 backdrop-blur md:px-5">
      <div className="mx-auto flex h-[72px] max-w-[1800px] items-center gap-2">
        <div className="min-w-0 flex-1">
          <input
            value={activeTimer?.description ?? description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={Boolean(activeTimer)}
            list="recent-time-descriptions"
            placeholder="What are you working on?"
            aria-label="Timer description"
            className="h-12 w-full border-0 bg-transparent px-1 text-lg font-medium text-slate-100 outline-none placeholder:text-slate-500 disabled:opacity-90"
          />
          <datalist id="recent-time-descriptions">
            {(recent.data?.recent ?? []).map((item) => (
              <option key={`${item.description}:${item.project_id ?? ""}`} value={item.description}>
                {[item.client_name, item.project_name].filter(Boolean).join(" · ")}
              </option>
            ))}
          </datalist>
          {timerError ? (
            <p className="absolute bottom-1 max-w-[55vw] truncate text-[11px] text-red-300">
              {timerError.message}
            </p>
          ) : null}
        </div>

        <ProjectPicker
          projects={projects.data?.projects ?? []}
          value={activeTimer?.project?.id ?? projectId}
          disabled={Boolean(activeTimer)}
          onChange={(value) => {
            setProjectId(value);
            const project = projects.data?.projects.find((item) => item.id === value);
            setBillable(project?.billable_default === true || project?.billable_default === 1);
          }}
        />
        <TagPicker
          tags={tags.data?.tags ?? []}
          value={activeTimer ? activeTimer.tags.map((tag) => tag.id) : selectedTags}
          disabled={Boolean(activeTimer)}
          onChange={setSelectedTags}
        />
        {me.workspace.members_can_set_billable ? (
          <button
            type="button"
            className={`timer-tool hidden sm:grid ${
              activeTimer?.billable || billable
                ? "bg-frosted-mint-900 text-light-green-400"
                : "text-slate-500"
            }`}
            aria-label={billable ? "Mark non-billable" : "Mark billable"}
            aria-pressed={activeTimer?.billable ?? billable}
            disabled={Boolean(activeTimer)}
            onClick={() => setBillable((value) => !value)}
          >
            <CircleDollarSign size={19} />
          </button>
        ) : null}
        <div className="hidden min-w-24 text-right font-mono text-lg font-bold text-slate-200 sm:block">
          {activeTimer
            ? formatDuration(now - new Date(activeTimer.started_at).getTime(), true)
            : "00:00:00"}
          {selectedProject ? (
            <span className="text-frosted-mint-300 mt-0.5 block max-w-24 truncate text-[10px] font-medium">
              {selectedProject.name}
            </span>
          ) : null}
        </div>
        {activeTimer ? (
          <button
            type="button"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-red-500 text-white shadow-[0_0_0_5px_rgb(239_68_68_/_0.14)] transition hover:bg-red-400"
            onClick={() => stopMutation.mutate()}
            disabled={stopMutation.isPending}
            aria-label="Stop timer"
          >
            <Square size={17} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            className="bg-light-green-500 text-light-green-950 hover:bg-light-green-400 shadow-light-green-500/15 grid h-12 w-12 shrink-0 place-items-center rounded-full shadow-[0_0_0_5px] transition"
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            aria-label="Start timer"
          >
            <Play className="ml-0.5" size={21} fill="currentColor" />
          </button>
        )}
      </div>
    </header>
  );
}

function ProjectPicker({
  projects,
  value,
  disabled,
  onChange,
}: {
  projects: Project[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useDismissPopover(root, () => setOpen(false));
  const selected = projects.find((project) => project.id === value);
  const grouped = useMemo(() => {
    const result = new Map<string, Project[]>();
    for (const project of projects) {
      if (
        search &&
        !`${project.name} ${project.client_name}`.toLowerCase().includes(search.toLowerCase())
      ) {
        continue;
      }
      result.set(project.client_name || "No client", [
        ...(result.get(project.client_name || "No client") ?? []),
        project,
      ]);
    }
    return [...result.entries()];
  }, [projects, search]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className={`timer-tool ${selected ? "text-frosted-mint-300" : "text-slate-500"}`}
        disabled={disabled}
        aria-label={selected ? `Project: ${selected.name}` : "Choose project"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <BriefcaseBusiness size={19} />
      </button>
      {open ? (
        <div className="timer-popover absolute top-12 right-0 w-[min(88vw,360px)]">
          <div className="relative border-b border-white/10 p-2">
            <Search className="absolute top-4 left-4 text-slate-500" size={15} />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-full rounded-md border border-white/15 bg-[#0d120c] pr-3 pl-9 text-sm text-slate-100 outline-none placeholder:text-slate-600"
              placeholder="Search projects or clients"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5">
            <PickerOption
              label="No project"
              active={!value}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            />
            {grouped.map(([client, clientProjects]) => (
              <div key={client} className="mt-2 first:mt-1">
                <p className="px-2 py-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                  {client}
                </p>
                {clientProjects.map((project) => (
                  <PickerOption
                    key={project.id}
                    label={project.name}
                    active={project.id === value}
                    color={project.color}
                    onClick={() => {
                      onChange(project.id);
                      setOpen(false);
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TagPicker({
  tags,
  value,
  disabled,
  onChange,
}: {
  tags: Tag[];
  value: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useDismissPopover(root, () => setOpen(false));
  const visible = tags.filter((tag) => tag.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className={`timer-tool ${value.length ? "text-light-green-400" : "text-slate-500"}`}
        disabled={disabled}
        aria-label={value.length ? `${value.length} timer tags selected` : "Choose timer tags"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Tags size={19} />
        {value.length ? (
          <span className="bg-light-green-500 text-light-green-950 absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold">
            {value.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="timer-popover absolute top-12 right-0 w-[min(82vw,280px)]">
          <div className="relative border-b border-white/10 p-2">
            <Search className="absolute top-4 left-4 text-slate-500" size={15} />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9 w-full rounded-md border border-white/15 bg-[#0d120c] pr-8 pl-9 text-sm text-slate-100 outline-none placeholder:text-slate-600"
              placeholder="Filter tags"
            />
            {search ? (
              <button
                type="button"
                className="absolute top-3.5 right-4 text-slate-500 hover:text-slate-200"
                onClick={() => setSearch("")}
                aria-label="Clear tag search"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {visible.length ? (
              visible.map((tag) => {
                const active = value.includes(tag.id);
                return (
                  <button
                    type="button"
                    key={tag.id}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-slate-300 hover:bg-white/8 hover:text-white"
                    onClick={() =>
                      onChange(
                        active ? value.filter((tagId) => tagId !== tag.id) : [...value, tag.id],
                      )
                    }
                  >
                    <span
                      className="grid h-4 w-4 place-items-center rounded border"
                      style={{ borderColor: tag.color, backgroundColor: active ? tag.color : "" }}
                    >
                      {active ? <Check size={11} className="text-white" /> : null}
                    </span>
                    {tag.name}
                  </button>
                );
              })
            ) : (
              <p className="p-4 text-center text-sm text-slate-500">No matching tags</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PickerOption({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
        active
          ? "bg-frosted-mint-900 text-frosted-mint-200"
          : "text-slate-300 hover:bg-white/8 hover:text-white"
      }`}
      onClick={onClick}
    >
      <span
        className="h-2 w-2 rounded-full bg-slate-600"
        style={color ? { backgroundColor: color } : undefined}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active ? <Check size={14} /> : null}
    </button>
  );
}

function useDismissPopover(root: React.RefObject<HTMLDivElement | null>, dismiss: () => void) {
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) dismiss();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [dismiss, root]);
}
