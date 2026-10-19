import { useMemo, useState } from "react";

import { Checkbox } from "@/web/components/checkbox";
import { Button, SortHeader } from "@/web/components/ui";
import { ReportCard, ReportCardHeader, ReportTh } from "@/web/features/reports/report-card";
import { ReportEmpty } from "@/web/features/reports/report-empty";
import type { DetailedRow } from "@/web/features/reports/report-types";
import { formatClockDuration } from "@/web/lib/format";

export type DetailedSort = "started_desc" | "started_asc" | "duration_desc";
type LocalKey = "description" | "member" | "project" | "tags";
type LocalSort = { key: LocalKey; direction: "asc" | "desc" } | null;

/** `yyyy-MM-dd HH:mm` (already member-local) to `h:mm AM`. */
function clock(local: string): string {
  const hours = Number(local.slice(11, 13));
  return `${hours % 12 || 12}:${local.slice(14, 16)} ${hours < 12 ? "AM" : "PM"}`;
}
function day(local: string): string {
  return `${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(0, 4)}`;
}
function timeRange(row: DetailedRow): { time: string; date: string } {
  const stop = row.running || !row.local_stop ? null : row.local_stop;
  const startDate = day(row.local_start);
  const stopDate = stop ? day(stop) : startDate;
  return {
    time: `${clock(row.local_start)} - ${stop ? clock(stop) : "running"}`,
    date: stopDate === startDate ? startDate : `${startDate} - ${stopDate}`,
  };
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
function localValue(row: DetailedRow, key: LocalKey): string {
  switch (key) {
    case "description":
      return row.description;
    case "member":
      return row.member.name;
    case "project":
      return row.project.name;
    case "tags":
      return row.tags.map((tag) => tag.name).join(", ");
  }
}

const cell =
  "border-stroke h-[59px] border-b py-1 pr-2 pl-[25px] text-sm leading-[17px] font-medium";

export function ReportDetailedTable({
  rows,
  loading,
  periodLabel,
  sort,
  onSortChange,
  hasPrevious,
  hasNext,
  onFirstPage,
  onNextPage,
}: {
  rows: DetailedRow[];
  loading: boolean;
  periodLabel: string;
  sort: DetailedSort;
  onSortChange: (sort: DetailedSort) => void;
  hasPrevious: boolean;
  hasNext: boolean;
  onFirstPage: () => void;
  onNextPage: () => void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const selectedCount = rows.filter((row) => selected.has(row.id)).length;
  // shortcut: text columns sort this page; use server ordering when the API supports it.
  const [local, setLocal] = useState<LocalSort>(null);
  const visible = useMemo(() => {
    if (!local) return rows;
    const sign = local.direction === "asc" ? 1 : -1;
    return [...rows].sort(
      (left, right) =>
        localValue(left, local.key).localeCompare(localValue(right, local.key), undefined, {
          sensitivity: "base",
        }) * sign,
    );
  }, [local, rows]);
  const localDirection = (key: LocalKey) => (local?.key === key ? local.direction : null);
  const toggleLocal = (key: LocalKey) =>
    setLocal((current) =>
      current?.key !== key
        ? { key, direction: "asc" }
        : current.direction === "asc"
          ? { key, direction: "desc" }
          : null,
    );
  const timeDirection = local
    ? null
    : sort === "started_asc"
      ? "asc"
      : sort === "started_desc"
        ? "desc"
        : null;
  const durationDirection = local ? null : sort === "duration_desc" ? "desc" : null;

  return (
    <ReportCard>
      <ReportCardHeader title={`Time entries from ${periodLabel}`} />
      {loading ? (
        <div className="mx-3 mb-3 h-48 animate-pulse rounded-lg bg-white/5" />
      ) : rows.length === 0 ? (
        <div className="px-3">
          <ReportEmpty className="" />
        </div>
      ) : (
        <div className="overflow-x-auto px-3 pb-2.5">
          <table className="w-full min-w-[1150px] table-fixed border-collapse text-left">
            <colgroup>
              <col style={{ width: 48 }} />
              <col style={{ width: 290 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 150 }} />
              <col />
              <col style={{ width: 64 }} />
            </colgroup>
            <thead>
              <tr>
                <ReportTh kind="edge">
                  <Checkbox
                    aria-label="Select all entries on this page"
                    checked={allSelected}
                    indeterminate={selectedCount > 0 && !allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)))
                    }
                  />
                </ReportTh>
                <ReportTh kind="lead">
                  <SortHeader
                    label="Description"
                    direction={localDirection("description")}
                    onToggle={() => toggleLocal("description")}
                  />
                </ReportTh>
                <ReportTh>
                  <SortHeader
                    label="Duration"
                    direction={durationDirection}
                    onToggle={() => {
                      setLocal(null);
                      onSortChange(sort === "duration_desc" ? "started_desc" : "duration_desc");
                    }}
                  />
                </ReportTh>
                <ReportTh>
                  <SortHeader
                    label="Member"
                    direction={localDirection("member")}
                    onToggle={() => toggleLocal("member")}
                  />
                </ReportTh>
                <ReportTh>
                  <SortHeader
                    label="Project"
                    direction={localDirection("project")}
                    onToggle={() => toggleLocal("project")}
                  />
                </ReportTh>
                <ReportTh>
                  <SortHeader
                    label="Tags"
                    direction={localDirection("tags")}
                    onToggle={() => toggleLocal("tags")}
                  />
                </ReportTh>
                <ReportTh>
                  <SortHeader
                    label="Time | Date"
                    direction={timeDirection}
                    onToggle={() => {
                      setLocal(null);
                      onSortChange(sort === "started_desc" ? "started_asc" : "started_desc");
                    }}
                  />
                </ReportTh>
                <ReportTh aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const { time, date } = timeRange(row);
                const muted = row.description === "No description";
                return (
                  <tr key={row.id} className="hover:bg-surface-hover/40">
                    <td className="border-stroke h-[59px] border-b text-center">
                      <Checkbox
                        aria-label={`Select ${row.description}`}
                        checked={selected.has(row.id)}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (!next.delete(row.id)) next.add(row.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className={`${cell} pl-[25px]`}>
                      <div className={`truncate ${muted ? "text-fg-subtle" : ""}`}>
                        {row.description}
                      </div>
                    </td>
                    <td className={cell}>
                      <span className="hover:bg-surface-hover -ml-[11px] inline-block rounded-lg p-2">
                        {formatClockDuration(row.raw_duration_ms)}
                      </span>
                    </td>
                    <td className={cell}>
                      <div className="flex items-center gap-2">
                        <span
                          className="bg-accent-muted-active text-accent-fg-active grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-semibold"
                          aria-hidden="true"
                        >
                          {initials(row.member.name)}
                        </span>
                        <span className="truncate" title={row.member.name}>
                          {row.member.name}
                        </span>
                      </div>
                    </td>
                    <td className={cell}>
                      {row.project.id ? (
                        <div
                          className="flex items-center gap-2"
                          style={row.project.color ? { color: row.project.color } : undefined}
                          title={row.client.name !== "No client" ? row.client.name : undefined}
                        >
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: row.project.color ?? "#808080" }}
                            aria-hidden="true"
                          />
                          <span className="truncate">{row.project.name}</span>
                        </div>
                      ) : (
                        <span className="text-fg-subtle">No project</span>
                      )}
                    </td>
                    <td className={cell}>
                      <div className="truncate" title={localValue(row, "tags")}>
                        {localValue(row, "tags")}
                      </div>
                    </td>
                    <td className={cell}>
                      <div className="-ml-[7px] inline-grid rounded-lg p-2 whitespace-nowrap">
                        <span>{time}</span>
                        <span>{date}</span>
                      </div>
                    </td>
                    <td className="border-stroke border-b" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <span className="sr-only" role="status">
        {selectedCount} entries selected on this page
      </span>
      {hasPrevious || hasNext ? (
        <div className="flex justify-end gap-2 px-3 pb-1">
          {hasPrevious ? (
            <Button variant="secondary" onClick={onFirstPage}>
              First page
            </Button>
          ) : null}
          <Button variant="secondary" disabled={!hasNext} onClick={onNextPage}>
            Next page
          </Button>
        </div>
      ) : null}
    </ReportCard>
  );
}
