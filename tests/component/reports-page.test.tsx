import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReportsPage } from "@/web/routes/reports";

const { apiRequestMock, apiDownloadMock, identity } = vi.hoisted(() => ({
  apiRequestMock: vi.fn<(path: string) => Promise<unknown>>(),
  apiDownloadMock: vi.fn(),
  identity: { timezone: "Asia/Karachi", financial: true, reportDetails: true },
}));
vi.mock("@/web/lib/api", () => ({ apiRequest: apiRequestMock, apiDownload: apiDownloadMock }));
vi.mock("@/web/app/context", () => ({
  useMe: () => ({
    member: { timezone: identity.timezone },
    workspace: {
      week_start: "monday",
      report_show_members: identity.reportDetails,
      report_show_descriptions: identity.reportDetails,
      report_show_tags: identity.reportDetails,
    },
    permissions: { view_team: true, export: true, financial: identity.financial },
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

describe("report date and filter workflow", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T23:30:00Z"));
    identity.timezone = "Asia/Karachi";
    identity.financial = true;
    identity.reportDetails = true;
    apiDownloadMock.mockReset();
    apiDownloadMock.mockResolvedValue(undefined);
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((path) => {
      if (path.startsWith("/reports/summary?"))
        return Promise.resolve({
          totals: {
            tracked_duration_ms: 3_600_000,
            billable_duration_ms: 0,
            non_billable_duration_ms: 3_600_000,
            amounts: { USD: 1200 },
          },
          groups: [],
        });
      if (path === "/projects")
        return Promise.resolve({
          projects: [{ id: "p1", name: "Training", client_id: "c1", client_name: "IOMechs" }],
        });
      if (path === "/clients")
        return Promise.resolve({
          clients: [
            { id: "c1", name: "IOMechs" },
            { id: "c2", name: "Another client" },
          ],
        });
      if (path === "/tags") return Promise.resolve({ tags: [] });
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
    await screen.findByText("Total Hours");
    expect(screen.getByRole("button", { name: "Report date range" })).toHaveTextContent(
      "5 Oct 2026 – 11 Oct 2026",
    );
    const request = summaryRequests()[0];
    expect(request?.searchParams.get("start")).toBe("2026-10-04T19:00:00.000Z");
    expect(request?.searchParams.get("end")).toBe("2026-10-11T19:00:00.000Z");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Report date range" }));
    await user.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() =>
      expect(
        summaryRequests().some((url) => url.searchParams.get("end") === "2026-10-05T19:00:00.000Z"),
      ).toBe(true),
    );
    expect(screen.getByRole("button", { name: "Report date range" })).toHaveFocus();
  });

  it("applies an inclusive custom range across fall DST", async () => {
    identity.timezone = "America/New_York";
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Report date range" }));
    await user.clear(screen.getByLabelText("Range start date"));
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    await user.type(screen.getByLabelText("Range start date"), "2026-11-01");
    expect(screen.getByLabelText("Range start date")).toHaveValue("2026-11-01");
    await user.clear(screen.getByLabelText("Range end date"));
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    await user.type(screen.getByLabelText("Range end date"), "2026-11-01");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(
        summaryRequests().some(
          (url) =>
            url.searchParams.get("start") === "2026-11-01T04:00:00.000Z" &&
            url.searchParams.get("end") === "2026-11-02T05:00:00.000Z",
        ),
      ).toBe(true),
    );
  });

  it("clears a stale project when its client changes and supports clearing filters", async () => {
    renderPage();
    const user = userEvent.setup();
    await screen.findByRole("option", { name: "Training" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Project" }), "p1");
    await user.selectOptions(screen.getByRole("combobox", { name: "Client" }), "c2");
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("combobox", { name: "Client" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Report date range" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Choose report dates" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report date range" })).toHaveFocus();
  });

  it("uses workspace PDF defaults, shows export errors and allows retry", async () => {
    identity.reportDetails = false;
    renderPage();
    const user = userEvent.setup();
    await screen.findByRole("option", { name: "IOMechs" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Client" }), "c1");
    await user.click(screen.getByRole("button", { name: "Time Report PDF" }));
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

  it("keeps financial totals hidden from members", async () => {
    identity.financial = false;
    renderPage();
    const totals = await screen.findByLabelText("Report totals");
    expect(within(totals).queryByText("Amount")).not.toBeInTheDocument();
    expect(within(totals).getByText("Average Daily Hours")).toBeVisible();
  });
});
