import { formatInTimeZone } from "date-fns-tz";

import { amountMinorForDuration, overlapDuration, roundDuration } from "@/domain/dates/time";
import { hasFinancialAccess } from "@/domain/permissions/policy";
import type { AuthenticatedMember, WorkspaceRow } from "@/domain/types";
import { parseTags, type EntryJoinedRow } from "@/db/repositories/time-entries";
import { startOfWeekDate } from "@/domain/dates/calendar";

export type GroupDimension =
  "client" | "project" | "member" | "day" | "week" | "month" | "description";

export interface ReportRow {
  id: string;
  date: string;
  memberId: string;
  memberName: string;
  clientId: string | null;
  clientName: string;
  projectId: string | null;
  projectName: string;
  projectColor: string | null;
  projectBudgetMinutes: number | null;
  description: string;
  tags: ReturnType<typeof parseTags>;
  startedAt: number;
  stoppedAt: number | null;
  clippedStart: number;
  clippedStop: number;
  rawDurationMs: number;
  roundedDurationMs: number;
  billable: boolean;
  rateMinor: number | null;
  currency: string | null;
  amountMinor: number | null;
  running: boolean;
}

export interface ReportGroup {
  key: string;
  label: string;
  rawDurationMs: number;
  roundedDurationMs: number;
  billableDurationMs: number;
  nonBillableDurationMs: number;
  amounts: Record<string, number>;
  percentOfTotal: number;
  budgetMinutes?: number;
  children?: ReportGroup[];
}

export function toReportRows(
  entries: EntryJoinedRow[],
  workspace: WorkspaceRow,
  rangeStart: number,
  rangeEnd: number,
  generatedAt: number,
  timezone: string,
): ReportRow[] {
  return entries
    .map((entry) => {
      const effectiveStop = entry.stopped_at ?? generatedAt;
      const rawDurationMs = overlapDuration(entry.started_at, effectiveStop, rangeStart, rangeEnd);
      const roundedDurationMs = entry.billable
        ? roundDuration(
            rawDurationMs,
            workspace.rounding_increment_minutes,
            workspace.rounding_method,
          )
        : rawDurationMs;
      return {
        id: entry.id,
        date: formatInTimeZone(Math.max(entry.started_at, rangeStart), timezone, "yyyy-MM-dd"),
        memberId: entry.member_id,
        memberName: entry.member_name,
        clientId: entry.client_id,
        clientName: entry.client_name ?? "No client",
        projectId: entry.project_id,
        projectName: entry.project_name ?? "No project",
        projectColor: entry.project_color,
        projectBudgetMinutes: entry.project_budget_minutes,
        description: entry.description || "No description",
        tags: parseTags(entry.tags_json),
        startedAt: entry.started_at,
        stoppedAt: entry.stopped_at,
        clippedStart: Math.max(entry.started_at, rangeStart),
        clippedStop: Math.min(effectiveStop, rangeEnd),
        rawDurationMs,
        roundedDurationMs,
        billable: entry.billable === 1,
        rateMinor: entry.rate_minor,
        currency: entry.rate_currency,
        amountMinor:
          entry.billable === 1 && entry.rate_minor !== null
            ? amountMinorForDuration(roundedDurationMs, entry.rate_minor)
            : null,
        running: entry.stopped_at === null,
      };
    })
    .filter((row) => row.rawDurationMs > 0);
}

function groupValue(
  row: ReportRow,
  dimension: GroupDimension,
  timezone: string,
  weekStartsOn: 0 | 1,
): { key: string; label: string } {
  switch (dimension) {
    case "client":
      return { key: row.clientId ?? "none", label: row.clientName };
    case "project":
      return { key: row.projectId ?? "none", label: row.projectName };
    case "member":
      return { key: row.memberId, label: row.memberName };
    case "description":
      return { key: row.description.toLocaleLowerCase(), label: row.description };
    case "day":
      return {
        key: formatInTimeZone(row.clippedStart, timezone, "yyyy-MM-dd"),
        label: formatInTimeZone(row.clippedStart, timezone, "EEE, MMM d, yyyy"),
      };
    case "month":
      return {
        key: formatInTimeZone(row.clippedStart, timezone, "yyyy-MM"),
        label: formatInTimeZone(row.clippedStart, timezone, "MMMM yyyy"),
      };
    case "week": {
      const day = formatInTimeZone(row.clippedStart, timezone, "yyyy-MM-dd");
      const key = startOfWeekDate(day, weekStartsOn);
      return { key, label: `Week of ${key}` };
    }
  }
}

