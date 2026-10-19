import type { Tag } from "@/web/types";

export interface SummaryGroup {
  key: string;
  label: string;
  rawDurationMs: number;
  roundedDurationMs: number;
  billableDurationMs: number;
  nonBillableDurationMs: number;
  amounts?: Record<string, number>;
  percentOfTotal: number;
  budgetMinutes?: number;
  children?: SummaryGroup[];
}

export interface SummaryReport {
  generated_at: string;
  timezone: string;
  totals: {
    tracked_duration_ms: number;
    billable_duration_ms: number;
    non_billable_duration_ms: number;
    /** Days (member-local) with tracked time; older servers omit it. */
    tracked_days?: number;
    amounts?: Record<string, number>;
  };
  groups: SummaryGroup[];
}

export interface DetailedRow {
  id: string;
  date: string;
  member: { id: string; name: string };
  client: { id: string | null; name: string };
  project: { id: string | null; name: string; color: string | null };
  description: string;
  tags: Tag[];
  local_start: string;
  local_stop: string | null;
  raw_duration_ms: number;
  rounded_duration_ms: number;
  billable: boolean;
  running: boolean;
  rate_minor?: number | null;
  currency?: string | null;
  amount_minor?: number | null;
}

export const GROUP_DIMENSIONS = [
  "client",
  "project",
  "member",
  "day",
  "week",
  "month",
  "description",
] as const;
export type GroupDimension = (typeof GROUP_DIMENSIONS)[number];

/**
 * Breakdown menu order for dimensions Hourlark can group by, following Toggl's list
 * (Members, Clients, Projects, Descriptions). Toggl also lists Tasks and Tags, both
 * disabled; Hourlark has no task or tag grouping. Days, Weeks, and Months are Hourlark
 * time axes that Toggl's summary menu does not show.
 */
export const BREAKDOWN_DIMENSIONS: readonly GroupDimension[] = [
  "member",
  "client",
  "project",
  "description",
  "day",
  "week",
  "month",
];

/** Toggl names the breakdown dimensions in plural title case ("Projects"). */
export const DIMENSION_LABELS: Record<GroupDimension, string> = {
  client: "Clients",
  project: "Projects",
  member: "Members",
  day: "Days",
  week: "Weeks",
  month: "Months",
  description: "Descriptions",
};

/** Singular form used in card titles and the donut centre ("Project and member breakdown"). */
export const DIMENSION_SINGULAR: Record<GroupDimension, string> = {
  client: "client",
  project: "project",
  member: "member",
  day: "day",
  week: "week",
  month: "month",
  description: "description",
};

/** Slices only make sense for dimensions that are not a time axis. */
export const SLICE_DIMENSIONS: GroupDimension[] = ["project", "client", "member", "description"];
