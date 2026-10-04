import { describe, expect, it } from "vitest";
import { CalendarTimeZone } from "@/web/features/time/calendar-timezone";

describe("calendar named timezone", () => {
  it("converts an actual UTC instant to Karachi wall time without dropping milliseconds", () => {
    const zone = new CalendarTimeZone("Asia/Karachi");
    expect(zone.timestampToArray(Date.parse("2026-10-04T04:00:17.123Z"))).toEqual([
      2026, 9, 4, 9, 0, 17, 123,
    ]);
    expect(zone.offsetForArray([2026, 9, 4, 9, 0, 17, 123])).toBe(300);
  });
  it("changes New York offsets at daylight-saving boundaries", () => {
    const zone = new CalendarTimeZone("America/New_York");
    expect(zone.offsetForArray([2026, 2, 8, 1, 30])).toBe(-300);
    expect(zone.offsetForArray([2026, 2, 8, 3, 30])).toBe(-240);
    expect(zone.offsetForArray([2026, 10, 1, 0, 30])).toBe(-240);
    expect(zone.offsetForArray([2026, 10, 1, 2, 30])).toBe(-300);
  });
});
