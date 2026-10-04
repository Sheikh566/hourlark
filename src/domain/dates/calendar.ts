export type WeekStartsOn = 0 | 1;

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

/** Local midnight Date whose calendar fields match a yyyy-MM-dd string in any process zone. */
export function localCalendarDate(dateStr: string): Date {
  const { year, month, day } = parseDateParts(dateStr);
  return new Date(year, month - 1, day);
}
