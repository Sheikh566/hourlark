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

import { chooseOption } from "./select-helpers";

vi.mock("@/web/app/context", () => ({
  useMe: () => ({
    member: { id: "me" },
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

describe("members row menu and editor", () => {
  const patchBody = () => {
    const patch = vi.mocked(apiRequest).mock.calls.find(([, init]) => init?.method === "PATCH");
    return JSON.parse(patch?.[1]?.body as string) as Record<string, unknown>;
  };

  it("deactivates from the row menu after confirming, without opening the editor", async () => {
    vi.mocked(apiRequest).mockImplementation((path, init) =>
      init?.method === "PATCH"
        ? Promise.resolve({})
        : Promise.resolve({ members: [member("a", "Ada Active", "active")] }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    mount(<MembersPage />);
    await user.click(await screen.findByRole("button", { name: "Actions for Ada Active" }));
    await user.click(screen.getByRole("menuitem", { name: "Deactivate" }));
    expect(confirm).toHaveBeenCalledWith(
      "Deactivate a@example.com? Any running timer will be stopped.",
    );
    expect(await screen.findByText("Ada Active deactivated")).toBeInTheDocument();
    expect(vi.mocked(apiRequest)).toHaveBeenCalledWith("/members/a", expect.anything());
    expect(patchBody()).toEqual({ version: 1, status: "inactive" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it("does not deactivate when the confirmation is declined", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ members: [member("a", "Ada Active", "active")] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    mount(<MembersPage />);
    await user.click(await screen.findByRole("button", { name: "Actions for Ada Active" }));
    await user.click(screen.getByRole("menuitem", { name: "Deactivate" }));
    expect(vi.mocked(apiRequest).mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(
      false,
    );
    confirm.mockRestore();
  });

  it("reactivates inactive members and hides status actions on your own row", async () => {
    vi.mocked(apiRequest).mockImplementation((path, init) =>
      init?.method === "PATCH"
        ? Promise.resolve({})
        : Promise.resolve({
            members: [member("me", "Me Myself", "active"), member("i", "Ivy Inactive", "inactive")],
          }),
    );
    const user = userEvent.setup();
    mount(<MembersPage />);
    await user.click(await screen.findByRole("button", { name: "Actions for Me Myself" }));
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Deactivate" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Filter members by status" }));
    await user.click(screen.getByRole("checkbox", { name: "Inactive" }));
    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: "Actions for Ivy Inactive" }));
    await user.click(screen.getByRole("menuitem", { name: "Reactivate" }));
    expect(await screen.findByText("Ivy Inactive reactivated")).toBeInTheDocument();
    expect(patchBody()).toEqual({ version: 1, status: "active" });
  });

  it("picks the new member's timezone from a dropdown", async () => {
    vi.mocked(apiRequest).mockImplementation((path, init) =>
      init?.method === "POST"
        ? Promise.resolve({})
        : Promise.resolve({ members: [member("a", "Ada Active", "active")] }),
    );
    const user = userEvent.setup();
    mount(<MembersPage />);
    await screen.findByText("Ada Active");
    await user.click(screen.getAllByRole("button", { name: "Add member" })[0] as HTMLElement);
    const timezone = screen.getByRole("combobox", { name: "Timezone" });
    expect(timezone).toHaveTextContent("UTC (UTC+00:00)");
    await user.type(screen.getByRole("textbox", { name: "Company email" }), "new@example.com");
    await user.type(screen.getByRole("textbox", { name: "Display name" }), "New Person");
    await chooseOption(user, timezone, /^Asia\/Karachi \(UTC\+05:00\)$/);
    expect(timezone).toHaveTextContent("Asia/Karachi (UTC+05:00)");
    await user.click(screen.getByRole("button", { name: "Save member" }));
    await waitFor(() =>
      expect(vi.mocked(apiRequest)).toHaveBeenCalledWith(
        "/members",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const post = vi.mocked(apiRequest).mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post?.[1]?.body as string)).toMatchObject({
      email: "new@example.com",
      timezone: "Asia/Karachi",
    });
    // Radix mounts all ~420 zones; under a parallel run this flow needs more than the 5s default.
  }, 15_000);
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
