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
    expect(screen.getByText("Selected project")).toBeVisible();
    const search = screen.getByRole("textbox", { name: "Search projects or clients" });
    expect(search).toHaveFocus();
    await user.type(search, "IOMechs");
    expect(screen.getByRole("button", { name: "Internal Operations" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "External Delivery" })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "zzznomatch");
    expect(screen.getByText("No matching projects")).toBeVisible();

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
});
