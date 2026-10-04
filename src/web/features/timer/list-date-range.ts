import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const TIME_ENTRY_LIST_LIMIT = 5000;
export const EPOCH_START_ISO = "1970-01-01T00:00:00.000Z";

export type ListDatePreset =
  "today" | "yesterday" | "this_week" | "last_week" | "last_30_days" | "all" | "custom";

export type WeekStartsOn = 0 | 1;

export interface ListDateSelection {
  preset: ListDatePreset;
  startDate: string | null;
  endDate: string | null;
}

export interface ListApiRange {
  start: string;
  end: string;
}

export const ALL_DATES_SELECTION: ListDateSelection = {
  preset: "all",
  startDate: null,
  endDate: null,
};

export const LIST_DATE_PRESETS: Array<{
  id: Exclude<ListDatePreset, "custom">;
  label: string;
}> = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "this_week", label: "This week" },
  { id: "last_week", label: "Last week" },
  { id: "last_30_days", label: "Last 30 days" },
  { id: "all", label: "All dates" },
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function zonedToday(now: Date, timezone: string): string {
  return formatInTimeZone(now, timezone, "yyyy-MM-dd");
}

function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) throw new Error(`Invalid calendar date: ${dateStr}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function addCalendarDays(dateStr: string, days: number): string {
  const { year, month, day } = parseDateParts(dateStr);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export function weekdaySunday0(dateStr: string): number {
  const { year, month, day } = parseDateParts(dateStr);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function startOfWeekDate(dateStr: string, weekStartsOn: WeekStartsOn): string {
  const delta = (weekdaySunday0(dateStr) - weekStartsOn + 7) % 7;
  return addCalendarDays(dateStr, -delta);
}

export function inclusiveDayCount(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

export function zonedDayStartIso(dateStr: string, timezone: string): string {
  return fromZonedTime(`${dateStr}T00:00:00`, timezone).toISOString();
}

export function exclusiveEndIso(inclusiveEndDate: string, timezone: string): string {
  return zonedDayStartIso(addCalendarDays(inclusiveEndDate, 1), timezone);
}

export function selectionFromPreset(
  preset: Exclude<ListDatePreset, "custom">,
  now: Date,
  timezone: string,
  weekStartsOn: WeekStartsOn,
): ListDateSelection {
  if (preset === "all") return ALL_DATES_SELECTION;

  const today = zonedToday(now, timezone);
  if (preset === "today") {
    return { preset, startDate: today, endDate: today };
  }
  if (preset === "yesterday") {
    const yesterday = addCalendarDays(today, -1);
    return { preset, startDate: yesterday, endDate: yesterday };
  }
  if (preset === "this_week") {
    const startDate = startOfWeekDate(today, weekStartsOn);
    return { preset, startDate, endDate: addCalendarDays(startDate, 6) };
  }
  if (preset === "last_week") {
    const thisWeekStart = startOfWeekDate(today, weekStartsOn);
    const startDate = addCalendarDays(thisWeekStart, -7);
    return { preset, startDate, endDate: addCalendarDays(startDate, 6) };
  }
  return {
    preset: "last_30_days",
    startDate: addCalendarDays(today, -29),
    endDate: today,
  };
}

export function selectionFromInclusiveDates(
  startDate: string,
  endDate: string,
  now: Date,
  timezone: string,
  weekStartsOn: WeekStartsOn,
): ListDateSelection {
  const [from, to] = startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
  const presets: Array<Exclude<ListDatePreset, "custom" | "all">> = [
    "today",
    "yesterday",
    "this_week",
    "last_week",
    "last_30_days",
  ];
  for (const preset of presets) {
    const candidate = selectionFromPreset(preset, now, timezone, weekStartsOn);
    if (candidate.startDate === from && candidate.endDate === to) return candidate;
  }
  return { preset: "custom", startDate: from, endDate: to };
}

export function toApiRange(
  selection: ListDateSelection,
  now: Date,
  timezone: string,
): ListApiRange {
  if (selection.preset === "all" || !selection.startDate || !selection.endDate) {
    return {
      start: EPOCH_START_ISO,
      end: exclusiveEndIso(zonedToday(now, timezone), timezone),
    };
  }
  return {
    start: zonedDayStartIso(selection.startDate, timezone),
    end: exclusiveEndIso(selection.endDate, timezone),
  };
}

export function shiftSelection(
  selection: ListDateSelection,
  direction: -1 | 1,
  now: Date,
  timezone: string,
  weekStartsOn: WeekStartsOn,
): ListDateSelection {
  if (selection.preset === "all" || !selection.startDate || !selection.endDate) {
    return selection;
  }
  const days = inclusiveDayCount(selection.startDate, selection.endDate);
  return selectionFromInclusiveDates(
    addCalendarDays(selection.startDate, direction * days),
    addCalendarDays(selection.endDate, direction * days),
    now,
    timezone,
    weekStartsOn,
  );
}

export function listPeriodLabel(selection: ListDateSelection): string {
  if (selection.preset === "custom" && selection.startDate && selection.endDate) {
    return formatInclusiveLabel(selection.startDate, selection.endDate);
  }
  return LIST_DATE_PRESETS.find((preset) => preset.id === selection.preset)?.label ?? "All dates";
}

export function formatInclusiveLabel(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatDayLabel(startDate, true);
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  return `${formatDayLabel(startDate, !sameYear)} – ${formatDayLabel(endDate, !sameYear)}`;
}

export function formatDayLabel(dateStr: string, withYear = false): string {
  const year = dateStr.slice(0, 4);
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  return `${SHORT_MONTHS[month - 1]} ${day}${withYear ? `, ${year}` : ""}`;
}

export function formatMonthTitle(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}

export function parseYearMonth(dateStr: string): { year: number; month: number } {
  return { year: Number(dateStr.slice(0, 4)), month: Number(dateStr.slice(5, 7)) };
}

export function shiftYearMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
}

export function yearMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function monthCalendarDays(
  year: number,
  month: number,
  weekStartsOn: WeekStartsOn,
): string[] {
  const first = `${yearMonthKey(year, month)}-01`;
  const leading = (weekdaySunday0(first) - weekStartsOn + 7) % 7;
  const gridStart = addCalendarDays(first, -leading);
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(gridStart, index));
}

export function isTimeEntryListCapped(count: number): boolean {
  return count >= TIME_ENTRY_LIST_LIMIT;
}

export function timeEntryListCapMessage(count: number): string | null {
  if (!isTimeEntryListCapped(count)) return null;
  return (
    `Showing ${TIME_ENTRY_LIST_LIMIT.toLocaleString()} entries. ` +
    "This list may be incomplete. Narrow the date range or open reports for the full history."
  );
}

export function weekStartFromWorkspace(weekStart: "monday" | "sunday"): WeekStartsOn {
  return weekStart === "monday" ? 1 : 0;
}
