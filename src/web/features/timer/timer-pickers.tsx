import { Checkbox } from "@/web/components/checkbox";

import { useInRouterContext, useNavigate } from "react-router";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  ClearGlyph,
  DollarGlyph,
  FolderGlyph,
  PlusGlyph,
  SearchGlyph,
  TagGlyph,
} from "@/web/features/timer/timer-glyphs";
import {
  projectChipBackground,
  projectPickerTextColor,
  projectTextColor,
} from "@/web/features/timer/project-tint";
import {
  useDismissPopover,
  useEscapeToClose,
  useRestoreFocus,
} from "@/web/features/timer/use-dismiss-popover";
import type { Project, Tag } from "@/web/types";

export type ProjectChoice = Pick<
  Project,
  "id" | "name" | "color" | "client_name" | "billable_default"
>;

const NO_CLIENT = "No client";

export function hasClient(clientName: string | null | undefined): clientName is string {
  return Boolean(clientName && clientName !== NO_CLIENT);
}

export function matchesProjectSearch(project: ProjectChoice, search: string): boolean {
  if (!search) return true;
  return `${project.name} ${project.client_name}`.toLowerCase().includes(search.toLowerCase());
}

/** Client groups in Toggl's order: "No Client" first, then alphabetical; projects alphabetical. */
export function groupProjectsByClient(projects: ProjectChoice[]): Array<[string, ProjectChoice[]]> {
  const groups = new Map<string, ProjectChoice[]>();
  for (const project of projects) {
    const client = project.client_name || NO_CLIENT;
    groups.set(client, [...(groups.get(client) ?? []), project]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === NO_CLIENT) return -1;
      if (right === NO_CLIENT) return 1;
      return left.localeCompare(right);
    })
    .map(([client, items]) => [client, items.sort((a, b) => a.name.localeCompare(b.name))]);
}

