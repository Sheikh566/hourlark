import { Fragment } from "react";

import type { DescriptionCommand } from "@/web/features/timer/description-command";
import {
  groupProjectsByClient,
  hasClient,
  PickerHeading,
  CreateProjectFooter,
  ProjectDot,
  ProjectName,
  type ProjectChoice,
} from "@/web/features/timer/timer-pickers";
import { projectPickerTextColor } from "@/web/features/timer/project-tint";
import type { Tag } from "@/web/types";

export interface RecentTime {
  description: string;
  project_id: string | null;
  project_name: string | null;
  project_color?: string | null;
  client_name: string | null;
}

export type DescriptionSuggestion =
  | { kind: "recent"; key: string; description: string; project: ProjectChoice | null }
  | { kind: "project"; key: string; project: ProjectChoice };

export function suggestionOptionId(index: number): string {
  return `timer-suggestion-${index}`;
}

/**
 * Toggl's description dropdown: 400px surface, "Previously tracked time entries" (description plus
 * a tinted project chip) and, while the field is empty, a "Projects" section. Rows are 30px with a
 * radius-8 hover/highlight of #3a3a3a. Focus stays in the description field, so rows are
 * pointer-only buttons and the keyboard is handled by the field.
 */
export function SuggestionsDropdown({
  id,
  items,
  highlighted,
  onHighlight,
  onSelect,
}: {
  id: string;
  items: DescriptionSuggestion[];
  highlighted: number;
  onHighlight: (index: number) => void;
  onSelect: (item: DescriptionSuggestion) => void;
}) {
  const hasRecent = items.some((item) => item.kind === "recent");
  const hasProjects = items.some((item) => item.kind === "project");
  return (
    <div
      id={id}
      role="listbox"
      aria-label="Description suggestions"
      className="timer-popover absolute top-[65px] left-2.5 z-50 max-h-[calc(100dvh-90px)] w-[min(92vw,400px)] overflow-y-auto pt-[15px] pb-1 pl-px"
    >
      {items.map((item, index) => {
        const heading =
          (index === 0 && item.kind === "recent" && "Previously tracked time entries") ||
          (item.kind === "project" && items[index - 1]?.kind !== "project" && "Projects") ||
          null;
        return (
          <Fragment key={item.key}>
            {heading ? (
              <h2
                className={`text-fg h-[30px] px-[15px] text-[11px] leading-[13px] font-semibold tracking-[0.4px] uppercase ${
                  heading === "Projects" && hasRecent && hasProjects ? "mt-[18px]" : ""
                }`}
              >
                {heading}
              </h2>
            ) : null}
            <div className="h-[30px] px-[5px]">
              <button
                type="button"
                id={suggestionOptionId(index)}
                role="option"
                aria-selected={index === highlighted}
                tabIndex={-1}
                className={`flex h-[30px] w-full items-center rounded-lg px-2.5 text-left text-sm leading-[30px] font-medium ${
                  index === highlighted ? "bg-surface-hover" : "hover:bg-surface-hover"
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHighlight(index)}
                onClick={() => onSelect(item)}
              >
                {item.kind === "recent" ? (
                  <>
                    <span className="min-w-0 truncate text-[#b2b2b2]">{item.description}</span>
                    {item.project ? (
                      <span className="ml-5 flex min-w-0 shrink-0 items-center gap-1.5">
                        <ProjectDot color={item.project.color} />
                        <ProjectName project={item.project} />
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ProjectDot color={item.project.color} />
                    <span
                      className="truncate"
                      style={{ color: projectPickerTextColor(item.project.color) }}
                    >
                      {item.project.name}
                      {hasClient(item.project.client_name) ? (
                        <span className="text-fg-subtle"> • {item.project.client_name}</span>
                      ) : null}
                    </span>
                  </span>
                )}
              </button>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

export interface CommandOption {
  id: string;
  kind: "project" | "tag";
  label: string;
  selected: boolean;
}

/**
 * The `@` project and `#` tag menus. Projects reuse the project-picker rows (36px, tinted names,
 * client headings, "Create a new project" footer); tags are a plain list. The listbox keeps the
 * Hourlark option semantics because focus stays in the description field.
 */
export function CommandMenu({
  command,
  projects,
  tags,
  highlightedId,
  loading,
  canCreate,
  onHighlight,
  onSelectProject,
  onSelectTag,
}: {
  command: DescriptionCommand;
  projects: ProjectChoice[];
  tags: Array<Tag & { selected: boolean }>;
  highlightedId: string | null;
  loading: boolean;
  canCreate: boolean;
  onHighlight: (id: string) => void;
  onSelectProject: (project: ProjectChoice | null) => void;
  onSelectTag: (tag: Tag) => void;
}) {
  const isProject = command.kind === "project";
  const grouped = isProject ? groupProjectsByClient(projects) : [];
  const empty = isProject ? projects.length === 0 && Boolean(command.query) : tags.length === 0;
  const rowClass = (highlight: boolean) =>
    `flex h-[34px] w-full items-center gap-[11px] rounded-lg px-2.5 text-left text-sm leading-[30px] font-medium text-fg ${
      highlight ? "bg-surface-hover" : "hover:bg-surface-hover"
    }`;
  return (
    <div
      id="timer-description-command-menu"
      className="timer-popover absolute top-[56px] left-10 z-50 w-[min(88vw,360px)] pt-[5px]"
      role="listbox"
      aria-label={isProject ? "Project suggestions" : "Tag suggestions"}
    >
      <div className="ml-px max-h-[324px] [scrollbar-gutter:stable] overflow-y-auto">
        {loading ? (
          <p className="text-fg-muted p-4 text-center text-sm">
            Loading {isProject ? "projects" : "tags"}…
          </p>
        ) : empty ? (
          <div className="grid gap-3 p-[15px]">
            <strong className="text-fg-soft text-center text-sm font-semibold">
              No matching items
            </strong>
            <span className="text-fg-soft text-sm font-medium">
              No {isProject ? "projects" : "tags"} start with{" "}
              <span className="tabular-nums">
                {command.marker}
                {command.query}
              </span>
            </span>
          </div>
        ) : isProject ? (
          <>
            {!command.query ? (
              <div className="py-px pr-[3px] pl-1.5">
                <button
                  id="timer-description-command-project-"
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={highlightedId === ""}
                  className={rowClass(highlightedId === "")}
                  onMouseEnter={() => onHighlight("")}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelectProject(null)}
                >
                  <ProjectDot color="#999999" />
                  <span className="text-fg-subtle">No Project</span>
                </button>
              </div>
            ) : null}
            {grouped.map(([client, items]) => (
              <div key={client}>
                <PickerHeading>{client === "No client" ? "No Client" : client}</PickerHeading>
                {items.map((project) => {
                  const optionId = `timer-description-command-project-${project.id}`;
                  return (
                    <div key={project.id} className="py-px pr-[3px] pl-1.5">
                      <button
                        id={optionId}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        aria-selected={highlightedId === project.id}
                        className={rowClass(highlightedId === project.id)}
                        onMouseEnter={() => onHighlight(project.id)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onSelectProject(project)}
                      >
                        <ProjectDot color={project.color} />
                        <ProjectName project={project} />
                        {hasClient(project.client_name) ? (
                          <span className="text-fg-subtle truncate">{project.client_name}</span>
                        ) : null}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        ) : (
          <>
            <PickerHeading>Tags</PickerHeading>
            {tags.map((tag) => (
              <div key={tag.id} className="py-px pr-[3px] pl-1.5">
                <button
                  id={`timer-description-command-tag-${tag.id}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={highlightedId === tag.id}
                  className={rowClass(highlightedId === tag.id)}
                  onMouseEnter={() => onHighlight(tag.id)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelectTag(tag)}
                >
                  <span className="min-w-0 truncate">{tag.name}</span>
                  {tag.selected ? (
                    <span className="text-fg-muted ml-auto text-xs">Added</span>
                  ) : null}
                </button>
              </div>
            ))}
          </>
        )}
      </div>
      {isProject && canCreate ? <CreateProjectFooter /> : null}
    </div>
  );
}
