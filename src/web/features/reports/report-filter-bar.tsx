import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Plus,
  Search,
  Timer,
  X,
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
const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400";
const labelClass = "text-[11px] uppercase text-[#a3a3a3]";

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
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            onToggle();
          }
        }}
        className={`flex h-9 w-full items-center justify-between rounded-md text-sm ${compact ? "gap-1 px-1" : "border border-[#808080] px-3"} ${focusClass}`}
      >
        {options.find((option) => option.value === value)?.label}
        {compact ? (
          <ChevronRight size={14} aria-hidden="true" />
        ) : (
          <ChevronDown size={16} className="text-[#a3a3a3]" aria-hidden="true" />
        )}
      </button>
      {open ? (
        <div
          ref={list}
          role="listbox"
          aria-label={label}
          onKeyDown={moveOptionFocus}
          className={`absolute top-full right-0 z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-[#555] bg-[#292929] py-1 shadow-xl ${compact ? "w-36" : "left-0"}`}
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
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-[#3a3a3a] ${value === option.value ? "bg-[#382b16] text-[#fbbf24]" : ""} ${focusClass}`}
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
      const width = editing === "add" ? 272 : 340;
      const next = {
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(bounds.bottom + 6, Math.max(8, window.innerHeight - 220))),
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
              className="flex h-9 items-center gap-2 px-2 text-sm font-semibold text-[#808080]"
              title="Members can view their own time entries"
            >
              <FilterGlyph filterKey="member" /> Member is {currentMemberName}
            </span>
          ) : null}
          {ordered.map(({ key, label }) => (
            <div
              key={key}
              className={`flex h-9 max-w-full items-center rounded-md ${editing === key ? "bg-[#382b16] text-[#fbbf24]" : filters[key] ? "bg-[#3a3a3a] text-[#fafafa]" : "text-[#fafafa]"}`}
            >
              <button
                ref={(element) => {
                  buttons.current[key] = element;
                }}
                type="button"
                disabled={loading}
                aria-label={`${label}${filters[key] || editing === key ? `: ${chipText(key)}` : ""}`}
                aria-haspopup="dialog"
                aria-expanded={editing === key}
                onClick={() => (editing === key ? close() : open(key))}
                className={`flex h-9 min-w-0 items-center gap-2 rounded-md px-3 text-sm font-semibold hover:bg-white/5 ${focusClass}`}
              >
                <FilterGlyph filterKey={key} active={editing === key} />
                <span className="max-w-48 truncate">
                  {label}
                  {filters[key] || editing === key ? ` ${chipText(key)}` : ""}
                </span>
              </button>
              {filters[key] || editing === key ? (
                <button
                  type="button"
                  aria-label={`Remove ${label} filter`}
                  onClick={() => remove(key)}
                  className={`mr-1 rounded p-1 hover:bg-white/10 ${focusClass}`}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
          <button
            ref={(element) => {
              buttons.current.add = element;
            }}
            type="button"
            disabled={loading}
            aria-haspopup="dialog"
            aria-expanded={editing === "add"}
            onClick={() => (editing === "add" ? close() : open("add"))}
            className={`flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold text-[#a3a3a3] hover:bg-white/5 ${focusClass}`}
          >
            <Plus size={17} aria-hidden="true" /> Add filter
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
          className={`flex h-9 items-center gap-1 rounded-md px-2 text-xs text-[#a3a3a3] hover:bg-white/5 ${focusClass}`}
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
                width: editing === "add" ? 272 : 340,
                maxWidth: "calc(100vw - 16px)",
                maxHeight: `calc(100dvh - ${position.top + 8}px)`,
              }}
              className="dark-surface fixed z-50 overflow-y-auto rounded-md border border-[#3a3a3a] bg-[#1b1b1b] p-4 text-[#fafafa] shadow-[0_6px_18px_#0008] outline-none"
            >
              {editing === "add" ? (
                <>
                  <FilterSearch value={search} onChange={setSearch} placeholder="Find filter…" />
                  <div
                    className="mt-2"
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
                      .map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          role="menuitem"
                          onClick={() => open(key)}
                          className={`flex h-9 w-full items-center gap-3 rounded px-2 text-left text-sm hover:bg-[#3a3a3a] ${focusClass}`}
                        >
                          <FilterGlyph filterKey={key} /> {label}
                        </button>
                      ))}
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label="Back to filters"
                    onClick={() => open("add")}
                    className={`mb-5 flex items-center gap-2 rounded text-sm font-semibold ${focusClass}`}
                  >
                    <ChevronLeft size={16} aria-hidden="true" /> {activeMeta?.label}
                  </button>
                  <div className={`${labelClass} mb-1`}>Condition</div>
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
                  {entityKey && needsValues ? (
                    <>
                      <div className="mt-3">
                        <FilterSearch
                          value={search}
                          onChange={setSearch}
                          placeholder={`Find ${entityKey}…`}
                        />
                      </div>
                      <div className="mt-4 mb-2 flex items-center justify-between">
                        <span className={labelClass}>
                          {entityKey === "project" ? "My projects" : entityKey}
                        </span>
                        <div className="flex gap-3 text-[11px] font-semibold text-[#fbbf24]">
                          <button
                            type="button"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                values: [
                                  ...new Set([
                                    ...draft.values,
                                    ...visibleOptions.map((option) => option.id),
                                  ]),
                                ],
                              })
                            }
                            className={`rounded ${focusClass}`}
                          >
                            ALL
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                values: draft.values.filter(
                                  (id) => !visibleOptions.some((option) => option.id === id),
                                ),
                              })
                            }
                            className={`rounded ${focusClass}`}
                          >
                            NONE
                          </button>
                        </div>
                      </div>
                      <div className="max-h-60 overflow-y-auto">
                        {visibleOptions.map((option) => (
                          <label
                            key={option.id}
                            className="flex min-h-[30px] cursor-pointer items-center gap-2 rounded px-1 text-sm hover:bg-[#3a3a3a]"
                          >
                            <input
                              type="checkbox"
                              checked={draft.values.includes(option.id)}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  values: event.target.checked
                                    ? [...draft.values, option.id]
                                    : draft.values.filter((id) => id !== option.id),
                                })
                              }
                              className={`size-3.5 shrink-0 accent-[#fbbf24] ${focusClass}`}
                            />
                            {entityKey === "project" ? (
                              <span
                                aria-hidden="true"
                                className="size-2 shrink-0 rounded-full"
                                style={{ background: option.color }}
                              />
                            ) : null}
                            <span>
                              <span
                                style={
                                  entityKey === "project" ? { color: option.color } : undefined
                                }
                              >
                                {option.name}
                              </span>
                              {option.client_name ? (
                                <span className="text-[#a3a3a3]"> · {option.client_name}</span>
                              ) : null}
                            </span>
                          </label>
                        ))}
                        {!visibleOptions.length ? (
                          <p className="py-2 text-sm text-[#a3a3a3]">No matches</p>
                        ) : null}
                      </div>
                      {entityKey !== "tag" ? (
                        <div className="-mx-4 mt-3 flex items-center justify-between border-t border-[#3a3a3a] px-4 pt-2">
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
                    <label className="mt-4 block">
                      <span className={labelClass}>Match criteria</span>
                      <input
                        value={draft.text ?? ""}
                        onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                        className={`mt-1 h-9 w-full rounded-md border border-[#808080] bg-transparent px-3 text-sm ${focusClass}`}
                      />
                    </label>
                  ) : null}
                  {editing === "billable" || editing === "running" ? (
                    <div className="mt-4">
                      <div className={`${labelClass} mb-1`}>Match criteria</div>
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
                  <div className="-mx-4 mt-4 border-t border-[#3a3a3a] px-4 pt-4">
                    <button
                      type="button"
                      disabled={!valid || loading}
                      onClick={apply}
                      className={`h-9 w-full rounded-md bg-[#fbbf24] text-sm font-semibold text-[#1b1b1b] hover:bg-[#fcd34d] disabled:cursor-not-allowed disabled:opacity-30 ${focusClass}`}
                    >
                      Add
                    </button>
                  </div>
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function FilterGlyph({
  filterKey,
  active = false,
}: {
  filterKey: ReportFilterKey;
  active?: boolean;
}) {
  const className = `shrink-0 ${active ? "text-[#fbbf24]" : "text-[#a3a3a3]"}`;
  if (filterKey === "billable")
    return <DollarSign size={18} className={className} aria-hidden="true" />;
  if (filterKey === "running") return <Timer size={18} className={className} aria-hidden="true" />;
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <rect
        x="1"
        y={filterKey === "project" ? "3" : "1"}
        width="16"
        height={filterKey === "project" ? "14" : "16"}
        rx="2"
      />
      {filterKey === "member" || filterKey === "client" ? (
        <>
          <circle cx="9" cy="6" r="2.5" fill="#1b1b1b" />
          <path d="M4 15v-2a5 5 0 0 1 10 0v2z" fill="#1b1b1b" />
        </>
      ) : filterKey === "project" ? (
        <>
          <path d="M3 1h5l2 3H3z" />
          <path d="M3 6h12v2H3z" fill="#1b1b1b" />
        </>
      ) : filterKey === "tag" ? (
        <>
          <path d="M4 4h5l5 5-5 5-5-5z" fill="#1b1b1b" />
          <circle cx="6" cy="6" r="1" />
        </>
      ) : (
        <text x="2.5" y="13" fill="#1b1b1b" fontSize="11" fontWeight="700">
          Aa
        </text>
      )}
    </svg>
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
    <div className="flex h-8 items-center gap-2 rounded-md border border-[#808080] px-2 focus-within:ring-1 focus-within:ring-[#a3a3a3]">
      <Search size={16} className="shrink-0 text-[#a3a3a3]" aria-hidden="true" />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#a3a3a3]"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className={`rounded ${focusClass}`}
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
