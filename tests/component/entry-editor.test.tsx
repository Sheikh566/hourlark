import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EntryEditor } from "@/web/features/time/entry-editor";
import type { MeResponse, Project, Role, Tag, TimeEntry } from "@/web/types";

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
  ApiClientError: class ApiClientError extends Error {
    code = "api_error";
  },
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
const archivedTag: Tag = {
  id: "tag-archived",
  name: "Legacy",
  color: "#64748b",
  status: "archived",
};

const entry: TimeEntry = {
  id: "entry-1",
  member: { id: "member-1", name: "Admin" },
  project: { id: helixProject.id, name: helixProject.name, color: helixProject.color },
  client: { id: helixProject.client_id, name: helixProject.client_name },
  description: "Development",
  tags: [archivedTag],
  started_at: "2026-07-30T15:00:17.564Z",
  stopped_at: "2026-07-30T17:00:02.128Z",
  duration_ms: 7_185_000,
  running: false,
  billable: true,
  rate_minor: 15000,
  rate_currency: "EUR",
  deleted_at: null,
  created_at: "2026-07-30T17:00:02.000Z",
  updated_at: "2026-07-30T17:00:02.000Z",
  version: 4,
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

function renderEditor(
  overrides: Partial<ComponentProps<typeof EntryEditor>> = {},
  queryClient = createClient(),
) {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <EntryEditor
        open
        onOpenChange={vi.fn()}
        entry={entry}
        projects={[helixProject]}
        tags={[discussionTag]}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { view, queryClient };
}

describe("entry editor", () => {
  afterEach(() => {
    cleanup();
    meState.member.role = "admin";
    meState.member.timezone = "Asia/Karachi";
    meState.workspace.members_can_set_billable = true;
    meState.workspace.currency = "USD";
    meState.permissions.financial = true;
  });

  beforeEach(() => {
    apiRequestMock.mockReset();
    apiRequestMock.mockResolvedValue({ entry });
  });

  it("uses labeled date and time controls and keeps seconds on a description-only save", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderEditor();

    expect(await screen.findByRole("dialog", { name: /Edit time entry/ })).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/T\d{2}:\d{2}$/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-07-30");
    expect(screen.getByLabelText("Start time")).toHaveValue("20:00:17");
    expect(screen.getByLabelText("Stop date")).toHaveValue("2026-07-30");
    expect(screen.getByLabelText("Stop time")).toHaveValue("22:00:02");

    const description = screen.getByLabelText("Description");
    await user.clear(description);
    await user.type(description, "Updated notes");
    await user.click(screen.getByRole("button", { name: "Save entry" }));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        "/time-entries/entry-1",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    const body = parseBody(apiRequestMock.mock.calls[0]?.[1]);
    expect(body).toMatchObject({
      version: 4,
      description: "Updated notes",
      started_at: "2026-07-30T15:00:17.564Z",
      stopped_at: "2026-07-30T17:00:02.128Z",
      project_id: helixProject.id,
      tag_ids: [archivedTag.id],
    });
    expect(body).not.toHaveProperty("rate_minor");
    expect(body).not.toHaveProperty("rate_currency");
    queryClient.clear();
  });

  it("preserves fractional timestamps and keeps running entries running", async () => {
    const user = userEvent.setup();
    const runningEntry = {
      ...entry,
      running: true,
      stopped_at: null,
      started_at: "2026-07-30T15:00:17.564Z",
    };
    const { queryClient } = renderEditor({ entry: runningEntry });
    expect(await screen.findByLabelText("Stop time")).toBeDisabled();
    expect(screen.getByLabelText("Duration (h:mm:ss)")).toBeDisabled();
    await user.clear(screen.getByLabelText("Description"));
    await user.type(screen.getByLabelText("Description"), "Running notes");
    await user.click(screen.getByRole("button", { name: "Save entry" }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalled());
    const body = parseBody(apiRequestMock.mock.calls[0]?.[1]);
    expect(body.started_at).toBe(runningEntry.started_at);
    expect(body).not.toHaveProperty("stopped_at");
    queryClient.clear();
  });

  it("keeps an archived project and tag that active lists omit", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderEditor({ projects: [], tags: [] });

    expect(await screen.findByLabelText("Project")).toHaveDisplayValue("Helix3D • Upwork");
    expect(screen.getByLabelText("Legacy")).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Save entry" }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalled());
    const body = parseBody(apiRequestMock.mock.calls[0]?.[1]);
    expect(body.project_id).toBe(helixProject.id);
    expect(body.tag_ids).toEqual([archivedTag.id]);
    queryClient.clear();
  });

  it("updates duration from start/stop and preserves start when duration changes across DST", async () => {
    const user = userEvent.setup();
    meState.member.timezone = "America/New_York";
    const dstEntry: TimeEntry = {
      ...entry,
      started_at: "2026-03-08T06:00:00.000Z",
      stopped_at: "2026-03-08T08:00:00.000Z",
      tags: [],
    };
    const { queryClient } = renderEditor({ entry: dstEntry, tags: [] });

    expect(await screen.findByLabelText("Start time")).toHaveValue("01:00:00");
    expect(screen.getByLabelText("Stop time")).toHaveValue("04:00:00");
    expect(screen.getByLabelText("Duration (h:mm:ss)")).toHaveValue("2:00:00");

    fireEvent.change(screen.getByLabelText("Stop time"), { target: { value: "05:00:00" } });
    expect(screen.getByLabelText("Duration (h:mm:ss)")).toHaveValue("3:00:00");
    expect(screen.getByLabelText("Start time")).toHaveValue("01:00:00");

    fireEvent.change(screen.getByLabelText("Duration (h:mm:ss)"), { target: { value: "1:30:00" } });
    expect(screen.getByLabelText("Start time")).toHaveValue("01:00:00");
    expect(screen.getByLabelText("Stop time")).toHaveValue("03:30:00");

    await user.click(screen.getByRole("button", { name: "Save entry" }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalled());
    const body = parseBody(apiRequestMock.mock.calls[0]?.[1]);
    expect(body.started_at).toBe("2026-03-08T06:00:00.000Z");
    expect(body.stopped_at).toBe("2026-03-08T07:30:00.000Z");
    queryClient.clear();
  });

  it("shows useful field errors instead of failing silently or throwing", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderEditor();
    await screen.findByRole("dialog");

    fireEvent.change(screen.getByLabelText("Stop time"), { target: { value: "19:00:00" } });
    await user.click(screen.getByRole("button", { name: "Save entry" }));
    expect(await screen.findByText("Stop must be after start.")).toBeInTheDocument();
    expect(apiRequestMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "Save entry" }));
    expect(await screen.findByText("Enter a valid start date and time.")).toBeInTheDocument();
    expect(apiRequestMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-07-30" } });
    fireEvent.change(screen.getByLabelText("Stop time"), { target: { value: "22:00:02" } });
    fireEvent.change(screen.getByLabelText("Duration (h:mm:ss)"), { target: { value: "0" } });
    await user.click(screen.getByRole("button", { name: "Save entry" }));
    expect(
      await screen.findByText("Enter a duration in h:mm:ss, up to 168 hours."),
    ).toBeInTheDocument();

    const description = screen.getByLabelText("Description");
    await user.clear(description);
    await user.type(description, "x".repeat(501));
    fireEvent.change(screen.getByLabelText("Explicit hourly rate (EUR)"), {
      target: { value: "-2" },
    });
    await user.click(screen.getByRole("button", { name: "Save entry" }));
    expect(
      await screen.findByText("Description must be 500 characters or fewer."),
    ).toBeInTheDocument();
    expect(screen.getByText("Enter a valid rate.")).toBeInTheDocument();
    expect(apiRequestMock).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it("hides billable for members who cannot set it and keeps drafts after a network error", async () => {
    const user = userEvent.setup();
    meState.member.role = "member" as Role;
    meState.workspace.members_can_set_billable = false;
    apiRequestMock.mockRejectedValueOnce(new Error("Workspace is temporarily unavailable."));
    const { queryClient } = renderEditor();

    expect(await screen.findByLabelText("Description")).toBeInTheDocument();
    expect(screen.queryByLabelText("Billable")).not.toBeInTheDocument();

    const description = screen.getByLabelText("Description");
    await user.clear(description);
    await user.type(description, "Keep this draft");
    await user.click(screen.getByRole("button", { name: "Save entry" }));

    expect(await screen.findByText("Workspace is temporarily unavailable.")).toBeInTheDocument();
    expect(description).toHaveValue("Keep this draft");
    const body = parseBody(apiRequestMock.mock.calls[0]?.[1]);
    expect(body.billable).toBe(true);
    queryClient.clear();
  });

  it("sends an edited rate with its displayed currency and disables duplicate submits", async () => {
    const user = userEvent.setup();
    let resolveSave: (value: unknown) => void = () => undefined;
    apiRequestMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { queryClient } = renderEditor();

    fireEvent.change(await screen.findByLabelText("Explicit hourly rate (EUR)"), {
      target: { value: "200" },
    });
    const save = screen.getByRole("button", { name: "Save entry" });
    await user.click(save);
    expect(save).toBeDisabled();
    await user.click(save);
    expect(apiRequestMock).toHaveBeenCalledTimes(1);

    resolveSave({ entry });
    await waitFor(() => {
      const body = parseBody(apiRequestMock.mock.calls[0]?.[1]);
      expect(body.rate_minor).toBe(20000);
      expect(body.rate_currency).toBe("EUR");
      expect(body.version).toBe(4);
    });
    queryClient.clear();
  });

  it("resets a mutation error only on a new open and ignores a stale save", async () => {
    const user = userEvent.setup();
    const queryClient = createClient();
    const onOpenChange = vi.fn();
    let resolveFirst: (value: unknown) => void = () => undefined;
    apiRequestMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const secondEntry: TimeEntry = {
      ...entry,
      id: "entry-2",
      description: "Second entry",
      version: 1,
    };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <EntryEditor
          open
          onOpenChange={onOpenChange}
          entry={entry}
          projects={[helixProject]}
          tags={[discussionTag]}
        />
      </QueryClientProvider>,
    );
    await screen.findByRole("dialog", { name: /Edit time entry/ });
    await user.click(screen.getByRole("button", { name: "Save entry" }));

    rerender(
      <QueryClientProvider client={queryClient}>
        <EntryEditor
          open={false}
          onOpenChange={onOpenChange}
          entry={entry}
          projects={[helixProject]}
          tags={[discussionTag]}
        />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <EntryEditor
          open
          onOpenChange={onOpenChange}
          entry={secondEntry}
          projects={[helixProject]}
          tags={[discussionTag]}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByDisplayValue("Second entry")).toBeInTheDocument();

    resolveFirst({ entry });
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("Second entry")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    queryClient.clear();
  });

  it("clears a previous mutation error only when the dialog opens again", async () => {
    const user = userEvent.setup();
    const queryClient = createClient();
    const onOpenChange = vi.fn();
    apiRequestMock.mockRejectedValueOnce(new Error("Save failed"));
    const tree = (open: boolean) => (
      <QueryClientProvider client={queryClient}>
        <EntryEditor
          open={open}
          onOpenChange={onOpenChange}
          entry={entry}
          projects={[helixProject]}
          tags={[discussionTag]}
        />
      </QueryClientProvider>
    );

    const { rerender } = render(tree(true));
    await user.click(await screen.findByRole("button", { name: "Save entry" }));
    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toHaveValue("Development");

    rerender(tree(false));
    rerender(tree(true));
    expect(await screen.findByLabelText("Description")).toHaveValue("Development");
    expect(screen.queryByText("Save failed")).not.toBeInTheDocument();
    queryClient.clear();
  });
});
