import {
  AlignLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Folder,
  Plus,
  Search,
  Tag as TagIcon,
  Timer,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { Checkbox } from "@/web/components/checkbox";
import { useDismissPopover, useEscapeToClose } from "@/web/features/timer/use-dismiss-popover";
import type { Client, Member, Project, Tag } from "@/web/types";

export type ReportFilterKey =
  "member" | "client" | "project" | "tag" | "description" | "billable" | "running";
export type ReportFilterValue = {
  condition: "is" | "is_empty" | "is_active" | "is_archived" | "contains";
  values: string[];
  text?: string;
};
export type ReportFilters = Partial<Record<ReportFilterKey, ReportFilterValue>>;
export type ReportFilterBarProps = {
  filters: ReportFilters;
  onChange: (filters: ReportFilters) => void;
  dateControl: ReactNode;
  members: Member[];
  clients: Client[];
  projects: Project[];
  tags: Tag[];
  canViewTeam: boolean;
  currentMemberName: string;
  loading?: boolean;
};

const filtersList = [
  { key: "member", label: "Member" },
  { key: "client", label: "Client" },
  { key: "project", label: "Project" },
  { key: "tag", label: "Tag" },
  { key: "description", label: "Description" },
  { key: "billable", label: "Billable" },
  { key: "running", label: "Entry status" },
] as const;
const conditionLabels: Record<ReportFilterValue["condition"], string> = {
  is: "is",
  is_empty: "is empty",
  is_active: "is active",
  is_archived: "is archived",
  contains: "contains",
};
// Keyboard focus uses the global neutral ring (styles.css), so controls need no local focus class.
const focusClass = "";
/** Toggl's section label: 11/600 #999, uppercase, 0.04em tracking. */
const labelClass = "text-fg-subtle text-[11px] leading-4 font-semibold tracking-[0.04em] uppercase";

type ChoiceOption = { value: string; label: string };
function moveOptionFocus(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const options = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=option]"),
  );
  if (!options.length) return;
  event.preventDefault();
  const current = options.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
  options[next]?.focus();
}
function FilterChoice({
  label,
  value,
  options,
  open,
  onToggle,
  onSelect,
  compact = false,
}: {
  label: string;
  value: string;
  options: ChoiceOption[];
  open: boolean;
  onToggle: () => void;
  onSelect: (value: string) => void;
  compact?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLButtonElement>("[aria-selected=true]")?.focus();
  }, [open]);
  return (
    <div className="relative" data-filter-choice>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        id={`report-filter-${label.toLowerCase().replaceAll(" ", "-")}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            onToggle();
          }
        }}
        className={`text-fg box-border flex w-full items-center justify-between rounded-lg text-sm leading-5 font-medium ${compact ? "hover:bg-surface-hover h-7 gap-0 px-2 py-1" : "bg-surface h-9 px-3 py-2 shadow-[0_0_0_1px_var(--color-stroke-tertiary)]"}`}
      >
        {options.find((option) => option.value === value)?.label}
        {compact ? (
          <ChevronRight size={14} aria-hidden="true" />
        ) : (
          <ChevronDown size={14} className="text-fg-subtle" aria-hidden="true" />
        )}
      </button>
      {open ? (
        <div
          ref={list}
          role="listbox"
          aria-label={label}
          onKeyDown={moveOptionFocus}
          className={`timer-popover dark-surface absolute top-full right-0 z-10 mt-[5px] max-h-48 overflow-y-auto p-[5px] ${compact ? "w-36" : "left-0"}`}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              onClick={() => {
                onSelect(option.value);
                trigger.current?.focus();
              }}
              className={`hover:bg-surface-hover focus-visible:bg-surface-hover block h-[30px] w-full rounded-lg px-2.5 text-left text-sm font-medium ${value === option.value ? "bg-surface-hover" : ""}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ReportFilterBar({
  filters,
  onChange,
  dateControl,
  members,
  clients,
  projects,
  tags,
  canViewTeam,
  currentMemberName,
  loading = false,
}: ReportFilterBarProps) {
  const [hideInactive, setHideInactive] = useState(false);
  const [editing, setEditing] = useState<ReportFilterKey | "add" | null>(null);
  const [draft, setDraft] = useState<ReportFilterValue>({ condition: "is", values: [] });
  const [search, setSearch] = useState("");
  const [show, setShow] = useState("active");
  const [menu, setMenu] = useState<string | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const popover = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const buttons = useRef<Partial<Record<ReportFilterKey | "add", HTMLButtonElement | null>>>({});
  const close = () => {
    setEditing(null);
    setMenu(null);
    trigger.current?.focus();
  };
  useDismissPopover(popover, close, trigger, editing !== null);
  useEscapeToClose(editing !== null, () => {
    if (menu) {
      popover.current?.querySelector<HTMLButtonElement>("[aria-expanded=true]")?.focus();
      setMenu(null);
    } else close();
  });
  useEffect(() => {
    if (editing) popover.current?.focus();
  }, [editing]);

  useLayoutEffect(() => {
    if (!editing) return;
    trigger.current = buttons.current[editing] ?? null;
    const positionAtTrigger = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = editing === "add" ? 275 : 340;
      // Toggl aligns filter forms with the first filter chip, and the add menu with its button.
      const rowStart =
        editing === "add"
          ? bounds.left
          : Math.min(
              bounds.left,
              ...Object.entries(buttons.current)
                .filter(([key, element]) => key !== "add" && element)
                .flatMap(([, element]) => (element ? [element.getBoundingClientRect().left] : [])),
            );
      const next = {
        left: Math.max(8, Math.min(rowStart, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(bounds.bottom + 5, Math.max(8, window.innerHeight - 220))),
      };
      setPosition((current) =>
        current.left === next.left && current.top === next.top ? current : next,
      );
    };
    positionAtTrigger();
    window.addEventListener("resize", positionAtTrigger);
    window.addEventListener("scroll", positionAtTrigger, true);
    return () => {
      window.removeEventListener("resize", positionAtTrigger);
      window.removeEventListener("scroll", positionAtTrigger, true);
    };
  }, [editing, filters, draft]);

  const open = (key: ReportFilterKey | "add") => {
    setDraft(
      key === "add"
        ? { condition: "is", values: [] }
        : (filters[key] ?? {
            condition: key === "description" ? "contains" : "is",
            values: key === "billable" ? ["true"] : key === "running" ? ["false"] : [],
          }),
    );
    setSearch("");
    setShow("active");
    setMenu(null);
    setEditing(key);
  };
  const remove = (key: ReportFilterKey) => {
    const next = Object.fromEntries(
      Object.entries(filters).filter(
        ([filterKey]) => filterKey !== key && (key !== "client" || filterKey !== "project"),
      ),
    );
    if (filters[key]) onChange(next);
    if (editing === key) close();
  };
  const entities = {
    member: members.map((member) => ({
      id: member.id,
      name: member.display_name,
      status: member.status === "inactive" ? "archived" : member.status,
      color: "",
      client_name: "",
    })),
    client: clients.map((client) => ({ ...client, color: "", client_name: "" })),
    project: projects.filter(
      (project) =>
        filters.client?.condition !== "is" ||
        !filters.client.values.length ||
        filters.client.values.includes(project.client_id),
    ),
    tag: tags.map((tag) => ({ ...tag, client_name: "" })),
  };
  const activeMeta = filtersList.find((filter) => filter.key === editing);
  const entityKey =
    editing === "member" || editing === "client" || editing === "project" || editing === "tag"
      ? editing
      : null;
  const visibleOptions = entityKey
    ? entities[entityKey]
        .filter(
          (entity) =>
            `${entity.name} ${entity.client_name}`.toLowerCase().includes(search.toLowerCase()) &&
            (entityKey === "tag" || show === "both" || (entity.status ?? "active") === show),
        )
        .sort((a, b) => Number(draft.values.includes(b.id)) - Number(draft.values.includes(a.id)))
    : [];
  const choice = (
    name: string,
    value: string,
    options: ChoiceOption[],
    select: (value: string) => void,
  ) => (
    <FilterChoice
      label={name}
      value={value}
      options={options}
      compact={name === "Show"}
      open={menu === name}
      onToggle={() => setMenu(menu === name ? null : name)}
      onSelect={(value) => {
        select(value);
        setMenu(null);
      }}
    />
  );
  const conditions: ReportFilterValue["condition"][] =
    editing === "description"
      ? ["contains", "is", "is_empty"]
      : editing === "client" || editing === "project" || editing === "member"
        ? editing === "member"
          ? ["is", "is_active", "is_archived"]
          : ["is", "is_empty", "is_active", "is_archived"]
        : editing === "tag"
          ? ["is", "is_empty"]
          : ["is"];
  const needsValues = draft.condition === "is" && entityKey !== null;
  const needsText = editing === "description" && draft.condition !== "is_empty";
  const valid = needsText ? Boolean(draft.text?.trim()) : !needsValues || draft.values.length > 0;
  const apply = () => {
    if (!valid || !editing || editing === "add") return;
    const next = {
      ...filters,
      [editing]: {
        condition: draft.condition,
        values: entityKey && !needsValues ? [] : draft.values,
        ...(needsText ? { text: draft.text?.trim() } : {}),
      },
    };
    if (editing === "client") delete next.project;
    onChange(next);
    close();
  };
  const chipText = (key: ReportFilterKey) => {
    const filter = editing === key ? draft : filters[key];
    if (!filter) return "";
    if (filter.condition !== "is" && key !== "description")
      return conditionLabels[filter.condition];
    if (key === "description")
      return `${conditionLabels[filter.condition]}${filter.condition === "is_empty" ? "" : ` ${filter.text ?? ""}`}`;
    if (key === "billable")
      return `is ${filter.values[0] === "true" ? "Billable" : "Non-billable"}`;
    if (key === "running") return `is ${filter.values[0] === "true" ? "Running" : "Stopped"}`;
    const options = entities[key];
    if (!filter.values.length) return "is…";
    if (filter.values.length > 1) return `is one of ${filter.values.length} selections`;
    return `is ${options.find((option) => option.id === filter.values[0])?.name ?? "Selected"}`;
  };
  const available = filtersList.filter((filter) => filter.key !== "member" || canViewTeam);
  const ordered = [
    ...available.filter((filter) => filters[filter.key] || editing === filter.key),
    ...available.filter(
      (filter) =>
        !hideInactive &&
        !filters[filter.key] &&
        editing !== filter.key &&
        !["billable", "running"].includes(filter.key),
    ),
  ];
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Report filters">
      <div className="w-full max-w-[322px] shrink-0">{dateControl}</div>
      {!hideInactive ? (
        <>
          {!canViewTeam ? (
            <span
              className="text-fg-disabled flex h-9 items-center gap-1.5 px-3 text-sm leading-5 font-medium"
              title="Members can view their own time entries"
            >
              <FilterGlyph filterKey="member" disabled />
              <span className="truncate">
                <b className="font-semibold">Member</b> is {currentMemberName}
              </span>
            </span>
          ) : null}
          {ordered.map(({ key, label }) => {
            const isSet = Boolean(filters[key]) || editing === key;
            return (
              <div
                key={key}
                className={`flex h-9 max-w-full items-center rounded-lg ${isSet ? "bg-accent-muted text-accent-fg hover:bg-accent-muted-hover" : "text-fg hover:text-[#d5d5d5]"}`}
              >
                <button
                  ref={(element) => {
                    buttons.current[key] = element;
                  }}
                  type="button"
                  disabled={loading}
                  aria-label={`${label}${isSet ? `: ${chipText(key)}` : ""}`}
                  aria-haspopup="dialog"
                  aria-expanded={editing === key}
                  onClick={() => (editing === key ? close() : open(key))}
                  className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg px-3 text-start text-sm leading-5 ${focusClass}`}
                >
                  <FilterGlyph filterKey={key} active={isSet} />
                  <span className="max-w-48 truncate pr-1">
                    <b className="font-semibold">{label}</b>
                    {isSet ? <span className="font-medium"> {chipText(key)}</span> : null}
                  </span>
                </button>
                {isSet ? (
                  <button
                    type="button"
                    aria-label={`Remove ${label} filter`}
                    onClick={() => remove(key)}
                    className={`hover:bg-accent-muted-active mr-1 -ml-2 grid h-6 w-7 place-items-center rounded-lg ${focusClass}`}
                  >
                    <X size={12} strokeWidth={2.4} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            );
          })}
          <button
            ref={(element) => {
              buttons.current.add = element;
            }}
            type="button"
            disabled={loading}
            aria-haspopup="dialog"
            aria-expanded={editing === "add"}
            onClick={() => (editing === "add" ? close() : open("add"))}
            className={`text-fg ml-2 box-border flex h-9 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm leading-5 font-semibold hover:text-[#d5d5d5] ${focusClass}`}
          >
            <Plus size={14} strokeWidth={2.5} aria-hidden="true" /> Add filter
          </button>
        </>
      ) : null}
      {hideInactive || available.some((filter) => filters[filter.key]) ? (
        <button
          type="button"
          aria-label={
            hideInactive
              ? `Show ${available.filter((filter) => filters[filter.key]).length + (canViewTeam ? 0 : 1)} filters`
              : "Hide filters"
          }
          onClick={() => {
            close();
            setHideInactive(!hideInactive);
          }}
          className={`text-fg-subtle hover:bg-surface-hover hover:text-fg flex h-9 items-center gap-1 rounded-lg px-2 text-xs ${focusClass}`}
        >
          {hideInactive
            ? `Show ${available.filter((filter) => filters[filter.key]).length + (canViewTeam ? 0 : 1)} filters`
            : "Hide"}
        </button>
      ) : null}
      {editing
        ? createPortal(
            <div
              ref={popover}
              role="dialog"
              aria-label={editing === "add" ? "Add filter" : `${activeMeta?.label} filter`}
              tabIndex={-1}
              onPointerDown={(event) => {
                if (menu && !(event.target as Element).closest("[data-filter-choice]"))
                  setMenu(null);
              }}
              style={{
                ...position,
                width: editing === "add" ? 275 : 340,
                maxWidth: "calc(100vw - 16px)",
                maxHeight: `calc(100dvh - ${position.top + 8}px)`,
              }}
              className={`dark-surface bg-surface border-stroke text-fg shadow-popover-sm fixed z-50 box-border overflow-y-auto rounded-lg border outline-none ${editing === "add" ? "p-2" : "p-4"}`}
            >
              {editing === "add" ? (
                <>
                  <div className="p-2">
                    <FilterSearch
                      value={search}
                      onChange={setSearch}
                      placeholder="Find filter..."
                    />
                  </div>
                  <div
                    role="menu"
                    aria-label="Available filters"
                    onKeyDown={(event) => {
                      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
                      const buttons = Array.from(
                        event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
                      );
                      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                      event.preventDefault();
                      buttons[
                        (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                          buttons.length
                      ]?.focus();
                    }}
                  >
                    {[
                      ...available.filter(
                        (filter) => !["member", "billable", "running"].includes(filter.key),
                      ),
                      ...available.filter((filter) =>
                        ["member", "billable", "running"].includes(filter.key),
                      ),
                    ]
                      .filter((filter) => filter.label.toLowerCase().includes(search.toLowerCase()))
                      .map(({ key, label }, index, list) => (
                        <div key={key}>
                          {index > 0 &&
                          !["member", "billable", "running"].includes(list[index - 1]?.key ?? "") &&
                          ["member", "billable", "running"].includes(key) ? (
                            <div className="my-1 h-px bg-[#4d4d4d]" aria-hidden="true" />
                          ) : null}
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => open(key)}
                            className={`hover:bg-surface-hover focus-visible:bg-surface-hover flex h-7 w-full items-center gap-2 rounded-lg px-3 text-left text-sm leading-5 font-medium ${focusClass}`}
                          >
                            <FilterGlyph filterKey={key} plain /> {label}
                          </button>
                        </div>
                      ))}
                  </div>
                </>
              ) : (
                <div className="grid gap-4">
                  <button
                    type="button"
                    aria-label="Back to filters"
                    onClick={() => open("add")}
                    className={`hover:bg-surface-hover flex h-8 w-fit items-center gap-2 rounded-lg px-3 py-1.5 text-sm leading-5 font-semibold ${focusClass}`}
                  >
                    <ChevronLeft size={14} aria-hidden="true" /> {activeMeta?.label}
                  </button>
                  <div className="grid gap-4">
                    <div className="grid gap-1">
                      <label htmlFor="report-filter-condition" className={labelClass}>
                        Condition
                      </label>
                      {choice(
                        "Condition",
                        draft.condition,
                        conditions.map((condition) => ({
                          value: condition,
                          label: conditionLabels[condition],
                        })),
                        (condition) =>
                          setDraft({
                            ...draft,
                            condition: condition as ReportFilterValue["condition"],
                          }),
                      )}
                    </div>
                    {entityKey && needsValues ? (
                      <>
                        <FilterSearch
                          value={search}
                          onChange={setSearch}
                          placeholder="Filter entities"
                        />
                        <div className="-mx-2 -mt-2 flex h-[35px] items-center justify-between py-1 pl-3">
                          <span className={labelClass}>
                            {entityKey === "project" ? "My projects" : entityKey}
                          </span>
                          <div className="flex">
                            {(["All", "None"] as const).map((name) => (
                              <button
                                key={name}
                                type="button"
                                onClick={() =>
                                  setDraft({
                                    ...draft,
                                    values:
                                      name === "All"
                                        ? [
                                            ...new Set([
                                              ...draft.values,
                                              ...visibleOptions.map((option) => option.id),
                                            ]),
                                          ]
                                        : draft.values.filter(
                                            (id) =>
                                              !visibleOptions.some((option) => option.id === id),
                                          ),
                                  })
                                }
                                className={`text-accent-fg hover:text-accent-fg-hover hover:bg-surface-hover flex h-6 items-center justify-center gap-2 rounded-lg px-1.5 py-1 text-start text-[11px] leading-4 font-semibold tracking-[0.04em] uppercase ${focusClass}`}
                              >
                                <span>{name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="-mx-4 -mt-4 max-h-[200px] overflow-y-auto px-2">
                          {visibleOptions.map((option) => (
                            <label
                              key={option.id}
                              className="hover:bg-surface-hover flex h-[30px] cursor-pointer items-center gap-2 rounded-lg px-3 text-sm leading-5 font-medium"
                            >
                              <Checkbox
                                checked={draft.values.includes(option.id)}
                                onChange={(event) =>
                                  setDraft({
                                    ...draft,
                                    values: event.target.checked
                                      ? [...draft.values, option.id]
                                      : draft.values.filter((id) => id !== option.id),
                                  })
                                }
                              />
                              <span className="flex min-w-0 items-center gap-2">
                                {entityKey === "project" ? (
                                  <span
                                    aria-hidden="true"
                                    className="size-2 shrink-0 rounded-full"
                                    style={{ background: option.color }}
                                  />
                                ) : null}
                                <span className="truncate">
                                  <span
                                    style={
                                      entityKey === "project" ? { color: option.color } : undefined
                                    }
                                  >
                                    {option.name}
                                  </span>
                                  {option.client_name ? (
                                    <span className="text-fg-subtle"> {option.client_name}</span>
                                  ) : null}
                                </span>
                              </span>
                            </label>
                          ))}
                          {!visibleOptions.length ? (
                            <p className="text-fg-subtle flex h-[30px] items-center justify-center text-sm font-semibold">
                              No matching items
                            </p>
                          ) : null}
                        </div>
                        {entityKey !== "tag" ? (
                          <div className="border-stroke -mx-4 -mt-4 flex h-[46px] items-center justify-between border-y px-4">
                            <span className={labelClass}>Show</span>
                            <div>
                              {choice(
                                "Show",
                                show,
                                [
                                  { value: "active", label: "Active" },
                                  { value: "archived", label: "Archived" },
                                  { value: "both", label: "Both" },
                                ],
                                setShow,
                              )}
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    {needsText ? (
                      <label className="grid gap-1">
                        <span className={labelClass}>Match criteria</span>
                        <input
                          value={draft.text ?? ""}
                          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                          className="hl-control bg-surface text-fg border-stroke-tertiary box-border h-9 w-full rounded-lg border px-3 text-sm leading-5 font-medium outline-none"
                        />
                      </label>
                    ) : null}
                    {editing === "billable" || editing === "running" ? (
                      <div className="grid gap-1">
                        <div className={labelClass}>Match criteria</div>
                        {choice(
                          "Match criteria",
                          draft.values[0] ?? "false",
                          editing === "billable"
                            ? [
                                { value: "true", label: "Billable" },
                                { value: "false", label: "Non-billable" },
                              ]
                            : [
                                { value: "false", label: "Stopped" },
                                { value: "true", label: "Running" },
                              ],
                          (value) => setDraft({ ...draft, values: [value] }),
                        )}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      disabled={!valid || loading}
                      onClick={apply}
                      className={`bg-accent hover:bg-accent-hover text-fg-inverted disabled:bg-accent-muted-hover box-border h-9 w-full rounded-lg px-6 py-2 text-sm leading-5 font-semibold disabled:cursor-not-allowed ${focusClass}`}
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

const FILTER_ICONS: Record<ReportFilterKey, LucideIcon> = {
  member: User,
  client: User,
  project: Folder,
  tag: TagIcon,
  description: AlignLeft,
  billable: DollarSign,
  running: Timer,
};

/**
 * Toggl's chip glyph: a 18px r4 tile (#999, accent when the filter is set) with a 12px dark glyph.
 * `plain` is the bare 14px icon used in the Add filter menu.
 */
function FilterGlyph({
  filterKey,
  active = false,
  disabled = false,
  plain = false,
}: {
  filterKey: ReportFilterKey;
  active?: boolean;
  disabled?: boolean;
  plain?: boolean;
}) {
  const Icon = FILTER_ICONS[filterKey];
  const filled = filterKey !== "description" && filterKey !== "billable" && filterKey !== "running";
  if (plain)
    return (
      <Icon
        size={14}
        fill={filled ? "currentColor" : "none"}
        className="shrink-0"
        aria-hidden="true"
      />
    );
  return (
    <span
      aria-hidden="true"
      className={`text-fg-inverted grid size-[18px] shrink-0 place-items-center rounded ${disabled ? "bg-fg-disabled" : active ? "bg-accent" : "bg-fg-subtle"}`}
    >
      <Icon size={12} strokeWidth={filled ? 1.5 : 2.4} fill={filled ? "currentColor" : "none"} />
    </span>
  );
}

function FilterSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="bg-surface box-border flex h-[30px] items-center gap-2 rounded-lg px-3 shadow-[0_0_0_1px_var(--color-stroke-tertiary)] focus-within:shadow-[0_0_0_2px_rgb(250_250_250/20%)]">
      <Search size={14} className="text-fg shrink-0" aria-hidden="true" />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="text-fg placeholder:text-fg-muted -mr-3 h-full min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
        style={{ lineHeight: "normal" }}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="text-fg-subtle hover:text-fg rounded"
        >
          <X size={12} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
