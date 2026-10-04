import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdministrationPage, TagSettings } from "@/web/routes/administration";
import { ClientsPage } from "@/web/routes/clients";
import { MembersPage } from "@/web/routes/members";
import { apiRequest } from "@/web/lib/api";

const permissions = vi.hoisted(() => ({
  manage_members: true,
  manage_workspace: true,
  view_team: true,
}));
vi.mock("@/web/app/context", () => ({
  useMe: () => ({ permissions, workspace: { currency: "USD", timezone: "UTC" } }),
}));
vi.mock("@/web/lib/api", () => ({ apiRequest: vi.fn() }));

function mount(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  Object.assign(permissions, { manage_members: true, manage_workspace: true, view_team: true });
});

describe("management feedback", () => {
  it("does not request member or administrative data when access is denied", () => {
    Object.assign(permissions, {
      manage_members: false,
      manage_workspace: false,
      view_team: false,
    });
    mount(
      <>
        <MembersPage />
        <AdministrationPage />
      </>,
    );
    expect(screen.getByText("You do not have permission to view members.")).toBeInTheDocument();
    expect(
      screen.getByText("Only administrators can access workspace administration."),
    ).toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("shows validation instead of submitting a blank client", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ clients: [] });
    const user = userEvent.setup();
    mount(<ClientsPage />);
    await user.click(screen.getByRole("button", { name: "New client" }));
    await user.click(screen.getByRole("button", { name: "Save client" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Name: This field is required.");
    expect(vi.mocked(apiRequest).mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it("distinguishes a failed client fetch from an empty directory", async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error("Clients are temporarily unavailable."));
    mount(<ClientsPage />);
    expect(await screen.findByText("Clients are temporarily unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("No clients found")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("keeps audit events visible when loading older history fails", async () => {
    vi.mocked(apiRequest).mockImplementation((path) => {
      if (path === "/settings")
        return Promise.reject(new Error("Settings not needed for this check."));
      if (path === "/audit-log?limit=200")
        return Promise.resolve({
          events: [
            {
              id: "audit-1",
              actor_name: "Admin",
              actor_email: "admin@example.com",
              action: "client.create",
              entity_type: "client",
              entity_id: "client-1",
              reason: null,
              request_id: "request-1",
              created_at: 1000,
            },
          ],
          next_before: 1000,
        });
      if (path === "/audit-log?limit=200&before=1000")
        return Promise.reject(new Error("Older history unavailable."));
      return Promise.resolve({});
    });
    const user = userEvent.setup();
    mount(<AdministrationPage />);
    await user.click(screen.getByRole("button", { name: "Audit log" }));
    expect(await screen.findByText("client.create")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load older events" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Older history unavailable."),
    );
    expect(screen.getByText("client.create")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load older events" })).toBeEnabled();
  });
  it("preserves the tag name label after a blank error and submits with Enter", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ tags: [] });
    const user = userEvent.setup();
    mount(<TagSettings />);
    await user.click(screen.getByRole("button", { name: "New tag" }));
    await user.click(screen.getByRole("button", { name: "Save tag" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a tag name.");
    const name = screen.getByRole("textbox", { name: "Tag name" });
    expect(name).toHaveAccessibleDescription("Enter a tag name.");
    await user.type(name, "Research{Enter}");
    await waitFor(() =>
      expect(vi.mocked(apiRequest).mock.calls).toContainEqual([
        "/tags",
        {
          method: "POST",
          body: JSON.stringify({ name: "Research", color: "#14852B" }),
        },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("locks client edits and dismissal until a pending save finishes", async () => {
    let finish: ((value: unknown) => void) | undefined;
    vi.mocked(apiRequest).mockImplementation((path, init) =>
      init?.method === "POST"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ clients: [] }),
    );
    const user = userEvent.setup();
    mount(<ClientsPage />);
    await user.click(screen.getByRole("button", { name: "New client" }));
    const name = screen.getByRole("textbox", { name: "Client name" });
    await user.type(name, "Original name");
    await user.click(screen.getByRole("button", { name: "Save client" }));
    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(name).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    finish?.({ client: {} });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("names invalid currency and hourly rate fields without submitting", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ clients: [] });
    const user = userEvent.setup();
    mount(<ClientsPage />);
    await user.click(screen.getByRole("button", { name: "New client" }));
    await user.type(screen.getByRole("textbox", { name: "Client name" }), "Client");
    const currency = screen.getByRole("textbox", { name: "Currency" });
    await user.clear(currency);
    await user.type(currency, "US");
    await user.type(screen.getByRole("spinbutton", { name: "Default hourly rate" }), "-1");
    await user.click(screen.getByRole("button", { name: "Save client" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Currency: Enter a three-letter currency code.");
    expect(alert).toHaveTextContent("Default hourly rate: Enter a non-negative number.");
    expect(vi.mocked(apiRequest).mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });
});
