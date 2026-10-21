import { formatInTimeZone } from "date-fns-tz";
import { DollarSign, Folder, Play, Tag } from "lucide-react";
import type { ComponentProps } from "react";
import { twMerge } from "tailwind-merge";

import { Checkbox, RowMenu, type RowMenuItem } from "@/web/components/ui";
import { formatClockDuration } from "@/web/lib/format";
import type { TimeEntry } from "@/web/types";

/**
 * Toggl list row geometry (measured at 1920px): a 50px row, 20px left / 8px right padding, a 30px
 * checkbox slot, a flexible description + project area, then fixed tag (50), billable (30),
 * time (251.6), play (40) and menu (30) columns. Below `lg` the row wraps into two lines.
 * Hover shows solid #3a3a3a with no transition; the row controls reveal on hover and focus.
 */
export const ENTRY_ROW_COLUMNS =
  "lg:grid-cols-[30px_minmax(0,1fr)_50px_30px_251.6px_40px_30px] lg:h-[50px]";

export const entryRowClassName = `group relative grid min-w-0 grid-cols-[30px_minmax(0,1fr)] items-center gap-y-1 py-2 pr-2 pl-5 has-[[aria-expanded=true]]:bg-surface-hover hover:bg-surface-hover lg:gap-y-0 lg:py-0 ${ENTRY_ROW_COLUMNS}`;

/** Wrapper for the tag/billable/time/play/menu cells: wraps on mobile, joins the grid on lg. */
export const entryRowExtrasClassName =
  "col-start-2 flex min-w-0 flex-wrap items-center gap-x-1 lg:contents";

/**
 * Hover/keyboard-focus reveal used by every row control (always visible on touch widths). A mouse
 * click on one control (e.g. Continue) does not reveal the others, as in Toggl.
 */
export const revealOnRowHover =
  "lg:opacity-0 lg:group-hover:opacity-100 lg:group-has-[:focus-visible]:opacity-100 lg:has-[[aria-expanded=true]]:opacity-100";

/** Duration as Toggl shows it: minutes digits are heavier (`0:<b>14</b>:00`). */
export function DurationText({ durationMs }: { durationMs: number }) {
  const [hours, minutes, seconds] = formatClockDuration(durationMs).split(":");
  return (
    <>
      {hours}:<strong className="font-semibold">{minutes}</strong>:{seconds}
    </>
  );
}

export function EntryCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
  label,
  alwaysVisible,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
  alwaysVisible?: boolean;
}) {
  const visible = alwaysVisible || checked || indeterminate;
  return (
    <Checkbox
      disabled={disabled}
      checked={checked}
      indeterminate={indeterminate}
      onChange={onChange}
      aria-label={label}
      className={
        visible
          ? undefined
          : "lg:opacity-0 lg:group-hover:opacity-100 lg:group-has-[:focus-visible]:opacity-100"
      }
    />
  );
}

