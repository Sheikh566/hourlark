import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationBell } from "@/web/features/notifications/notification-bell";
import { NotificationSettingsDialog } from "@/web/features/notifications/notification-settings-dialog";
import { ApiClientError, apiRequest } from "@/web/lib/api";

vi.mock("@/web/lib/api", () => {
  class ApiClientError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { apiRequest: vi.fn(), ApiClientError };
});

const request = vi.mocked(apiRequest);

const preferences = {
  long_timer_enabled: true,
  long_timer_minutes: 480,
  reminder_enabled: true,
  reminder_time_minutes: 1020,
  reminder_threshold_minutes: 240,
  reminder_weekdays: 31,
  version: 0,
};

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

beforeEach(() => {
  request.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/timer") {
      return Promise.resolve({ entry: null, unread_notifications: 2, server_now: "" });
    }
    if (path === "/notifications") {
      return Promise.resolve({
        unread_count: 2,
        notifications: [
          {
            id: "n1",
            kind: "tracking_reminder",
            title: "Time to track your day",
            body: "You've tracked 1h today (goal 4h).",
            created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
            read_at: null,
          },
          {
            id: "n2",
            kind: "long_running_timer",
            title: "Your timer is still running",
            body: "Your timer has been running for 8h.",
            created_at: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
            read_at: null,
          },
        ],
      });
    }
    if (path === "/notifications/read-all") return Promise.resolve({ unread_count: 0 });
    if (path === "/notifications/n1/read") return Promise.resolve({ unread_count: 1 });
    if (path === "/notifications/preferences" && init?.method === "PUT") {
      const body = JSON.parse(init.body as string) as typeof preferences;
      return Promise.resolve({
        preferences: { ...body, version: 1 },
        push: { available: false, public_key: null },
      });
    }
    if (path === "/notifications/preferences") {
      return Promise.resolve({ preferences, push: { available: false, public_key: null } });
    }
    return Promise.reject(new Error(`Unexpected ${path}`));
  });
});

afterEach(() => {
  cleanup();
  request.mockReset();
});

describe("NotificationBell", () => {
  it("shows the unread count from the timer poll and marks notifications read", async () => {
    const user = userEvent.setup();
    renderWithQuery(<NotificationBell />);

    const bell = await screen.findByRole("button", { name: "Notifications, 2 unread" });
    await user.click(bell);
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    expect(await within(panel).findByText("Time to track your day")).toBeInTheDocument();
    expect(within(panel).getByText("5 minutes ago")).toBeInTheDocument();
    expect(within(panel).getByText("3 hours ago")).toBeInTheDocument();

    await user.click(within(panel).getByText("Time to track your day"));
    expect(request).toHaveBeenCalledWith("/notifications/n1/read", { method: "POST" });
    expect(await screen.findByRole("button", { name: "Notifications, 1 unread" })).toBeVisible();

    await user.click(within(panel).getByRole("button", { name: "Mark all as read" }));
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeVisible();
    expect(within(panel).queryAllByText("(unread)")).toHaveLength(0);
  });
});

describe("NotificationSettingsDialog", () => {
  it("saves edited preferences with the stored version", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithQuery(<NotificationSettingsDialog open onOpenChange={onOpenChange} />);

    const hours = await screen.findByLabelText("Warn after (hours)");
    await user.clear(hours);
    await user.type(hours, "6");
    await user.click(screen.getByRole("button", { name: "Saturday" }));
    await user.click(screen.getByRole("switch", { name: "Tracking reminder" }));
    expect(screen.queryByLabelText("Remind at")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const put = request.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(put?.[1]?.body as string)).toEqual({
      ...preferences,
      long_timer_minutes: 360,
      reminder_enabled: false,
      reminder_weekdays: 31 | (1 << 5),
      version: 0,
    });
  });

  it("keeps an unsaved draft through a background refetch and saves the loaded version", async () => {
    const user = userEvent.setup();
    const { client } = renderWithQuery(<NotificationSettingsDialog open onOpenChange={vi.fn()} />);
    const hours = await screen.findByLabelText("Warn after (hours)");
    await user.clear(hours);
    await user.type(hours, "6");

    // Another window saved: the next fetch returns version 3 with different values.
    const base = request.getMockImplementation();
    request.mockImplementation((path: string, init?: RequestInit) =>
      path === "/notifications/preferences" && !init?.method
        ? Promise.resolve({
            preferences: { ...preferences, long_timer_minutes: 120, version: 3 },
            push: { available: false, public_key: null },
          })
        : (base?.(path, init) ?? Promise.reject(new Error(path))),
    );
    await client.refetchQueries({ queryKey: ["notification-preferences"] });

    expect(screen.getByLabelText("Warn after (hours)")).toHaveValue(6);
    await user.click(screen.getByRole("button", { name: "Save" }));
    const put = await vi.waitFor(() => {
      const call = request.mock.calls.find(([, init]) => init?.method === "PUT");
      if (!call) throw new Error("no PUT yet");
      return call;
    });
    expect(JSON.parse(put[1]?.body as string)).toMatchObject({ version: 0 });
  });

  it("reloads the stored values and explains a conflict", async () => {
    const user = userEvent.setup();
    const base = request.getMockImplementation();
    let version = 0;
    request.mockImplementation((path: string, init?: RequestInit) => {
      if (path !== "/notifications/preferences") {
        return base?.(path, init) ?? Promise.reject(new Error(path));
      }
      if (init?.method === "PUT") {
        version = 3;
        return Promise.reject(
          new ApiClientError(
            409,
            "conflict",
            "Your notification settings changed in another window.",
          ),
        );
      }
      return Promise.resolve({
        preferences: { ...preferences, long_timer_minutes: version ? 120 : 480, version },
        push: { available: false, public_key: null },
      });
    });
    renderWithQuery(<NotificationSettingsDialog open onOpenChange={vi.fn()} />);
    const hours = await screen.findByLabelText("Warn after (hours)");
    await user.clear(hours);
    await user.type(hours, "6");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Your notification settings changed in another window."),
    ).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByLabelText("Warn after (hours)")).toHaveValue(2));
  });

  it("validates hours before saving", async () => {
    const user = userEvent.setup();
    renderWithQuery(<NotificationSettingsDialog open onOpenChange={vi.fn()} />);

    const hours = await screen.findByLabelText("Warn after (hours)");
    await user.clear(hours);
    await user.type(hours, "30");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Enter whole hours from 1 to 24")).toBeInTheDocument();
    expect(request.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("hides browser notifications when push is not configured", async () => {
    renderWithQuery(<NotificationSettingsDialog open onOpenChange={vi.fn()} />);
    await screen.findByLabelText("Warn after (hours)");
    expect(screen.queryByText("Browser notifications")).not.toBeInTheDocument();
  });
});
