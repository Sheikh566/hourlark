import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildSummary } from "@/domain/reports/reporting";
import type { ReportRow } from "@/domain/reports/reporting";
import type { AuthenticatedMember, WorkspaceRow } from "@/domain/types";
import { ReportsPage } from "@/web/routes/reports";
import { chooseOption } from "./select-helpers";

const { apiRequestMock, apiDownloadMock, identity } = vi.hoisted(() => ({
  apiRequestMock: vi.fn<(path: string) => Promise<unknown>>(),
  apiDownloadMock: vi.fn(),
  identity: { timezone: "Asia/Karachi", financial: true, reportDetails: true, team: true },
}));
vi.mock("@/web/lib/api", () => ({ apiRequest: apiRequestMock, apiDownload: apiDownloadMock }));
vi.mock("@/web/app/context", () => ({
  useMe: () => ({
    member: { id: "m1", displayName: "Member", timezone: identity.timezone },
    workspace: {
      week_start: "monday",
      report_show_members: identity.reportDetails,
      report_show_descriptions: identity.reportDetails,
      report_show_tags: identity.reportDetails,
    },
    permissions: { view_team: identity.team, export: true, financial: identity.financial },
  }),
}));
vi.mock("recharts", () => {
  const container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: container,
    PieChart: container,
    Pie: container,
    BarChart: container,
    Cell: () => null,
    Tooltip: () => null,
    Bar: () => null,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    LabelList: () => null,
    useChartWidth: () => 600,
    useYAxisScale: () => (value: number) => value,
  };
});

let queryClient: QueryClient;
function renderPage() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ReportsPage />
    </QueryClientProvider>,
  );
}
function summaryRequests() {
  return apiRequestMock.mock.calls
    .map(([path]) => new URL(path, "https://hourlark.test"))
    .filter((url) => url.pathname === "/reports/summary");
}

async function selectFilter(label: string, names: Array<string | RegExp>) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: new RegExp(`^${label}(?::|$)`) }));
  const dialog = screen.getByRole("dialog", { name: `${label} filter` });
  for (const name of names) await user.click(await within(dialog).findByRole("checkbox", { name }));
  await user.click(within(dialog).getByRole("button", { name: /^(Add|Update)$/ }));
}

function requestFilters(url: URL) {
  return Object.fromEntries(
    [...url.searchParams].filter(
      ([key]) =>
        ["client_ids", "tag_ids", "filter_project_ids", "search"].includes(key) ||
        key.endsWith("_condition"),
    ),
  );
}

