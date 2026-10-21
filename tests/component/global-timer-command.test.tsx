import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalTimerBar } from "@/web/features/timer/global-timer";

const apiRequestMock = vi.hoisted(() =>
  vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(),
);

vi.mock("@/web/lib/api", () => ({
  apiRequest: apiRequestMock,
  idempotencyKey: () => "00000000-0000-4000-8000-000000000999",
}));

vi.mock("@/web/app/context", () => ({
  useMe: () => ({
    member: {
      id: "00000000-0000-4000-8000-000000000101",
      role: "admin",
      timezone: "Asia/Karachi",
    },
    workspace: {
      currency: "USD",
      members_can_set_billable: true,
    },
  }),
}));

describe("global timer description commands", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((path: string) => {
      if (path === "/projects?status=active") {
        return Promise.resolve({
          projects: [
            {
              id: "00000000-0000-4000-8000-000000000301",
              name: "Internal Operations",
              color: "#21de47",
              client_id: "00000000-0000-4000-8000-000000000201",
              client_name: "IOMechs",
              billable_default: false,
            },
            {
              id: "00000000-0000-4000-8000-000000000302",
              name: "External Delivery",
              color: "#82cf30",
              client_id: "00000000-0000-4000-8000-000000000202",
              client_name: "Client",
              billable_default: true,
            },
          ],
        });
      }
      if (path === "/tags?status=active") {
        return Promise.resolve({
          tags: [
            {
              id: "00000000-0000-4000-8000-000000000401",
              name: "R&D",
              color: "#82cf30",
              status: "active",
            },
          ],
        });
      }
      if (path === "/me/recent") return Promise.resolve({ recent: [] });
      if (path === "/timer") {
        return Promise.resolve({ entry: null, server_now: "2026-07-30T12:00:00.000Z" });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });

  it("clears an unavailable idle selection before starting a new entry", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <GlobalTimerBar />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "Choose project" }));
    await user.click(await screen.findByRole("button", { name: "Internal Operations" }));
    expect(screen.getByRole("button", { name: /Project: Internal Operations/ })).toBeVisible();
    act(() => {
      queryClient.setQueryData(["projects", "active"], {
        projects: [
          {
            id: "00000000-0000-4000-8000-000000000301",
            name: "Internal Operations",
            client_status: "archived",
          },
        ],
      });
    });
    await screen.findByRole("button", { name: "Choose project" });
    apiRequestMock.mockResolvedValueOnce({});
    await user.click(screen.getByRole("button", { name: "Start timer" }));
    await waitFor(() => {
      const request = apiRequestMock.mock.calls.find((call) => call[0] === "/timer/start");
      expect(request?.[1]?.body).toContain('"project_id":null');
    });
    view.unmount();
    queryClient.clear();
  });

  it("selects projects with @ and tags with # using the keyboard", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <GlobalTimerBar />
      </QueryClientProvider>,
    );

    const description = await screen.findByRole("combobox", { name: "Timer description" });
    await user.type(description, "Review @in");
    const projectSuggestions = await screen.findByRole("listbox", {
      name: "Project suggestions",
    });
    expect(
      within(projectSuggestions).getByRole("option", { name: /Internal Operations/ }),
    ).toBeVisible();
    expect(within(projectSuggestions).queryByText("External Delivery")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");

    expect(description).toHaveValue("Review ");
    const selectedProject = screen.getByRole("button", { name: /Project: Internal Operations/ });
    expect(selectedProject).toBeVisible();
    expect(selectedProject).toHaveTextContent("Internal Operations");
    expect(selectedProject).toHaveTextContent("IOMechs");

    await user.type(description, "#r");
    const tagSuggestions = await screen.findByRole("listbox", { name: "Tag suggestions" });
    expect(within(tagSuggestions).getByRole("option", { name: /R&D/ })).toBeVisible();
    await user.keyboard("{Enter}");

    expect(description).toHaveValue("Review ");
    expect(screen.getByRole("button", { name: "1 timer tags selected" })).toBeVisible();

    view.unmount();
    queryClient.clear();
  });

  it("shows selected project and client, searches clients, and restores focus on Escape", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <GlobalTimerBar />
      </QueryClientProvider>,
    );

    await screen.findByRole("button", { name: "Choose project" });
    await user.click(screen.getByRole("button", { name: "Choose project" }));
    await user.click(await screen.findByRole("button", { name: "Internal Operations" }));

    const trigger = screen.getByRole("button", { name: /Project: Internal Operations/ });
    expect(trigger).toHaveTextContent("Internal Operations");
    expect(trigger).toHaveTextContent("IOMechs");

    await user.click(trigger);
    expect(screen.getByRole("button", { name: "Internal Operations" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    const search = screen.getByRole("textbox", { name: "Search projects or clients" });
    expect(search).toHaveFocus();
    await user.type(search, "IOMechs");
    expect(screen.getByRole("button", { name: "Internal Operations" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "External Delivery" })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "zzznomatch");
    expect(screen.getByText("No matching items")).toBeVisible();

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("textbox", { name: "Search projects or clients" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    expect(screen.getByRole("textbox", { name: "Search projects or clients" })).toHaveValue("");
    await user.click(screen.getByRole("combobox", { name: "Timer description" }));
    expect(
      screen.queryByRole("textbox", { name: "Search projects or clients" }),
    ).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "No project" }));
    expect(screen.getByRole("button", { name: "Choose project" })).toBeVisible();
    expect(screen.queryByText("Internal Operations")).not.toBeInTheDocument();

    view.unmount();
    queryClient.clear();
  });
  it("selects a projectless recent entry with arrows without retaining the old project", async () => {
    const original = apiRequestMock.getMockImplementation();
    if (!original) throw new Error("Missing API mock");
    apiRequestMock.mockImplementation((path, init) =>
      path === "/me/recent"
        ? Promise.resolve({
            recent: [
              {
                description: "Projectless work",
                project_id: null,
                project_name: null,
                client_name: null,
              },
            ],
          })
        : path === "/timer/start"
          ? Promise.resolve({})
          : original(path, init),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <GlobalTimerBar />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "Choose project" }));
    await user.click(await screen.findByRole("button", { name: "External Delivery" }));
    const description = screen.getByRole("combobox", { name: "Timer description" });
    await user.type(description, "Projectless");
    expect(await screen.findByRole("listbox", { name: "Description suggestions" })).toBeVisible();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(description).toHaveValue("Projectless work");
    expect(screen.getByRole("button", { name: "Choose project" })).toBeVisible();
    await user.keyboard("{Enter}");
    await waitFor(() => {
      const call = apiRequestMock.mock.calls.find(([path]) => path === "/timer/start");
      expect(JSON.parse(call?.[1]?.body as string)).toMatchObject({
        project_id: null,
        billable: false,
        description: "Projectless work",
      });
    });
    view.unmount();
    queryClient.clear();
  });

  it("dismisses suggestions with Escape and ignores shortcuts while typing", async () => {
    const original = apiRequestMock.getMockImplementation();
    if (!original) throw new Error("Missing API mock");
    apiRequestMock.mockImplementation((path, init) =>
      path === "/timer/start" ? Promise.resolve({}) : original(path, init),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <GlobalTimerBar />
      </QueryClientProvider>,
    );
    const description = await screen.findByRole("combobox", { name: "Timer description" });
    await user.click(description);
    await screen.findByRole("listbox", { name: "Description suggestions" });
    await user.keyboard("ns{Escape}");
    expect(
      screen.queryByRole("listbox", { name: "Description suggestions" }),
    ).not.toBeInTheDocument();
    expect(apiRequestMock.mock.calls.some(([path]) => path === "/timer/start")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Manual mode" }));
    await user.click(document.body);
    await user.keyboard("n");
    await waitFor(() =>
      expect(apiRequestMock.mock.calls.filter(([path]) => path === "/timer/start")).toHaveLength(1),
    );
    expect(description).toHaveFocus();
    view.unmount();
    queryClient.clear();
  });
  it("toggles the timer mode with M and only describes the mode it can switch to", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <GlobalTimerBar />
      </QueryClientProvider>,
    );
    await screen.findByRole("combobox", { name: "Timer description" });
    const timerMode = screen.getByRole("button", { name: "Timer mode" });
    const manualMode = screen.getByRole("button", { name: "Manual mode" });
    expect(timerMode).toHaveAttribute("aria-pressed", "true");
    // Toggl only shows a tip (with its M key cap) on the inactive mode.
    expect(timerMode).not.toHaveAccessibleDescription();
    expect(manualMode).toHaveAccessibleDescription("Manual ModeM");
    expect(screen.getByRole("button", { name: "Start timer" })).toHaveAccessibleDescription(
      "Start time entryN",
    );

    await user.click(document.body);
    await user.keyboard("m");
    expect(manualMode).toHaveAttribute("aria-pressed", "true");
    expect(manualMode).not.toHaveAccessibleDescription();
    expect(timerMode).toHaveAccessibleDescription("Timer ModeM");
    expect(screen.getByRole("button", { name: "Add time entry" })).toHaveAccessibleDescription(
      "Add time entry",
    );

    // Typing an "m" in the description must not switch modes.
    await user.click(screen.getByRole("combobox", { name: "Timer description" }));
    await user.keyboard("m");
    expect(manualMode).toHaveAttribute("aria-pressed", "true");

    await user.click(document.body);
    await user.keyboard("m");
    expect(timerMode).toHaveAttribute("aria-pressed", "true");
    view.unmount();
    queryClient.clear();
  });
});
