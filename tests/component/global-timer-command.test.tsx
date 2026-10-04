import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalTimerBar } from "@/web/features/timer/global-timer";

const apiRequestMock = vi.hoisted(() => vi.fn());

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
    expect(screen.getByRole("button", { name: "Project: Internal Operations" })).toBeVisible();

    await user.type(description, "#r");
    const tagSuggestions = await screen.findByRole("listbox", { name: "Tag suggestions" });
    expect(within(tagSuggestions).getByRole("option", { name: /R&D/ })).toBeVisible();
    await user.keyboard("{Enter}");

    expect(description).toHaveValue("Review ");
    expect(screen.getByRole("button", { name: "1 timer tags selected" })).toBeVisible();

    view.unmount();
    queryClient.clear();
  });
});
