import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "@/web/app/sidebar";
import {
  isSidebarShortcut,
  SIDEBAR_COLLAPSED_KEY,
  useSidebarCollapsed,
} from "@/web/app/sidebar-state";

const meMock = vi.hoisted(() => ({
  permissions: {
    view_team: true,
    manage_members: true,
    manage_workspace: true,
    view_audit: true,
  },
  authMode: "google",
}));

vi.mock("@/web/lib/api", () => ({
  DEVELOPMENT_IDENTITIES: [{ email: "member@example.com", label: "Member" }],
  setDevelopmentIdentity: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/web/app/context", () => ({
  useMe: () => ({
    member: {
      displayName: "Ada Lovelace",
      email: "ada@example.com",
      role: "admin",
      timezone: "Asia/Karachi",
    },
    workspace: { company_name: "Analytical Engines", app_name: "Hourlark" },
    permissions: meMock.permissions,
    auth_mode: meMock.authMode,
  }),
}));

function renderSidebar(props: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={["/projects"]}>
      <Sidebar onNavigate={() => undefined} onToggleCollapsed={() => undefined} {...props} />
    </MemoryRouter>,
  );
}

describe("sidebar", () => {
  afterEach(cleanup);

  beforeEach(() => {
    meMock.permissions = {
      view_team: true,
      manage_members: true,
      manage_workspace: true,
      view_audit: true,
    };
  });

  it("lists navigation in Toggl's order with Members before Tags and Settings for admins", () => {
    renderSidebar();
    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(
      within(navigation)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Timer", "Reports", "Projects", "Clients", "Members", "Tags"]);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/administration",
    );
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
  });

  it("hides entries the member cannot use", () => {
    meMock.permissions = {
      view_team: false,
      manage_members: false,
      manage_workspace: false,
      view_audit: false,
    };
    renderSidebar();
    expect(screen.queryByRole("link", { name: "Members" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Tags" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("opens the workspace menu and closes it on Escape and outside click", async () => {
    const user = userEvent.setup();
    renderSidebar();
    const trigger = screen.getByRole("button", { name: "Analytical Engines" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    const menu = screen.getByRole("menu", { name: "Workspace" });
    expect(within(menu).getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();

    await user.click(trigger);
    expect(screen.getByRole("menu", { name: "Workspace" })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the profile menu with identity and sign out", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Profile" }));
    const menu = screen.getByRole("menu", { name: "Profile" });
    expect(within(menu).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(menu).getByText("ada@example.com")).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("offers a collapse toggle only when a handler is provided and hides the panel when collapsed", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { unmount } = renderSidebar({ onToggleCollapsed: onToggle });
    await user.click(screen.getByRole("button", { name: "Close sidebar" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    unmount();

    const { unmount: unmountCollapsed } = renderSidebar({ collapsed: true });
    expect(screen.getByRole("button", { name: "Open sidebar" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary navigation" })).toBeNull();
    unmountCollapsed();

    renderSidebar({ onToggleCollapsed: undefined });
    expect(screen.queryByRole("button", { name: /sidebar/ })).toBeNull();
  });
});

describe("sidebar collapsed state", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn() }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("toggles with H, persists per browser and ignores typing in fields", () => {
    const { result, unmount } = renderHook(() => useSidebarCollapsed());
    expect(result.current[0]).toBe(false);

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
    });
    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe("1");

    const field = render(<input aria-label="Description" />);
    act(() => {
      screen
        .getByLabelText("Description")
        .dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
    });
    expect(result.current[0]).toBe(true);
    field.unmount();
    unmount();

    const restored = renderHook(() => useSidebarCollapsed());
    expect(restored.result.current[0]).toBe(true);
    act(() => restored.result.current[1]());
    expect(restored.result.current[0]).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe("0");
  });

  it("does not treat modified or other keys as the shortcut", () => {
    expect(isSidebarShortcut(new KeyboardEvent("keydown", { key: "h" }))).toBe(true);
    expect(isSidebarShortcut(new KeyboardEvent("keydown", { key: "H", ctrlKey: true }))).toBe(
      false,
    );
    expect(isSidebarShortcut(new KeyboardEvent("keydown", { key: "j" }))).toBe(false);
  });
});
