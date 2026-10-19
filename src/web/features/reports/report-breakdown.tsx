import { useMemo, useState } from "react";

import { Select, SortHeader } from "@/web/components/ui";
import { ReportCard, ReportCardHeader, ReportTh } from "@/web/features/reports/report-card";
import { ReportEmpty } from "@/web/features/reports/report-empty";
import {
  DIMENSION_LABELS,
  DIMENSION_SINGULAR,
  GROUP_DIMENSIONS,
  type GroupDimension,
  type SummaryGroup,
  type SummaryReport,
} from "@/web/features/reports/report-types";
import { formatClockDuration, formatReportDuration } from "@/web/lib/format";

type SortKey = "label" | "duration" | "percent";
type SortState = { key: SortKey; direction: "asc" | "desc" } | null;

function sortValue(group: SummaryGroup, key: SortKey): number | string {
  switch (key) {
    case "label":
      return group.label.toLocaleLowerCase();
    case "duration":
      return group.rawDurationMs;
    case "percent":
      return group.percentOfTotal;
  }
}
function sortGroups(groups: SummaryGroup[], sort: SortState): SummaryGroup[] {
  if (!sort) return groups;
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...groups]
    .map((group) => ({
      ...group,
      children: group.children ? sortGroups(group.children, sort) : undefined,
    }))
    .sort((left, right) => {
      const a = sortValue(left, sort.key);
      const b = sortValue(right, sort.key);
      return (
        (typeof a === "string" && typeof b === "string"
          ? a.localeCompare(b)
          : Number(a) - Number(b)) * sign
      );
    });
}
function percent(value: number): string {
  return `${Math.round(value)}%`;
}
function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((part) => part[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

function ChevronButton({
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
      aria-label={label}
      aria-expanded={expanded}
      onClick={onClick}
      className="text-fg-muted hover:bg-surface-hover hover:text-fg grid size-8 place-items-center rounded-lg"
    >
      <svg
        width="8"
        height="12"
        viewBox="0 0 8 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={expanded ? "rotate-90" : undefined}
      >
        <path d="M1.5 1.5 6.5 6l-5 4.5" />
      </svg>
    </button>
  );
}

const cell = "border-stroke border-b py-1 pr-2 pl-[25px] text-sm leading-[17px] font-medium";

export function ReportBreakdown({
  report,
  groupBy,
  secondary,
  colors,
  onGroupChange,
  onSecondaryChange,
}: {
  report: SummaryReport;
  groupBy: GroupDimension;
  secondary: GroupDimension | "";
  colors: Map<string, string>;
  onGroupChange: (value: GroupDimension) => void;
  onSecondaryChange: (value: GroupDimension | "") => void;
}) {
  const [sort, setSort] = useState<SortState>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const groups = useMemo(() => sortGroups(report.groups, sort), [report.groups, sort]);
  const expandable = groups.filter((group) => group.children?.length);
  const allExpanded = expandable.length > 0 && expandable.every((group) => expanded.has(group.key));
  const title = `${DIMENSION_SINGULAR[groupBy][0]?.toUpperCase() ?? ""}${DIMENSION_SINGULAR[groupBy].slice(1)}${
    secondary ? ` and ${DIMENSION_SINGULAR[secondary]}` : ""
  } breakdown`;
  const direction = (key: SortKey) => (sort?.key === key ? sort.direction : null);
  const toggleSort = (key: SortKey) =>
    setSort((current) =>
      current?.key !== key
        ? { key, direction: key === "label" ? "asc" : "desc" }
        : current.direction === "desc"
          ? { key, direction: "asc" }
          : key !== "label"
            ? null
            : { key, direction: "desc" },
    );
  const toggleRow = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <ReportCard>
      <ReportCardHeader title={title}>
        <div className="flex min-w-0 flex-wrap gap-[5px]">
          <Select
            aria-label="Primary group"
            tone="accent"
            labelPrefix="Breakdown by:"
            className="h-9 w-[202px]"
            value={groupBy}
            onValueChange={(value) => onGroupChange(value as GroupDimension)}
            options={GROUP_DIMENSIONS.map((value) => ({ value, label: DIMENSION_LABELS[value] }))}
          />
          <Select
            aria-label="Secondary group"
            tone="accent"
            labelPrefix="and:"
            className="h-9 w-[160px]"
            value={secondary}
            onValueChange={(value) => onSecondaryChange(value as GroupDimension | "")}
            options={[
              { value: "", label: "None" },
              ...GROUP_DIMENSIONS.filter((value) => value !== groupBy).map((value) => ({
                value,
                label: DIMENSION_LABELS[value],
              })),
            ]}
          />
        </div>
      </ReportCardHeader>
      {groups.length === 0 ? (
        <div className="px-3">
          <ReportEmpty className="" />
        </div>
      ) : (
        <div className="overflow-x-auto px-3 pb-2.5">
          <table className="w-full min-w-[720px] table-fixed border-collapse text-left">
            <colgroup>
              <col style={{ width: 48 }} />
              <col style={{ width: 350 }} />
              <col style={{ width: 140 }} />
              <col />
              <col style={{ width: 64 }} />
            </colgroup>
            <thead>
              <tr>
                <ReportTh kind="edge">
                  {expandable.length ? (
                    <ChevronButton
                      expanded={allExpanded}
                      label={allExpanded ? "Collapse all rows" : "Expand all rows"}
                      onClick={() =>
                        setExpanded(
                          allExpanded ? new Set() : new Set(expandable.map((group) => group.key)),
                        )
                      }
                    />
                  ) : null}
                </ReportTh>
                <ReportTh kind="lead" aria-sort={ariaSort(direction("label"))}>
                  <SortHeader
                    label={
                      secondary
                        ? `${DIMENSION_SINGULAR[groupBy]} | ${DIMENSION_SINGULAR[secondary]}`
                        : DIMENSION_SINGULAR[groupBy]
                    }
                    direction={direction("label")}
                    onToggle={() => toggleSort("label")}
                  />
                </ReportTh>
                <ReportTh aria-sort={ariaSort(direction("duration"))}>
                  <SortHeader
                    label="Duration"
                    direction={direction("duration")}
                    onToggle={() => toggleSort("duration")}
                  />
                </ReportTh>
                <ReportTh aria-sort={ariaSort(direction("percent"))}>
                  <SortHeader
                    label="Duration %"
                    direction={direction("percent")}
                    onToggle={() => toggleSort("percent")}
                  />
                </ReportTh>
                <ReportTh aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const open = expanded.has(group.key);
                const children = group.children ?? [];
                const color = groupBy === "project" ? (colors.get(group.key) ?? "#808080") : null;
                return (
                  <GroupRows
                    key={group.key}
                    group={group}
                    open={open}
                    color={color}
                    colors={colors}
                    childDimension={secondary || null}
                    onToggle={children.length ? () => toggleRow(group.key) : undefined}
                  />
                );
              })}
              <tr className="h-[50px]">
                <td />
                <td className="py-1 pr-2 pl-[15px]">
                  <span className="text-fg text-[11px] leading-[14px] font-semibold uppercase">
                    Total
                  </span>
                </td>
                <td className="py-1 pr-2 pl-[25px] text-sm leading-[17px] font-bold">
                  {formatReportDuration(report.totals.tracked_duration_ms)}
                </td>
                <td className="py-1 pr-2 pl-[25px] text-sm leading-[17px] font-bold">
                  {report.totals.tracked_duration_ms ? "100%" : "-"}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </ReportCard>
  );
}

