import { createPlugin } from "@fullcalendar/core";
import { NamedTimeZoneImpl } from "@fullcalendar/core/internal";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

// FullCalendar v6 needs a named-zone provider; otherwise it coerces local times to UTC.
export class CalendarTimeZone extends NamedTimeZoneImpl {
  timestampToArray(timestamp: number): number[] {
    const parts = formatInTimeZone(timestamp, this.timeZoneName, "yyyy MM dd HH mm ss SSS")
      .split(" ")
      .map(Number);
    parts[1] = (parts[1] ?? 1) - 1;
    return parts;
  }

  offsetForArray(parts: number[]): number {
    const wall = new Date(
      Date.UTC(
        parts[0] ?? 1970,
        parts[1] ?? 0,
        parts[2] ?? 1,
        parts[3] ?? 0,
        parts[4] ?? 0,
        parts[5] ?? 0,
        parts[6] ?? 0,
      ),
    );
    const instant = fromZonedTime(wall.toISOString().slice(0, -1), this.timeZoneName);
    return (wall.getTime() - instant.getTime()) / 60_000;
  }
}

export const calendarTimezonePlugin = createPlugin({
  name: "hourlark-timezone",
  namedTimeZonedImpl: CalendarTimeZone,
});