/** 8px project dot. */
export function ProjectDot({ color, className = "" }: { color: string; className?: string }) {
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

/** Project name in its lightened project colour. */
export function ProjectName({
  project,
  className = "",
}: {
  project: ProjectChoice;
  className?: string;
}) {
  return (
    <span
      className={`truncate ${className}`}
      style={{ color: projectPickerTextColor(project.color) }}
    >
      {project.name}
    </span>
  );
}

/** 30px search field: inset grey ring, no outline (Toggl). */
export function PopoverSearch({
  value,
  onChange,
  placeholder,
  label,
  onKeyDown,
  clearLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  clearLabel: string;
}) {
  return (
    <div className="timer-search bg-surface flex h-[30px] min-w-0 flex-1 items-center rounded-lg pl-3">
      <SearchGlyph className="text-fg-muted shrink-0" />
      <input
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="text-fg caret-accent-fg placeholder:text-fg-muted ml-2 h-[30px] min-w-0 flex-1 bg-transparent text-sm leading-[normal] font-medium outline-none"
        placeholder={placeholder}
        aria-label={label}
      />
      {value ? (
        <button
          type="button"
          className="text-fg-muted hover:text-fg grid h-[30px] w-[30px] shrink-0 place-items-center"
          onClick={() => onChange("")}
          aria-label={clearLabel}
        >
          <ClearGlyph />
        </button>
      ) : null}
    </div>
  );
}

export function PickerHeading({ children }: { children: ReactNode }) {
  return (
    <div className="h-[38px] px-[15px] pt-5">
      <h2 className="text-fg text-[11px] leading-[14px] font-semibold tracking-[0.4px] uppercase">
        {children}
      </h2>
    </div>
  );
}

/** 36px row wrapper with the 34px, radius 8 button inside (hover/selected #3a3a3a). */
export function PickerRow({
  children,
  selected = false,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <div className="py-px pr-[3px] pl-1.5">
      <button
        type="button"
        data-picker-row
        aria-label={label}
        aria-current={selected ? "true" : undefined}
        disabled={disabled}
        className={`timer-row text-fg hover:bg-surface-hover flex h-[34px] w-full items-center gap-[11px] rounded-lg px-2.5 text-start text-sm leading-[30px] font-medium ${
          selected ? "bg-surface-hover" : ""
        }`}
        onClick={onClick}
      >
        {children}
      </button>
    </div>
  );
}

export function PickerFooterButton({
  children,
  onClick,
  disabled,
  title,
  muted,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className={`timer-row border-surface-raised flex h-[35px] w-full items-center justify-center gap-2 rounded-b-lg border-t px-[5px] py-[7px] text-start text-sm leading-4 font-medium ${
        muted ? "text-fg-soft" : "text-fg hover:bg-surface-hover"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Arrow keys move focus between the search field and the option rows of a picker popover. */
function useRowArrowNavigation(
  list: RefObject<HTMLElement | null>,
  search: RefObject<HTMLElement | null>,
) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [
      ...(list.current?.querySelectorAll<HTMLElement>("[data-picker-row]:not(:disabled)") ?? []),
    ];
    if (!rows.length) return;
    const index = rows.findIndex((row) => row === document.activeElement);
    event.preventDefault();
    if (event.key === "ArrowDown") {
      rows[Math.min(index + 1, rows.length - 1)]?.focus();
    } else if (index <= 0) {
      (search.current?.querySelector("input") as HTMLElement | null)?.focus();
    } else {
      rows[index - 1]?.focus();
    }
  };
}

export function CreateProjectFooter() {
  const insideRouter = useInRouterContext();
  return insideRouter ? <RoutedCreateProject /> : <CreateProjectLabel />;
}

function RoutedCreateProject() {
  const navigate = useNavigate();
  return (
    <PickerFooterButton onClick={() => void navigate("/projects")}>
      <CreateProjectLabelContent />
    </PickerFooterButton>
  );
}

function CreateProjectLabel() {
  return (
    <PickerFooterButton onClick={() => window.location.assign("/projects")}>
      <CreateProjectLabelContent />
    </PickerFooterButton>
  );
}

function CreateProjectLabelContent() {
  return (
    <>
      <PlusGlyph className="shrink-0" />
      <span>Create a new project</span>
    </>
  );
}

export function ProjectPicker({
  projects,
  value,
  disabled,
  canCreate,
  onChange,
}: {
  projects: ProjectChoice[];
  value: string;
  disabled: boolean;
  canCreate: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const searchRow = useRef<HTMLDivElement>(null);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const requestClose = (shouldRestore: boolean) => {
    setRestoreFocus(shouldRestore);
    setOpen(false);
  };
  useDismissPopover(root, () => requestClose(false), undefined, open);
  useEscapeToClose(open, () => requestClose(true));
  useRestoreFocus(open, trigger, restoreFocus, () => setRestoreFocus(false));
  useEffect(() => {
    if (open) setSearch("");
  }, [open]);
  const onArrow = useRowArrowNavigation(list, searchRow);
  const selected = projects.find((project) => project.id === value);
  const selectedLabel = selected
    ? hasClient(selected.client_name)
      ? `${selected.name} • ${selected.client_name}`
      : selected.name
    : null;
  const grouped = useMemo(
    () =>
      groupProjectsByClient(projects.filter((project) => matchesProjectSearch(project, search))),
    [projects, search],
  );

  return (
    <div
      ref={root}
      className={`relative min-w-0 ${selected ? "shrink basis-full sm:basis-auto" : "shrink-0"} sm:px-[5px]`}
    >
      <button
        ref={trigger}
        type="button"
        className={`${selected ? "timer-project-chip" : "timer-tool grid"} ${selected ? "" : "timer-tip"}`}
        data-tip={selected ? undefined : "Add a project, task or client"}
        style={
          selected
            ? {
                color: projectTextColor(selected.color),
                backgroundColor: projectChipBackground(selected.color),
              }
            : undefined
        }
        disabled={disabled}
        aria-label={selected ? `Project: ${selectedLabel}` : "Choose project"}
        title={selectedLabel ?? undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        {selected ? (
          <>
            <ProjectDot color={selected.color} />
            <span className="min-w-0 truncate text-start text-sm font-medium">
              <span>{selected.name}</span>
              {hasClient(selected.client_name) ? (
                <span className="text-fg-subtle font-medium"> • {selected.client_name}</span>
              ) : null}
            </span>
          </>
        ) : (
          <FolderGlyph />
        )}
      </button>
      {open ? (
        <div
          className="timer-popover absolute top-[calc(100%+5px)] right-[5px] z-50 w-[min(88vw,360px)] pt-[5px]"
          onKeyDown={onArrow}
        >
          <div
            ref={searchRow}
            className="border-surface-raised mt-2 flex h-[47px] items-start border-b px-[15px] pt-[3px]"
          >
            <PopoverSearch
              value={search}
              onChange={setSearch}
              placeholder="Search by project, task or client"
              label="Search projects or clients"
              clearLabel="Clear project search"
            />
          </div>
          <div
            ref={list}
            className="mt-3 ml-px max-h-[324px] [scrollbar-gutter:stable] overflow-y-auto"
          >
            {!search ? (
              <PickerRow
                label="No project"
                selected={!value}
                disabled={disabled}
                onClick={() => {
                  onChange("");
                  requestClose(true);
                }}
              >
                <span className="bg-fg-subtle h-2 w-2 shrink-0 rounded-full" aria-hidden="true" />
                <span className={!value ? "text-[#b7b7b7]" : ""}>No Project</span>
              </PickerRow>
            ) : null}
            {grouped.length ? (
              grouped.map(([client, clientProjects]) => (
                <div key={client}>
                  <PickerHeading>{client === NO_CLIENT ? "No Client" : client}</PickerHeading>
                  {clientProjects.map((project) => (
                    <PickerRow
                      key={project.id}
                      label={project.name}
                      selected={project.id === value}
                      disabled={disabled}
                      onClick={() => {
                        if (project.id !== value) onChange(project.id);
                        requestClose(true);
                      }}
                    >
                      <ProjectDot color={project.color} />
                      <ProjectName project={project} />
                      {hasClient(project.client_name) ? (
                        <span className="text-fg-subtle truncate">{project.client_name}</span>
                      ) : null}
                    </PickerRow>
                  ))}
                </div>
              ))
            ) : (
              <div className="grid gap-3 p-[15px]">
                <div className="grid gap-3 py-[5px]">
                  <strong className="text-fg-soft text-center text-sm font-semibold">
                    No matching items
                  </strong>
                  <span className="text-fg-soft text-sm font-medium">
                    {canCreate
                      ? "Try a different search, or create a new project below."
                      : "Try a different search."}
                  </span>
                </div>
              </div>
            )}
          </div>
          {canCreate ? <CreateProjectFooter /> : null}
        </div>
      ) : null}
    </div>
  );
}

export function TagPicker({
  tags,
  value,
  disabled,
  canCreate,
  onChange,
  onCreate,
}: {
  tags: Tag[];
  value: string[];
  disabled: boolean;
  canCreate: boolean;
  onChange: (value: string[]) => void;
  onCreate: (name: string) => Promise<Tag>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const searchRow = useRef<HTMLDivElement>(null);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const requestClose = (shouldRestore: boolean) => {
    setRestoreFocus(shouldRestore);
    setOpen(false);
  };
  useDismissPopover(root, () => requestClose(false), undefined, open);
  useEscapeToClose(open, () => requestClose(true));
  useRestoreFocus(open, trigger, restoreFocus, () => setRestoreFocus(false));
  useEffect(() => {
    if (open) {
      setSearch("");
      setCreateError(null);
    }
  }, [open]);
  const onArrow = useRowArrowNavigation(list, searchRow);
  const needle = search.trim().toLowerCase();
  const visible = tags
    .filter((tag) => tag.name.toLowerCase().includes(needle))
    .sort(
      (left, right) =>
        Number(value.includes(right.id)) - Number(value.includes(left.id)) ||
        left.name.localeCompare(right.name),
    );
  const exactExists = tags.some((tag) => tag.name.toLowerCase() === needle);
  const createName = search.trim();
  const createDisabled = !canCreate || disabled || creating || !createName || exactExists;

  const createTag = async () => {
    if (createDisabled) return;
    setCreating(true);
    setCreateError(null);
    try {
      const tag = await onCreate(createName);
      onChange([...value, tag.id]);
      setSearch("");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "The tag could not be created.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div ref={root} className="relative shrink-0 sm:px-[5px]">
      <button
        ref={trigger}
        type="button"
        className={`timer-tool timer-tip grid ${value.length ? "timer-tool-active" : ""}`}
        data-tip="Select tags"
        disabled={disabled}
        aria-label={value.length ? `${value.length} timer tags selected` : "Choose timer tags"}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        <TagGlyph className="translate-y-px" />
      </button>
      {open ? (
        <div
          className="timer-popover absolute top-[calc(100%+5px)] right-0 z-50 w-[min(82vw,240px)] py-[5px] sm:top-[calc(100%+26px)] sm:-right-[50px]"
          onKeyDown={onArrow}
        >
          <div ref={searchRow} className="flex px-[15px] py-2.5">
            <PopoverSearch
              value={search}
              onChange={(next) => {
                setSearch(next);
                setCreateError(null);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !createDisabled &&
                  (visible.length === 0 || event.ctrlKey)
                ) {
                  event.preventDefault();
                  void createTag();
                }
              }}
              placeholder="Add/filter tags"
              label="Search timer tags"
              clearLabel="Clear tag search"
            />
          </div>
          <div ref={list} className="mx-[5px] h-[231px] overflow-y-auto">
            {visible.length ? (
              visible.map((tag) => {
                const active = value.includes(tag.id);
                return (
                  <label
                    key={tag.id}
                    className="timer-row text-fg hover:bg-surface-hover flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-start text-sm leading-[30px] font-medium"
                  >
                    <Checkbox
                      data-picker-row
                      checked={active}
                      disabled={disabled}
                      onChange={() =>
                        onChange(
                          active ? value.filter((tagId) => tagId !== tag.id) : [...value, tag.id],
                        )
                      }
                    />
                    <span className="min-w-0 truncate">{tag.name}</span>
                  </label>
                );
              })
            ) : (
              <div className="text-fg-soft grid gap-[14px] px-4 pt-[3px] text-sm leading-[21px]">
                <p className="font-semibold">No matching tags</p>
                <p>
                  {canCreate ? (
                    <>
                      Try a different keyword or press <span>Ctrl+Enter</span> to create a new tag.
                    </>
                  ) : (
                    "Try a different keyword."
                  )}
                </p>
              </div>
            )}
          </div>
          {createError ? (
            <p role="alert" className="text-error-fg px-[15px] py-1 text-xs">
              {createError}
            </p>
          ) : null}
          {canCreate ? (
            <PickerFooterButton
              muted={!createName}
              disabled={createDisabled}
              title={createName ? undefined : "Start typing to add a new tag"}
              onClick={() => void createTag()}
            >
              <PlusGlyph className={createName ? "text-accent-fg-hover shrink-0" : "shrink-0"} />
              <span>{createName ? `Create "${createName}" tag` : "Create tag"}</span>
            </PickerFooterButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function BillableButton({
  active,
  disabled,
  onToggle,
}: {
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`timer-tool timer-tip hidden sm:ml-[5px] sm:grid ${active ? "timer-tool-active" : ""}`}
      data-tip={active ? "Billable" : "Non-billable"}
      aria-label={active ? "Mark non-billable" : "Mark billable"}
      aria-pressed={active}
      disabled={disabled}
      onClick={onToggle}
    >
      <DollarGlyph />
    </button>
  );
}
