import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/web/components/ui";
import { AdministrationPage } from "@/web/routes/administration";
import { MembersPage } from "@/web/routes/members";
import { TagsPage } from "@/web/routes/tags";
import { apiRequest } from "@/web/lib/api";

vi.mock("@/web/app/context", () => ({
  useMe: () => ({
    permissions: { manage_members: true, manage_workspace: true, view_team: true },
    workspace: { currency: "USD", timezone: "UTC" },
  }),
}));
vi.mock("@/web/lib/api", () => ({ apiRequest: vi.fn() }));

function mount(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>{element}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const member = (id: string, name: string, status: "active" | "pending" | "inactive") => ({
  id,
  email: `${id}@example.com`,
  display_name: name,
  role: "member",
  status,
  timezone: "UTC",
  weekly_target_minutes: null,
  last_seen_at: null,
  running_entry_id: null,
  week_tracked_ms: 0,
  project_ids_json: "[]",
  version: 1,
});

describe("members status filter", () => {
  it("shows active and invited members by default and reveals inactive ones on request", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      members: [
        member("a", "Ada Active", "active"),
        member("p", "Pat Pending", "pending"),
        member("i", "Ivy Inactive", "inactive"),
      ],
    });
    const user = userEvent.setup();
    mount(<MembersPage />);
    expect(await screen.findByText("Ada Active")).toBeInTheDocument();
    expect(screen.getByText("Pat Pending")).toBeInTheDocument();
    expect(screen.queryByText("Ivy Inactive")).not.toBeInTheDocument();
    // Pending members carry an "Invited" badge in the row.
    const pendingRow = screen.getByText("Pat Pending").closest("tr");
    expect(pendingRow).not.toBeNull();
    expect(within(pendingRow as HTMLElement).getByText("Invited")).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "Filter members by status" });
    expect(trigger).toHaveAccessibleDescription("Active, Invited");
    await user.click(trigger);
    await user.click(screen.getByRole("checkbox", { name: "Inactive" }));
    expect(await screen.findByText("Ivy Inactive")).toBeInTheDocument();
    expect(trigger).toHaveAccessibleDescription("All");

    await user.click(screen.getByRole("checkbox", { name: "Active" }));
    await user.click(screen.getByRole("checkbox", { name: "Invited" }));
    expect(screen.queryByText("Ada Active")).not.toBeInTheDocument();
    expect(screen.getByText("Ivy Inactive")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("checkbox", { name: "Inactive" })).not.toBeInTheDocument();
  });

  it("clears filters and shows Toggl's empty state when nothing matches", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ members: [member("a", "Ada Active", "active")] });
    const user = userEvent.setup();
    mount(<MembersPage />);
    await screen.findByText("Ada Active");
    // Toggl's team toolbar always shows the clear-filters control, even with the default filters.
    const clear = screen.getByRole("button", { name: "Clear filters" });
    await user.click(clear);
    expect(screen.getByText("Ada Active")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search members" }), "zzz");
    expect(await screen.findByText("Nothing to see here...")).toBeInTheDocument();
  });
});

describe("tags page", () => {
  it("shows a success toast after creating a tag and offers Undo after archiving", async () => {
    const tag = {
      id: "t1",
      name: "Research",
      color: "#14852B",
      status: "active",
      version: 1,
    };
    vi.mocked(apiRequest).mockImplementation((path, init) => {
      if (init?.method) return Promise.resolve({});
      return Promise.resolve({ tags: [tag] });
    });
    const user = userEvent.setup();
    mount(<TagsPage />);
    await user.click(await screen.findByRole("button", { name: "New Tag" }));
    expect(screen.getByRole("dialog", { name: "New Tag" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Tag name" }), "Docs{Enter}");
    expect(await screen.findByText("Tag created successfully")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Actions for Research" }));
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(await screen.findByText("Tag archived successfully")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(vi.mocked(apiRequest).mock.calls).toContainEqual([
        "/tags/t1/reactivate",
        { method: "POST", body: "{}" },
      ]),
    );
  });

  it("uses the Toggl empty state with a New tag action when nothing matches", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ tags: [] });
    const user = userEvent.setup();
    mount(<TagsPage />);
    expect(await screen.findByText("Nothing to see here...")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New tag" }));
    expect(screen.getByRole("dialog", { name: "New Tag" })).toBeInTheDocument();
  });
});

describe("workspace settings", () => {
  it("renders policies as switches and toasts after saving", async () => {
    const settings = {
      app_name: "Hourlark",
      company_name: "Acme",
      company_domain: "acme.test",
      timezone: "UTC",
      currency: "USD",
      week_start: "monday",
      default_rate_minor: null,
      members_can_set_billable: 0,
      lock_entries_after_days: null,
      rounding_increment_minutes: 0,
      rounding_method: "nearest",
      report_show_descriptions: 1,
      report_show_tags: 1,
      report_show_members: 1,
      version: 3,
      access: {
        configured: false,
        team_domain: null,
        audience: null,
        bootstrap_admins_configured: true,
      },
    };
    vi.mocked(apiRequest).mockImplementation((path, init) =>
      init?.method === "PATCH" ? Promise.resolve({}) : Promise.resolve({ settings }),
    );
    const user = userEvent.setup();
    mount(<AdministrationPage />);
    const billable = await screen.findByRole("switch", { name: "Members may set billable status" });
    expect(billable).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "Include tags by default" })).toBeChecked();
    await user.click(billable);
    expect(billable).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(await screen.findByText("Workspace settings saved.")).toBeInTheDocument();
    const patch = vi.mocked(apiRequest).mock.calls.find(([, init]) => init?.method === "PATCH");
    const body = patch?.[1]?.body;
    expect(typeof body).toBe("string");
    expect(JSON.parse(body as string)).toMatchObject({
      members_can_set_billable: true,
      version: 3,
    });
  });
});
