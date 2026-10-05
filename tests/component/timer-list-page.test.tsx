import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TimeEntry } from "@/web/types";
import { TimePage } from "@/web/routes/time";

const apiRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/web/lib/api", () => ({
  apiRequest: apiRequestMock,
  idempotencyKey: () => "00000000-0000-4000-8000-000000000999",
  ApiClientError: class ApiClientError extends Error {
    code = "api_error";
  },
}));

vi.mock("@/web/hooks/use-now", () => ({
  useNow: () => Date.parse("2026-10-04T12:00:00.000Z"),
}));

vi.mock("@/web/routes/calendar", () => ({
  CalendarView: ({ weekStart }: { weekStart: Date }) => (
    <div data-testid="calendar-date">{weekStart.toISOString()}</div>
  ),
}));

vi.mock("@/web/features/timer/timesheet-view", () => ({
  TimesheetView: () => <div>Timesheet stub</div>,
}));

vi.mock("@/web/app/context", () => ({
  useMe: () => ({
    member: {
      id: "member-1",
      role: "admin",
      timezone: "Asia/Karachi",
    },
    workspace: {
      currency: "USD",
      week_start: "sunday",
      members_can_set_billable: true,
    },
    permissions: {
      view_team: true,
      financial: true,
    },
  }),
}));

function renderPage(path = "/") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <TimePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { view, queryClient };
}

function timeEntriesUrl(path: string): URL | null {
  if (!path.startsWith("/time-entries?")) return null;
  return new URL(path, "https://hourlark.test");
}