function buildGroups(
  rows: ReportRow[],
  dimension: GroupDimension,
  secondary: GroupDimension | undefined,
  timezone: string,
  weekStartsOn: 0 | 1,
  totalDuration: number,
): ReportGroup[] {
  const buckets = new Map<string, { label: string; rows: ReportRow[] }>();
  for (const row of rows) {
    const value = groupValue(row, dimension, timezone, weekStartsOn);
    const bucket = buckets.get(value.key) ?? { label: value.label, rows: [] };
    bucket.rows.push(row);
    buckets.set(value.key, bucket);
  }
  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const rawDurationMs = bucket.rows.reduce((sum, row) => sum + row.rawDurationMs, 0);
      const amounts: Record<string, number> = {};
      for (const row of bucket.rows) {
        if (row.currency && row.amountMinor !== null) {
          amounts[row.currency] = (amounts[row.currency] ?? 0) + row.amountMinor;
        }
      }
      return {
        key,
        label: bucket.label,
        rawDurationMs,
        roundedDurationMs: bucket.rows.reduce((sum, row) => sum + row.roundedDurationMs, 0),
        billableDurationMs: bucket.rows
          .filter((row) => row.billable)
          .reduce((sum, row) => sum + row.roundedDurationMs, 0),
        nonBillableDurationMs: bucket.rows
          .filter((row) => !row.billable)
          .reduce((sum, row) => sum + row.rawDurationMs, 0),
        amounts,
        percentOfTotal: totalDuration === 0 ? 0 : (rawDurationMs / totalDuration) * 100,
        budgetMinutes:
          dimension === "project"
            ? (bucket.rows.find((row) => row.projectBudgetMinutes !== null)?.projectBudgetMinutes ??
              undefined)
            : undefined,
        children: secondary
          ? buildGroups(bucket.rows, secondary, undefined, timezone, weekStartsOn, rawDurationMs)
          : undefined,
      };
    })
    .sort(
      (left, right) =>
        right.rawDurationMs - left.rawDurationMs || left.label.localeCompare(right.label),
    );
}

export function buildSummary(
  rows: ReportRow[],
  viewer: AuthenticatedMember,
  workspace: WorkspaceRow,
  primary: GroupDimension,
  secondary: GroupDimension | undefined,
  timezone: string,
  generatedAt: number,
) {
  const totalDurationMs = rows.reduce((sum, row) => sum + row.rawDurationMs, 0);
  const billableDurationMs = rows
    .filter((row) => row.billable)
    .reduce((sum, row) => sum + row.roundedDurationMs, 0);
  const amounts: Record<string, number> = {};
  if (hasFinancialAccess(viewer.role)) {
    for (const row of rows) {
      if (row.currency && row.amountMinor !== null) {
        amounts[row.currency] = (amounts[row.currency] ?? 0) + row.amountMinor;
      }
    }
  }
  const groups = buildGroups(
    rows,
    primary,
    secondary,
    timezone,
    workspace.week_start === "monday" ? 1 : 0,
    totalDurationMs,
  ).map((group) =>
    hasFinancialAccess(viewer.role)
      ? group
      : {
          ...group,
          amounts: undefined,
          children: group.children?.map((child) => ({ ...child, amounts: undefined })),
        },
  );
  return {
    generated_at: new Date(generatedAt).toISOString(),
    timezone,
    totals: {
      tracked_duration_ms: totalDurationMs,
      billable_duration_ms: billableDurationMs,
      non_billable_duration_ms:
        totalDurationMs -
        rows.filter((row) => row.billable).reduce((sum, row) => sum + row.rawDurationMs, 0),
      ...(hasFinancialAccess(viewer.role) ? { amounts } : {}),
    },
    groups,
  };
}