/** Project cell: a 30px pill in the project's own colour, or a hover-revealed folder icon. */
export function ProjectCell({
  entry,
  onClick,
  title,
  disabled,
  visible = false,
  buttonProps,
}: {
  entry: Pick<TimeEntry, "project" | "client">;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  /** Keep the empty-project folder icon visible (editing) instead of hover-revealed. */
  visible?: boolean;
  buttonProps?: ComponentProps<"button">;
}) {
  const project = entry.project;
  if (!project?.name) {
    return (
      <div className="ml-3.5 flex min-w-0 flex-1 items-center">
        <button
          type="button"
          className={twMerge(
            "text-fg-muted hover:bg-surface-hover box-border grid h-[27px] place-items-center rounded-lg px-[5px] py-[7.5px]",
            !visible && revealOnRowHover,
          )}
          onClick={onClick}
          disabled={disabled}
          title={title}
          aria-label="Add project"
          {...buttonProps}
        >
          <Folder width={18} height={12} aria-hidden="true" />
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="ml-3.5 box-border flex h-[30px] min-w-0 flex-1 items-center rounded-lg py-0.5 pr-[7.5px] pl-2.5 text-left text-sm leading-[normal] font-medium"
      onClick={onClick}
      disabled={disabled}
      title={title}
      {...buttonProps}
    >
      <span
        className="min-w-0 truncate"
        style={project.color ? { color: project.color } : undefined}
      >
        <span aria-hidden="true" className="mr-[5px] inline-block w-[9.1px]">
          •
        </span>
        {project.name}
      </span>
      {entry.client?.name ? (
        <span className="text-fg-subtle ml-1 min-w-0 truncate"> • {entry.client.name}</span>
      ) : null}
    </button>
  );
}

/** Tag cell: 50px slot with the filled tag glyph; stays visible when the entry has tags. */
export function TagsCell({
  hasTags,
  label,
  title,
  onClick,
  disabled,
  active,
  visible = false,
  buttonProps,
}: {
  hasTags: boolean;
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  visible?: boolean;
  buttonProps?: ComponentProps<"button">;
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <button
        type="button"
        className={twMerge(
          "text-fg-muted hover:text-fg-soft box-border grid h-[30px] place-items-center rounded-lg px-[6.5px]",
          active && "text-accent-fg hover:text-accent-fg",
          hasTags || visible ? "" : revealOnRowHover,
        )}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        title={title}
        {...buttonProps}
      >
        <Tag size={17} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Billable cell: 30x30 `$`; muted when off, accent when on (always visible when on). */
export function BillableCell({
  billable,
  onToggle,
  disabled,
  visible = false,
}: {
  billable: boolean;
  onToggle: () => void;
  disabled?: boolean;
  visible?: boolean;
}) {
  return (
    <button
      type="button"
      className={twMerge(
        "hover:bg-surface-hover box-border grid size-[30px] place-items-center rounded-lg",
        billable ? "text-accent-fg" : twMerge("text-fg-disabled", !visible && revealOnRowHover),
      )}
      onClick={onToggle}
      disabled={disabled}
      aria-label={billable ? "Mark entry non-billable" : "Mark entry billable"}
      aria-pressed={billable}
      title={billable ? "Billable" : "Non-billable"}
    >
      <DollarSign width={14} height={18} strokeWidth={3} aria-hidden="true" />
    </button>
  );
}

/** Time cell: `3:34 PM - 3:48 PM` range pill plus the right-aligned duration. */
export function TimeCell({
  range,
  durationMs,
  running,
  onClick,
  title,
  ariaLabel,
  disabled,
  active,
  buttonProps,
}: {
  range: string;
  durationMs: number;
  running: boolean;
  onClick: () => void;
  title: string;
  ariaLabel: string;
  disabled?: boolean;
  active?: boolean;
  buttonProps?: ComponentProps<"button">;
}) {
  return (
    <button
      type="button"
      className="box-border flex h-full min-w-0 items-center justify-end px-0 text-left text-sm font-medium tabular-nums lg:px-2.5"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      {...buttonProps}
    >
      <span
        className={twMerge(
          "text-fg-subtle box-border block shrink-0 rounded-lg px-[7.5px] py-[5px] leading-[14px] whitespace-nowrap",
          active ? "bg-surface-hover" : "hover:bg-hover-faint hover:text-fg",
        )}
      >
        {range}
      </span>
      <span className="box-border flex w-[87px] shrink-0 justify-end">
        <span
          className={twMerge(
            "hover:bg-hover-faint box-border rounded-lg px-[7.5px] leading-[14px]",
            running ? "text-accent-fg" : "text-fg",
          )}
        >
          <span>
            <DurationText durationMs={durationMs} />
          </span>
        </span>
      </span>
    </button>
  );
}

/** Play slot (40x30) + overflow menu slot (30x30) at the row's right edge. */
export function RowActions({
  onContinue,
  continueLabel,
  continueDisabled,
  menuItems,
  menuLabel,
  entryId,
  continueFor,
}: {
  onContinue: () => void;
  continueLabel: string;
  continueDisabled?: boolean;
  /** Space-separated entry ids this play continues; the list restores focus to it by id. */
  continueFor?: string;
  menuItems?: RowMenuItem[];
  menuLabel: string;
  entryId?: string;
}) {
  return (
    <>
      <div className="flex h-full w-10 items-center justify-center">
        <button
          type="button"
          // Toggl keeps the clicked play at full opacity until focus moves elsewhere.
          className="grid size-[30px] place-items-center rounded-lg text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-50 lg:group-has-[:focus-visible]:opacity-50 lg:hover:opacity-100! lg:focus:opacity-100!"
          disabled={continueDisabled}
          onClick={onContinue}
          title="Continue time entry"
          aria-label={continueLabel}
          data-continue-for={continueFor}
        >
          <Play size={18} aria-hidden="true" />
        </button>
      </div>
      <div
        className={twMerge("flex h-full items-center", revealOnRowHover)}
        data-entry-menu={entryId}
      >
        {menuItems?.length ? (
          <RowMenu
            label={menuLabel}
            items={menuItems}
            menuClassName="w-[170px] [&>button:focus]:bg-surface-hover"
          />
        ) : null}
      </div>
    </>
  );
}

export interface ListEntryRowProps {
  rowId?: string;
  entry: TimeEntry;
  timezone: string;
  durationMs: number;
  running: boolean;
  startedAt: string;
  stoppedAt: string | null;
  selected: boolean;
  indeterminate?: boolean;
  selectionActive?: boolean;
  onToggleSelected: () => void;
  selectLabel: string;
  count?: number;
  expanded?: boolean;
  onToggleCount?: () => void;
  panelId?: string;
  onDescriptionClick: () => void;
  onProjectClick: () => void;
  onTagsClick: () => void;
  onTimeClick: () => void;
  descriptionTitle: string;
  projectTitle: string;
  timeTitle: string;
  timeAriaLabel: string;
  onContinue: () => void;
  continueLabel: string;
  continuePending: boolean;
  actionsPending: boolean;
  /** Entry ids behind this row's play (defaults to the row's own entry). */
  continueFor?: string;
  menuItems?: RowMenuItem[];
  /** Shows the billable `$` cell; omit when the member may not change billable status. */
  onToggleBillable?: () => void;
  nested?: boolean;
}

export function ListEntryRow({
  rowId,
  entry,
  timezone,
  durationMs,
  running,
  startedAt,
  stoppedAt,
  selected,
  indeterminate = false,
  selectionActive = false,
  onToggleSelected,
  selectLabel,
  count,
  expanded,
  onToggleCount,
  panelId,
  onDescriptionClick,
  onProjectClick,
  onTagsClick,
  onTimeClick,
  descriptionTitle,
  projectTitle,
  timeTitle,
  timeAriaLabel,
  onContinue,
  continueLabel,
  continuePending,
  actionsPending,
  continueFor,
  menuItems,
  onToggleBillable,
  nested = false,
}: ListEntryRowProps) {
  const startLabel = formatInTimeZone(startedAt, timezone, "h:mm a");
  const stopLabel =
    running || !stoppedAt ? "running" : formatInTimeZone(stoppedAt, timezone, "h:mm a");
  const matchLabel = entry.description || "time entry";
  const tagNames = entry.tags.map((tag) => tag.name).join(", ");
  const tagsLabel =
    count != null ? `Show tags for ${count} matching sessions` : `Edit tags for ${matchLabel}`;

  return (
    <article id={rowId} className={twMerge(entryRowClassName, running && "bg-accent-muted/35")}>
      <div className="flex h-full items-center">
        <EntryCheckbox
          checked={selected}
          indeterminate={indeterminate}
          disabled={actionsPending}
          onChange={onToggleSelected}
          label={selectLabel}
          alwaysVisible={selectionActive}
        />
      </div>
      <div className={twMerge("flex min-w-0 items-center", nested && "pl-10")}>
        {count != null && onToggleCount ? (
          <button
            type="button"
            className={twMerge(
              "border-control text-fg mr-2.5 box-border grid size-[30px] shrink-0 place-items-center rounded-lg border text-sm font-semibold hover:bg-[#606060]",
              expanded ? "bg-[#4d4d4d]" : "bg-surface",
            )}
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggleCount}
            aria-label={
              expanded
                ? `Hide ${count} matching sessions for ${matchLabel}`
                : `Show ${count} matching sessions for ${matchLabel}`
            }
          >
            {count}
          </button>
        ) : null}
        <button
          type="button"
          className={twMerge(
            "max-w-[60%] min-w-0 shrink-0 truncate pr-2.5 text-left text-sm leading-[normal] font-medium",
            entry.description ? "text-fg" : "text-fg-subtle",
          )}
          onClick={onDescriptionClick}
          title={descriptionTitle}
        >
          {entry.description || "Add description"}
        </button>
        <ProjectCell entry={entry} onClick={onProjectClick} title={projectTitle} />
      </div>
      <div className={entryRowExtrasClassName}>
        <TagsCell
          hasTags={entry.tags.length > 0}
          label={tagNames ? `${tagsLabel} (${tagNames})` : tagsLabel}
          title={tagNames || undefined}
          onClick={onTagsClick}
        />
        <div className="flex h-full items-center">
          {onToggleBillable ? (
            <BillableCell
              billable={entry.billable}
              onToggle={onToggleBillable}
              disabled={actionsPending}
            />
          ) : null}
        </div>
        <TimeCell
          range={`${startLabel} - ${stopLabel}`}
          durationMs={durationMs}
          running={running}
          onClick={onTimeClick}
          title={timeTitle}
          ariaLabel={timeAriaLabel}
        />
        <RowActions
          onContinue={onContinue}
          continueLabel={continueLabel}
          continueDisabled={actionsPending || continuePending}
          continueFor={continueFor ?? entry.id}
          menuItems={menuItems}
          menuLabel="More actions"
          entryId={entry.id}
        />
      </div>
    </article>
  );
}