describe("timer list date range", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((path: string) => {
      if (path === "/projects?status=active") return Promise.resolve({ projects: [] });
      if (path === "/tags?status=active") return Promise.resolve({ tags: [] });
      if (path.startsWith("/time-entries?")) {
        return Promise.resolve({ entries: [], generated_at: "2026-10-04T12:00:00.000Z" });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });

  it("requests All dates from epoch with the public API cap and an empty-period message", async () => {
    const { view, queryClient } = renderPage();

    await screen.findByText("No entries in the selected period");
    expect(
      screen.getAllByRole("link", { name: "View full history in reports" }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("No time recorded yet")).not.toBeInTheDocument();

    const listQuery = apiRequestMock.mock.calls
      .map(([path]) => timeEntriesUrl(String(path)))
      .find((url) => url?.searchParams.get("start") === "1970-01-01T00:00:00.000Z");
    expect(listQuery?.searchParams.get("limit")).toBe("5000");
    expect(listQuery?.searchParams.get("end")).toBe("2026-10-04T19:00:00.000Z");

    view.unmount();
    queryClient.clear();
  });

  it("selects Today from the date-range popover using member timezone bounds", async () => {
    const user = userEvent.setup();
    const { view, queryClient } = renderPage();
    await screen.findByTitle("Choose date range");

    await user.click(screen.getByTitle("Choose date range"));
    await user.click(await screen.findByRole("button", { name: "Today" }));

    await waitFor(() => {
      const todayQuery = apiRequestMock.mock.calls
        .map(([path]) => timeEntriesUrl(String(path)))
        .find((url) => {
          if (!url) return false;
          return (
            url.searchParams.get("start") === "2026-10-03T19:00:00.000Z" &&
            url.searchParams.get("end") === "2026-10-04T19:00:00.000Z"
          );
        });
      expect(todayQuery?.searchParams.get("limit")).toBe("5000");
    });
    expect(screen.getByRole("button", { name: /Today/ })).toBeVisible();
    expect(await screen.findByRole("button", { name: "Show all dates" })).toBeVisible();

    view.unmount();
    queryClient.clear();
  });
});

const sample = (id: string): TimeEntry => ({
  id,
  member: { id: "member-1", name: "Member" },
  project: null,
  client: null,
  description: id,
  tags: [],
  started_at: "2026-10-04T04:00:00Z",
  stopped_at: "2026-10-04T05:00:00Z",
  duration_ms: 3600000,
  running: false,
  billable: false,
  deleted_at: null,
  created_at: "2026-10-04T05:00:00Z",
  updated_at: "2026-10-04T05:00:00Z",
  version: 1,
});

describe("timer actions", () => {
  afterEach(cleanup);
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((path: string) => {
      if (path.startsWith("/projects")) return Promise.resolve({ projects: [] });
      if (path.startsWith("/tags")) return Promise.resolve({ tags: [] });
      if (path.startsWith("/time-entries?"))
        return Promise.resolve({ entries: [sample("First"), sample("Second")] });
      return Promise.resolve({});
    });
  });

  it("dismisses menus outside and with Escape, and keeps only one open", async () => {
    const user = userEvent.setup();
    renderPage();
    const menus = await screen.findAllByRole("button", { name: "More actions" });
    await user.click(menus[0] as HTMLElement);
    expect(screen.getByRole("button", { name: "Delete" })).toBeVisible();
    await user.click(menus[1] as HTMLElement);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
    expect(menus[0]).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(menus[1]).toHaveFocus();
    await user.click(menus[0] as HTMLElement);
    await user.click(screen.getByRole("heading", { name: "Timer" }));
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("preserves partial deletion successes for Undo", async () => {
    const user = userEvent.setup();
    const deleted = new Set<string>();
    const restored: string[] = [];
    apiRequestMock.mockImplementation((path: string, options?: { method: string }) => {
      if (path.startsWith("/projects")) return Promise.resolve({ projects: [] });
      if (path.startsWith("/tags")) return Promise.resolve({ tags: [] });
      if (path.startsWith("/time-entries?"))
        return Promise.resolve({
          entries: [sample("First"), sample("Second")].filter((entry) => !deleted.has(entry.id)),
        });
      if (options?.method === "DELETE") {
        const id = path.split("/")[2] ?? "";
        if (id === "Second") return Promise.reject(new Error("Locked"));
        deleted.add(id);
      }
      if (path.endsWith("/restore")) {
        const id = path.split("/")[2] ?? "";
        restored.push(id);
        deleted.delete(id);
      }
      return Promise.resolve({});
    });
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "Select First" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Second" }));
    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Second: Locked");
    expect(screen.getByText("Entry deleted.")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Select Second" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(restored).toEqual(["First"]));
    expect(await screen.findByRole("checkbox", { name: "Select First" })).not.toBeChecked();
  });

  it("restores all successful deletions and preserves failed restores for retry", async () => {
    const user = userEvent.setup();
    const deleted = new Set<string>();
    const restores: string[] = [];
    let rejectSecond = true;
    apiRequestMock.mockImplementation((path: string, options?: { method: string }) => {
      if (path.startsWith("/projects")) return Promise.resolve({ projects: [] });
      if (path.startsWith("/tags")) return Promise.resolve({ tags: [] });
      if (path.startsWith("/time-entries?"))
        return Promise.resolve({
          entries: [sample("First"), sample("Second")].filter((entry) => !deleted.has(entry.id)),
        });
      const id = path.split("/")[2] ?? "";
      if (options?.method === "DELETE") deleted.add(id);
      if (path.endsWith("/restore")) {
        restores.push(id);
        if (id === "Second" && rejectSecond)
          return Promise.reject(new Error("Restore unavailable"));
        deleted.delete(id);
      }
      return Promise.resolve({});
    });
    renderPage();
    await user.click(
      await screen.findByRole("checkbox", { name: "Select all entries for 2026-10-04" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete selected" }));
    await screen.findByText("2 entries deleted.");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Restore unavailable");
    expect(restores).toEqual(["First", "Second"]);
    rejectSecond = false;
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument(),
    );
    expect(restores).toEqual(["First", "Second", "Second"]);
  });

  it("navigates by days in calendar day view and by weeks in week view", async () => {
    const user = userEvent.setup();
    renderPage("/time?view=calendar");
    expect(screen.queryByRole("combobox", { name: "Timer member" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Calendar density" }), "day");
    const before = Date.parse(screen.getByTestId("calendar-date").textContent);
    await user.click(screen.getByRole("button", { name: "Select following period" }));
    expect(Date.parse(screen.getByTestId("calendar-date").textContent) - before).toBe(86400000);
    await user.click(screen.getByRole("button", { name: "Select previous period" }));
    expect(Date.parse(screen.getByTestId("calendar-date").textContent)).toBe(before);
    await user.selectOptions(screen.getByRole("combobox", { name: "Calendar density" }), "week");
    const week = Date.parse(screen.getByTestId("calendar-date").textContent);
    await user.click(screen.getByRole("button", { name: "Select following period" }));
    expect(Date.parse(screen.getByTestId("calendar-date").textContent) - week).toBe(7 * 86400000);
    expect(screen.getByTitle("Jump to current period")).not.toHaveTextContent("This week");
  });
});

function matching(id: string, overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    ...sample(id),
    description: "Shared work",
    ...overrides,
    id,
  };
}

describe("timer list session groups", () => {
  afterEach(cleanup);

  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((path: string) => {
      if (path.startsWith("/projects")) return Promise.resolve({ projects: [] });
      if (path.startsWith("/tags")) return Promise.resolve({ tags: [] });
      if (path.startsWith("/time-entries?")) {
        return Promise.resolve({
          entries: [
            matching("older", {
              started_at: "2026-10-04T04:00:00.100Z",
              stopped_at: "2026-10-04T05:00:00.000Z",
              duration_ms: 3_600_000,
            }),
            matching("newer", {
              started_at: "2026-10-04T06:00:00.900Z",
              stopped_at: "2026-10-04T07:00:00.000Z",
              duration_ms: 3_600_000,
            }),
            matching("running", {
              started_at: "2026-10-04T11:30:00.000Z",
              stopped_at: null,
              duration_ms: 0,
              running: true,
            }),
          ],
        });
      }
      return Promise.resolve({});
    });
  });

  it("collapses matching sessions with a live summed duration and continues the latest", async () => {
    const user = userEvent.setup();
    renderPage();
    const count = await screen.findByRole("button", {
      name: "Show 3 matching sessions for Shared work",
    });
    expect(count).toHaveTextContent("3");
    expect(count).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /3 sessions.*running.*2:30:00/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Edit description")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue latest matching session" }));
    expect(apiRequestMock).toHaveBeenCalledWith(
      "/time-entries/running/continue",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("expands to real sessions, keeps an open edit visible, and marks partial selection", async () => {
    const user = userEvent.setup();
    renderPage();
    const count = await screen.findByRole("button", {
      name: "Show 3 matching sessions for Shared work",
    });
    await user.click(screen.getAllByTitle("Show matching sessions")[0] as HTMLElement);
    expect(count).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: "Save time entry" })).not.toBeInTheDocument();

    const sessions = screen.getAllByRole("checkbox", { name: "Select Shared work" });
    expect(sessions).toHaveLength(3);
    await user.click(sessions[0] as HTMLElement);
    const groupBox = screen.getByRole("checkbox", {
      name: "Select 3 matching sessions for Shared work",
    });
    expect(groupBox).not.toBeChecked();
    expect(groupBox).toHaveProperty("indeterminate", true);

    await user.click(screen.getAllByTitle("Edit description")[0] as HTMLElement);
    expect(await screen.findByRole("button", { name: "Save time entry" })).toBeVisible();
    await user.click(count);
    expect(screen.getByRole("button", { name: "Save time entry" })).toBeVisible();
    expect(count).toHaveAttribute("aria-expanded", "true");
  });

  it("does not group the same metadata across local days", async () => {
    apiRequestMock.mockImplementation((path: string) => {
      if (path.startsWith("/projects")) return Promise.resolve({ projects: [] });
      if (path.startsWith("/tags")) return Promise.resolve({ tags: [] });
      if (path.startsWith("/time-entries?")) {
        return Promise.resolve({
          entries: [
            matching("today", {
              started_at: "2026-10-04T04:00:00.000Z",
              stopped_at: "2026-10-04T05:00:00.000Z",
            }),
            matching("yesterday", {
              started_at: "2026-10-03T10:00:00.000Z",
              stopped_at: "2026-10-03T11:00:00.000Z",
            }),
          ],
        });
      }
      return Promise.resolve({});
    });
    renderPage();
    expect(await screen.findAllByTitle("Edit description")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /matching sessions/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Today" })).toBeVisible();
  });

  it("saves a real entry from an expanded group and then shows two singleton rows", async () => {
    const user = userEvent.setup();
    const rows = [
      matching("older", {
        started_at: "2026-10-04T04:00:00.100Z",
        stopped_at: "2026-10-04T05:00:00.000Z",
      }),
      matching("newer", {
        started_at: "2026-10-04T06:00:00.900Z",
        stopped_at: "2026-10-04T07:00:00.000Z",
      }),
    ];
    apiRequestMock.mockImplementation(
      (path: string, options?: { method?: string; body?: string }) => {
        if (path.startsWith("/projects")) return Promise.resolve({ projects: [] });
        if (path.startsWith("/tags")) return Promise.resolve({ tags: [] });
        if (path.startsWith("/time-entries?")) return Promise.resolve({ entries: rows });
        if (path === "/time-entries/newer" && options?.method === "PATCH") {
          const body = JSON.parse(options.body ?? "{}") as { description?: string };
          const current = rows.find((entry) => entry.id === "newer");
          if (current && body.description) current.description = body.description;
          return Promise.resolve({ entry: current });
        }
        return Promise.resolve({});
      },
    );
    renderPage();
    await user.click(
      await screen.findByRole("button", { name: "Show 2 matching sessions for Shared work" }),
    );
    await user.click(screen.getAllByTitle("Edit description")[0] as HTMLElement);
    const description = await screen.findByLabelText("Entry description");
    await user.clear(description);
    await user.type(description, "Renamed session");
    await user.click(screen.getByRole("button", { name: "Save time entry" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Save time entry" })).not.toBeInTheDocument(),
    );
    const patch = apiRequestMock.mock.calls.find(([path, options]) => {
      const request = options as { method?: string; body?: string } | undefined;
      return path === "/time-entries/newer" && request?.method === "PATCH";
    });
    const body = (patch?.[1] as { body?: string } | undefined)?.body ?? "";
    expect(body).toContain("Renamed session");
  });
});