function ariaSort(direction: "asc" | "desc" | null) {
  return direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined;
}

function GroupRows({
  group,
  open,
  color,
  colors,
  childDimension,
  onToggle,
}: {
  group: SummaryGroup;
  open: boolean;
  color: string | null;
  colors: Map<string, string>;
  childDimension: GroupDimension | null;
  onToggle?: () => void;
}) {
  const children = group.children ?? [];
  return (
    <>
      <tr className={`h-[50px] ${open ? "bg-surface-hover" : ""}`}>
        <td className="border-stroke border-b p-0 text-center">
          {onToggle ? (
            <div className="grid place-items-center">
              <ChevronButton
                expanded={open}
                label={`${open ? "Collapse" : "Expand"} ${group.label}`}
                onClick={onToggle}
              />
            </div>
          ) : null}
        </td>
        <td className="border-stroke border-b py-1 pr-2 pl-[15px] text-sm leading-[17px] font-medium">
          <div className="flex items-center gap-3">
            <span
              className="flex min-w-0 items-center gap-2 truncate"
              style={color ? { color } : undefined}
            >
              {color ? (
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
              ) : null}
              <span className="truncate">{group.label}</span>
            </span>
            {children.length ? (
              <span className="text-fg-subtle shrink-0 text-sm leading-5 font-medium">
                ({children.length})
              </span>
            ) : null}
          </div>
          {group.budgetMinutes ? (
            <div className="text-fg-subtle mt-0.5 text-xs leading-4 font-medium">
              {formatClockDuration(group.rawDurationMs)} of{" "}
              {formatClockDuration(group.budgetMinutes * 60_000)} budget
            </div>
          ) : null}
        </td>
        <MetricCells group={group} />
      </tr>
      {open
        ? children.map((child) => (
            <tr key={child.key} className="bg-surface-secondary h-[50px]">
              <td className="border-stroke border-b" />
              <td className="border-stroke border-b py-1 pr-2 pl-[35px] text-sm leading-5 font-medium">
                <div className="flex items-center gap-2">
                  {childDimension === "member" ? (
                    <span
                      className="bg-accent-muted-active text-accent-fg-active grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-semibold"
                      aria-hidden="true"
                    >
                      {initials(child.label)}
                    </span>
                  ) : childDimension === "project" ? (
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: colors.get(child.key) ?? "#808080" }}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="truncate">{child.label}</span>
                </div>
              </td>
              <MetricCells group={child} />
            </tr>
          ))
        : null}
    </>
  );
}

function MetricCells({ group }: { group: SummaryGroup }) {
  return (
    <>
      <td className={cell}>{formatReportDuration(group.rawDurationMs)}</td>
      <td className={cell}>{percent(group.percentOfTotal)}</td>
      <td className="border-stroke border-b" />
    </>
  );
}
