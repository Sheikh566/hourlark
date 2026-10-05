import {
  amountMinorForDuration,
  formatInclusivePeriod,
  localDateTimeToEpoch,
  overlapDuration,
  roundDuration,
} from "@/domain/dates/time";
import { currencyFractionDigits, majorToMinor, minorToMajor } from "@/domain/billing/money";
import { describe, expect, it } from "vitest";

describe("time calculations", () => {
  it("clips entries using half-open report intervals", () => {
    expect(overlapDuration(0, 10_000, 5_000, 8_000)).toBe(3_000);
    expect(overlapDuration(0, 5_000, 5_000, 8_000)).toBe(0);
  });

  it("rounds duration only for reporting", () => {
    expect(roundDuration(7 * 60_000, 15, "nearest")).toBe(0);
    expect(roundDuration(7 * 60_000, 15, "up")).toBe(15 * 60_000);
    expect(roundDuration(16 * 60_000, 15, "down")).toBe(15 * 60_000);
  });

  it("calculates minor-unit amounts without floating stored duration", () => {
    expect(amountMinorForDuration(90 * 60_000, 10_000)).toBe(15_000);
  });

  it("formats an inclusive PDF period in the member zone", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(
        formatInclusivePeriod(
          "2026-10-04T19:00:00.000Z",
          "2026-10-11T19:00:00.000Z",
          "Asia/Karachi",
        ),
      ).toBe("2026-10-05 to 2026-10-11");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("converts IANA local wall time across daylight-saving changes", () => {
    expect(localDateTimeToEpoch("2026-03-08T03:30:00", "America/New_York")).toBe(
      Date.parse("2026-03-08T07:30:00.000Z"),
    );
  });

  it("respects ISO 4217 currency fraction digits", () => {
    expect(currencyFractionDigits("JPY")).toBe(0);
    expect(majorToMinor("123", "JPY")).toBe(123);
    expect(currencyFractionDigits("KWD")).toBe(3);
    expect(majorToMinor("1.234", "KWD")).toBe(1_234);
    expect(minorToMajor(1_234, "KWD")).toBe(1.234);
  });
});
