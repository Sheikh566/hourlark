import { parseRuntimeConfig } from "@/worker/env";
import type { ApiError } from "@/worker/errors";
import { detailedCsv } from "@/worker/exports/csv";
import type { ReportRow } from "@/domain/reports/reporting";
import { describe, expect, it } from "vitest";

const baseEnvironment = {
  ENVIRONMENT: "production",
  AUTH_MODE: "access",
  APP_NAME: "IOMechs Time",
  COMPANY_NAME: "IOMechs",
  COMPANY_DOMAIN: "iomechs.com",
  DEFAULT_TIMEZONE: "Asia/Karachi",
  DEFAULT_CURRENCY: "USD",
  DEFAULT_WEEK_START: "monday",
  ACCESS_TEAM_DOMAIN: "https://iomechs.cloudflareaccess.com",
  ACCESS_AUD: "audience",
  BOOTSTRAP_ADMIN_EMAILS: "",
  CSRF_SECRET: "production-secret-at-least-24-characters",
} satisfies Record<string, string>;

describe("production security gates", () => {
  it("refuses development authentication in production", () => {
    expect(() =>
      parseRuntimeConfig({ ...baseEnvironment, AUTH_MODE: "dev" } as unknown as Env),
    ).toThrowError(
      expect.objectContaining<Partial<ApiError>>({ code: "development_auth_forbidden" }),
    );
  });

  it("fails closed when Cloudflare Access contains placeholders", () => {
    expect(() =>
      parseRuntimeConfig({
        ...baseEnvironment,
        ACCESS_TEAM_DOMAIN: "None",
      } as unknown as Env),
    ).toThrowError(expect.objectContaining<Partial<ApiError>>({ code: "access_not_configured" }));
  });
});

describe("CSV export hardening", () => {
  it("quotes newlines and protects spreadsheet formulas", () => {
    const row: ReportRow = {
      id: "entry",
      memberId: "member",
      memberName: '=HYPERLINK("https://bad")',
      clientId: null,
      clientName: "Client, Inc.",
      projectId: null,
      projectName: "Project",
      projectColor: null,
      projectBudgetMinutes: null,
      description: "line one\nline two",
      tags: [],
      startedAt: 0,
      stoppedAt: 3_600_000,
      clippedStart: 0,
      clippedStop: 3_600_000,
      rawDurationMs: 3_600_000,
      roundedDurationMs: 3_600_000,
      billable: false,
      rateMinor: null,
      currency: null,
      amountMinor: null,
      running: false,
      date: "1970-01-01",
    };
    const csv = detailedCsv([row], "UTC");
    expect(csv).toContain('"\'=HYPERLINK(""https://bad"")"');
    expect(csv).toContain('"Client, Inc."');
    expect(csv).toContain('"line one\nline two"');
    expect(csv).toContain("\r\n");
  });
});