describe("report date and filter workflow", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T23:30:00Z"));
    identity.timezone = "Asia/Karachi";
    identity.financial = true;
    identity.reportDetails = true;
    identity.team = true;
    apiDownloadMock.mockReset();
    apiDownloadMock.mockResolvedValue(undefined);
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((path) => {
      if (path.startsWith("/reports/summary?"))
        return Promise.resolve({
          totals: {
            tracked_duration_ms: 3_600_000,
            tracked_days: 1,
            billable_duration_ms: 0,
            non_billable_duration_ms: 3_600_000,
            amounts: { USD: 1200 },
          },
          groups: [],
        });
      if (path === "/projects")
        return Promise.resolve({
          projects: [{ id: "p1", name: "Training", client_id: "c1", client_name: "Acme" }],
        });
      if (path === "/clients")
        return Promise.resolve({
          clients: [
            { id: "c1", name: "Acme" },
            { id: "c2", name: "Another client" },
          ],
        });
      if (path === "/tags")
        return Promise.resolve({
          tags: [
            { id: "t1", name: "Review" },
            { id: "t2", name: "Delivery" },
          ],
        });
      if (path === "/members") return Promise.resolve({ members: [] });
      if (path.startsWith("/reports/detailed?"))
        return Promise.resolve({ entries: [], next_cursor: null });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });
  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.useRealTimers();
  });

  it("uses the member-local week and inclusive display endpoints", async () => {
    renderPage();
    await screen.findByText("Total hours");
    expect(screen.getByRole("button", { name: "Report date range" })).toHaveTextContent(
      "This week W41",
    );
    const request = summaryRequests()[0];
    expect(request?.searchParams.get("start")).toBe("2026-10-04T19:00:00.000Z");
    expect(request?.searchParams.get("end")).toBe("2026-10-11T19:00:00.000Z");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Report date range" }));
    expect(screen.getByLabelText("Range start date")).toHaveValue("05/10/2026");
    expect(screen.getByLabelText("Range end date")).toHaveValue("11/10/2026");
    await user.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() =>
      expect(
        summaryRequests().some((url) => url.searchParams.get("end") === "2026-10-05T19:00:00.000Z"),
      ).toBe(true),
    );
    expect(screen.getByRole("button", { name: "Report date range" })).toHaveFocus();
  });

  it("keeps the Karachi week when the process zone is America/Los_Angeles", async () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      renderPage();
      await screen.findByText("Total hours");
      expect(screen.getByRole("button", { name: "Report date range" })).toHaveTextContent(
        "This week W41",
      );
      const request = summaryRequests()[0];
      expect(request?.searchParams.get("start")).toBe("2026-10-04T19:00:00.000Z");
      expect(request?.searchParams.get("end")).toBe("2026-10-11T19:00:00.000Z");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("groups report weeks in the member zone when the process zone is Asia/Karachi", () => {
    const previous = process.env.TZ;
    process.env.TZ = "Asia/Karachi";
    try {
      const clippedStart = Date.parse("2026-10-04T19:30:00.000Z");
      const row: ReportRow = {
        id: "entry",
        date: "2026-10-05",
        memberId: "member",
        memberName: "Member",
        clientId: null,
        clientName: "No client",
        projectId: null,
        projectName: "No project",
        projectColor: null,
        projectBudgetMinutes: null,
        description: "Work",
        tags: [],
        startedAt: clippedStart,
        stoppedAt: clippedStart + 60_000,
        clippedStart,
        clippedStop: clippedStart + 60_000,
        rawDurationMs: 60_000,
        roundedDurationMs: 60_000,
        billable: false,
        rateMinor: null,
        currency: null,
        amountMinor: null,
        running: false,
      };
      const viewer = {
        id: "member",
        workspaceId: "workspace",
        email: "member@example.com",
        displayName: "Member",
        role: "admin",
        status: "active",
        timezone: "Asia/Karachi",
        accessSubject: null,
      } satisfies AuthenticatedMember;
      const workspace = {
        id: "workspace",
        app_name: "Hourlark",
        company_name: "Example Company",
        company_domain: "example.com",
        timezone: "Asia/Karachi",
        currency: "USD",
        week_start: "monday",
        default_rate_minor: null,
        members_can_set_billable: 1,
        lock_entries_after_days: null,
        rounding_increment_minutes: 0,
        rounding_method: "nearest",
        report_show_descriptions: 1,
        report_show_tags: 1,
        report_show_members: 1,
        bootstrap_completed_at: null,
        created_at: 0,
        updated_at: 0,
        version: 1,
      } satisfies WorkspaceRow;
      expect(
        buildSummary([row], viewer, workspace, "week", undefined, "Asia/Karachi", clippedStart)
          .groups[0]?.key,
      ).toBe("2026-10-05");
      expect(
        buildSummary(
          [row],
          viewer,
          { ...workspace, week_start: "sunday" },
          "week",
          undefined,
          "Asia/Karachi",
          clippedStart,
        ).groups[0]?.key,
      ).toBe("2026-10-04");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("applies an inclusive custom range across fall DST", async () => {
    identity.timezone = "America/New_York";
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Report date range" }));
    await user.clear(screen.getByLabelText("Range start date"));
    await user.type(screen.getByLabelText("Range start date"), "01/11/2026");
    expect(screen.getByLabelText("Range start date")).toHaveValue("01/11/2026");
    await user.clear(screen.getByLabelText("Range end date"));
    await user.type(screen.getByLabelText("Range end date"), "01/11/2026");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(
        summaryRequests().some(
          (url) =>
            url.searchParams.get("start") === "2026-11-01T04:00:00.000Z" &&
            url.searchParams.get("end") === "2026-11-02T05:00:00.000Z",
        ),
      ).toBe(true),
    );
    expect(screen.getByRole("dialog", { name: "Choose report dates" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Report date range" })).toHaveFocus();
  });

  it("uses workspace PDF defaults, shows export errors and allows retry", async () => {
    identity.reportDetails = false;
    renderPage();
    const user = userEvent.setup();
    await screen.findByText("Total hours");
    await selectFilter("Client", ["Acme"]);
    await user.click(screen.getByRole("button", { name: "Export" }));
    await user.click(screen.getByRole("menuitem", { name: "PDF" }));
    const dialog = screen.getByRole("dialog", { name: "Client-ready Time Report" });
    expect(within(dialog).getByRole("checkbox", { name: "Member names" })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Descriptions" })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Tags" })).not.toBeChecked();
    apiDownloadMock.mockRejectedValueOnce(new Error("PDF temporarily unavailable"));
    await user.click(within(dialog).getByRole("button", { name: "Generate PDF" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "PDF temporarily unavailable",
    );
    await user.click(within(dialog).getByRole("button", { name: "Generate PDF" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(apiDownloadMock).toHaveBeenLastCalledWith(
      "/exports/pdf",
      expect.objectContaining({
        client_id: "c1",
        show_members: false,
        show_descriptions: false,
        show_tags: false,
      }),
      "time-report.pdf",
    );
  });

  it.each(["contains", "is_empty"])(
    "shares multiselect and description %s filters across report views and exports",
    async (condition) => {
      renderPage();
      const user = userEvent.setup();
      await screen.findByText("Total hours");
      await selectFilter("Client", ["Acme", "Another client"]);
      if (condition === "contains") {
        await selectFilter("Tag", ["Review", "Delivery"]);
      } else {
        await user.click(screen.getByRole("button", { name: "Tag" }));
        const tagDialog = screen.getByRole("dialog", { name: "Tag filter" });
        await user.click(within(tagDialog).getByRole("button", { name: "Condition" }));
        await user.click(within(tagDialog).getByRole("option", { name: "is empty" }));
        await user.click(within(tagDialog).getByRole("button", { name: "Add" }));
      }
      await user.click(screen.getByRole("button", { name: "Description" }));
      const descriptionDialog = screen.getByRole("dialog", { name: "Description filter" });
      await user.click(within(descriptionDialog).getByRole("button", { name: "Condition" }));
      await user.click(
        within(descriptionDialog).getByRole("option", {
          name: condition === "contains" ? "contains" : "is empty",
        }),
      );
      if (condition === "contains")
        await user.type(
          within(descriptionDialog).getByRole("textbox", { name: "Match criteria" }),
          "handoff",
        );
      await user.click(within(descriptionDialog).getByRole("button", { name: "Add" }));
      const expected = {
        client_ids: "c1,c2",
        client_condition: "is",
        tag_condition: condition === "contains" ? "is" : "is_empty",
        description_condition: condition,
        ...(condition === "contains" ? { tag_ids: "t1,t2", search: "handoff" } : {}),
      };
      for (const groupBy of ["project", "day"]) {
        await waitFor(() =>
          expect(
            summaryRequests()
              .filter((url) => url.searchParams.get("group_by") === groupBy)
              .map(requestFilters),
          ).toContainEqual(expected),
        );
      }
      await user.click(screen.getByRole("tab", { name: "Detailed" }));
      await waitFor(() => {
        const detailed = apiRequestMock.mock.calls
          .map(([path]) => new URL(path, "https://hourlark.test"))
          .filter((url) => url.pathname === "/reports/detailed")
          .at(-1);
        expect(detailed && requestFilters(detailed)).toEqual(expected);
      });
      await user.click(screen.getByRole("button", { name: "Export" }));
      await user.click(screen.getByRole("menuitem", { name: "CSV" }));
      expect(apiDownloadMock).toHaveBeenLastCalledWith(
        "/exports/csv",
        expect.objectContaining({ ...expected, mode: "detailed" }),
        "hourlark-detailed.csv",
      );
      await user.click(screen.getByRole("button", { name: "Export" }));
      await user.click(screen.getByRole("menuitem", { name: "PDF" }));
      const pdf = screen.getByRole("dialog", { name: "Client-ready Time Report" });
      expect(within(pdf).getByRole("button", { name: "Generate PDF" })).toBeDisabled();
      await chooseOption(user, within(pdf).getByRole("combobox", { name: /^Client/ }), "Acme");
      await user.click(within(pdf).getByRole("checkbox", { name: "Training" }));
      await user.click(within(pdf).getByRole("button", { name: "Generate PDF" }));
      expect(apiDownloadMock).toHaveBeenLastCalledWith(
        "/exports/pdf",
        expect.objectContaining({
          ...expected,
          client_ids: "c1",
          client_id: "c1",
          project_ids: ["p1"],
        }),
        "time-report.pdf",
      );
      await waitFor(() => {
        const detailed = apiRequestMock.mock.calls
          .map(([path]) => new URL(path, "https://hourlark.test"))
          .filter((url) => url.pathname === "/reports/detailed")
          .at(-1);
        expect(detailed && requestFilters(detailed)).toEqual({ ...expected, client_ids: "c1" });
      });
    },
  );

  it("keeps financial totals hidden from members", async () => {
    identity.financial = false;
    identity.team = false;
    renderPage();
    const totals = await screen.findByLabelText("Report totals");
    expect(within(totals).queryByText("Amount")).not.toBeInTheDocument();
    expect(within(totals).getByText("Average daily hours")).toBeVisible();
    expect(within(totals).getByText("1.00")).toHaveTextContent("1.00Hours");
    expect(screen.queryByRole("button", { name: "Member" })).not.toBeInTheDocument();
    expect(screen.getByTitle("Members can view their own time entries")).toHaveTextContent(
      "Member is Member",
    );
  });
});
