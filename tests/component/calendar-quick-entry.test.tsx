import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarQuickEntry } from "@/web/features/time/calendar-quick-entry";
import type { MeResponse, Project, Role, Tag } from "@/web/types";
import { chooseOption } from "./select-helpers";

const { apiRequestMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(),
}));

const meState: Pick<MeResponse, "member" | "workspace" | "permissions"> = {
  member: {
    id: "member-1",
    workspaceId: "workspace-1",
    email: "admin@iomechs.com",
    displayName: "Admin",
    role: "admin",
    status: "active",
    timezone: "Asia/Karachi",
  },
  workspace: {
    id: "workspace-1",
    app_name: "Hourlark",
    company_name: "IOMechs",
    company_domain: "iomechs.com",
    timezone: "Asia/Karachi",
    currency: "USD",
    week_start: "monday",
    members_can_set_billable: true,
    lock_entries_after_days: null,
    rounding_increment_minutes: 0,
    rounding_method: "nearest",
    version: 1,
  },
  permissions: {
    view_team: true,
    financial: true,
    export: true,
    manage_workspace: true,
    manage_members: true,
    view_audit: true,
  },
};

vi.mock("@/web/lib/api", () => ({
  apiRequest: apiRequestMock,
}));

vi.mock("@/web/app/context", () => ({
  useMe: () => meState,
}));

const helixProject: Project = {
  id: "project-helix",
  name: "Helix3D",
  color: "#cd7fc2",
  client_id: "client-upwork",
  client_name: "Upwork",
  billable_default: true,
};

const discussionTag: Tag = {
  id: "tag-1",
  name: "Discussion",
  color: "#82cf30",
  status: "active",
};

function parseBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON body string.");
  return JSON.parse(init.body) as Record<string, unknown>;
}

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderQuickEntry(
  overrides: Partial<Parameters<typeof CalendarQuickEntry>[0]> = {},
  queryClient = createClient(),
) {
  const onClose = overrides.onClose ?? vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CalendarQuickEntry
        start={new Date("2026-07-30T15:00:00.000Z")}
        stop={new Date("2026-07-30T16:00:00.000Z")}
        projects={[helixProject]}
        tags={[discussionTag]}
        onClose={onClose}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { view, queryClient, onClose };
}

describe("calendar quick entry", () => {
  afterEach(() => {
    cleanup();
    meState.member.role = "admin";
    meState.workspace.members_can_set_billable = true;
  });

  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockResolvedValue({ entry: { id: "entry-new" } });
  });

  it("closes the tag picker on Escape and outside click before closing the draft", async () => {
    const user = userEvent.setup();
    const { onClose } = renderQuickEntry();

    const tagsButton = await screen.findByRole("button", { name: "Choose tags" });
    await user.click(tagsButton);
    expect(screen.getByRole("option", { name: "Discussion" })).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("option", { name: "Discussion" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(tagsButton).toHaveFocus();

    await user.click(tagsButton);
    expect(screen.getByRole("option", { name: "Discussion" })).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("option", { name: "Discussion" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("preserves invalid clock drafts and prevents saving an old valid time", async () => {
    const user = userEvent.setup();
    renderQuickEntry();
    const start = await screen.findByLabelText("Start time");
    await user.clear(start);
    await user.type(start, "invalid");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(start).toHaveValue("invalid");
    expect(start).toHaveAttribute("aria-invalid", "true");
    expect(apiRequestMock).not.toHaveBeenCalled();
    const stop = screen.getByLabelText("Stop time");
    await user.clear(stop);
    await user.type(stop, "10pm");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(apiRequestMock).not.toHaveBeenCalled();
    await user.clear(start);
    await user.type(start, "8pm");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledTimes(1));
    expect(parseBody(apiRequestMock.mock.calls[0]?.[1])).toMatchObject({
      started_at: "2026-07-30T15:00:00.000Z",
      stopped_at: "2026-07-30T17:00:00.000Z",
    });
  });

  it("accepts a stop time across midnight in the member timezone", async () => {
    const user = userEvent.setup();
    renderQuickEntry({
      start: new Date("2026-07-30T18:00:00Z"),
      stop: new Date("2026-07-30T18:30:00Z"),
    });
    const stop = await screen.findByLabelText("Stop time");
    await user.clear(stop);
    await user.type(stop, "12:10am");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledTimes(1));
    expect(parseBody(apiRequestMock.mock.calls[0]?.[1])).toMatchObject({
      started_at: "2026-07-30T18:00:00.000Z",
      stopped_at: "2026-07-30T19:10:00.000Z",
    });
  });

  it("submits once on Enter and derives billable from the project only when permitted", async () => {
    const user = userEvent.setup();
    let resolveSave: (value: unknown) => void = () => undefined;
    apiRequestMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    renderQuickEntry();

    await chooseOption(user, await screen.findByLabelText("Select project"), /^Helix3D/);
    expect(screen.getByRole("button", { name: "Mark non-billable" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const description = screen.getByLabelText("New entry description");
    await user.type(description, "Planning{Enter}{Enter}");
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();

    const body = parseBody(apiRequestMock.mock.calls[0]?.[1]);
    expect(body).toMatchObject({
      description: "Planning",
      project_id: helixProject.id,
      billable: true,
    });
    resolveSave({ entry: { id: "entry-new" } });
  });

  it("does not mark a project billable when the member cannot set billable", async () => {
    const user = userEvent.setup();
    meState.member.role = "member" as Role;
    meState.workspace.members_can_set_billable = false;
    renderQuickEntry();

    expect(screen.queryByRole("button", { name: /billable/i })).not.toBeInTheDocument();
    await chooseOption(user, await screen.findByLabelText("Select project"), /^Helix3D/);
    await user.type(screen.getByLabelText("New entry description"), "Member work{Enter}");

    await waitFor(() => expect(apiRequestMock).toHaveBeenCalled());
    expect(parseBody(apiRequestMock.mock.calls[0]?.[1]).billable).toBe(false);
  });
});
