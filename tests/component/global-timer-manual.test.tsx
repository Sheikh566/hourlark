import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatInTimeZone } from "date-fns-tz";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalTimerBar } from "@/web/features/timer/global-timer";
import { manualEntryRange } from "@/web/features/timer/manual-entry";

const apiRequestMock = vi.hoisted(() =>
  vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(),
);

vi.mock("@/web/lib/api", () => ({
  apiRequest: apiRequestMock,
  idempotencyKey: () => "00000000-0000-4000-8000-000000000999",
}));

vi.mock("@/web/app/context", () => ({
  useMe: () => ({
    member: { id: "00000000-0000-4000-8000-000000000101", role: "admin", timezone: "Asia/Karachi" },
    workspace: { currency: "USD", members_can_set_billable: true },
  }),
}));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GlobalTimerBar />
    </QueryClientProvider>,
  );
}

describe("manual entry range", () => {
  it("converts member-local fields to instants", () => {
    expect(manualEntryRange("2026-10-06", "09:00", "10:30", "Asia/Karachi")).toEqual({
      started_at: "2026-10-06T04:00:00.000Z",
      stopped_at: "2026-10-06T05:30:00.000Z",
    });
  });

  it("treats an end time before the start as the following day", () => {
    expect(manualEntryRange("2026-10-06", "23:00", "01:00", "Asia/Karachi")).toEqual({
      started_at: "2026-10-06T18:00:00.000Z",
      stopped_at: "2026-10-06T20:00:00.000Z",
    });
  });

  it("rejects equal or malformed times", () => {
    expect(manualEntryRange("2026-10-06", "09:00", "09:00", "UTC")).toEqual({
      error: "End must be after start.",
    });
    expect(manualEntryRange("2026-10-06", "9am", "10:00", "UTC")).toEqual({
      error: "Enter valid start and end times.",
    });
  });
});

describe("global timer manual mode", () => {
  beforeEach(() => {
    window.localStorage.clear();
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((path: string) => {
      if (path === "/projects?status=active") return Promise.resolve({ projects: [] });
      if (path === "/tags?status=active") return Promise.resolve({ tags: [] });
      if (path === "/me/recent") return Promise.resolve({ recent: [] });
      if (path === "/timer")
        return Promise.resolve({ entry: null, server_now: new Date().toISOString() });
      if (path === "/time-entries") return Promise.resolve({ entry: {} });
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("switches to manual mode, remembers it, and adds a completed entry", async () => {
    const month = formatInTimeZone(Date.now(), "Asia/Karachi", "yyyy-MM");
    const user = userEvent.setup();
    const view = mount();
    await user.click(await screen.findByRole("button", { name: "Manual mode" }));
    expect(screen.getByPlaceholderText("What have you done?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start timer" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("hourlark.timer-mode")).toBe("manual");

    await user.type(screen.getByRole("combobox", { name: "Timer description" }), "Planning");
    // Pick the 1st of the month shown in the calendar (the current month).
    await user.click(screen.getByRole("button", { name: "Entry date" }));
    await user.click(screen.getByRole("button", { name: /^Choose \w+, \w+ 1, \d{4}$/ }));
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "10:15" } });
    await user.click(screen.getByRole("button", { name: "Add time entry" }));

    await waitFor(() => {
      const call = apiRequestMock.mock.calls.find(([path]) => path === "/time-entries");
      expect(call).toBeDefined();
      expect(JSON.parse(call?.[1]?.body as string)).toMatchObject({
        description: "Planning",
        started_at: `${month}-01T04:00:00.000Z`,
        stopped_at: `${month}-01T05:15:00.000Z`,
      });
    });
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Timer description" })).toHaveValue(""),
    );
    view.unmount();
    mount();
    expect(await screen.findByPlaceholderText("What have you done?")).toBeInTheDocument();
  });

  it("shows validation errors without creating an entry", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Manual mode" }));
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "09:00" } });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "09:00" } });
    await user.click(screen.getByRole("button", { name: "Add time entry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("End must be after start.");
    expect(apiRequestMock.mock.calls.some(([path]) => path === "/time-entries")).toBe(false);
  });
});
