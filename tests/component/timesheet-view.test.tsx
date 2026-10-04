import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimesheetView } from "@/web/features/timer/timesheet-view";
import { apiRequest } from "@/web/lib/api";
import type { Project, TimeEntry } from "@/web/types";

vi.mock("@/web/lib/api", () => ({ apiRequest: vi.fn() }));
vi.mock("@/web/app/context", () => ({
  useMe: () => ({
    member: { id: "member-1", timezone: "Asia/Karachi", role: "admin" },
    workspace: { members_can_set_billable: true },
    permissions: { view_team: true },
  }),
}));
vi.mock("@/web/features/time/entry-editor", () => ({
  EntryEditor: ({ open, entry }: { open: boolean; entry: TimeEntry | null }) =>
    open ? (
      <div role="dialog" aria-label="Entry editor">
        {entry?.id}
      </div>
    ) : null,
}));

const weekStart = new Date(2026, 8, 28);
const project = {
  id: "project-1",
  name: "Research",
  color: "#aaa",
  client_id: "c1",
  client_name: "Client",
  billable_default: false,
};
const entry: TimeEntry = {
  id: "entry-1",
  member: { id: "member-1", name: "Member" },
  project,
  client: null,
  description: "Analysis",
  tags: [],
  started_at: "2026-09-28T04:00:00Z",
  stopped_at: "2026-09-28T05:00:00Z",
  duration_ms: 3_600_000,
  running: false,
  billable: false,
  deleted_at: null,
  created_at: "2026-09-28T05:00:00Z",
  updated_at: "2026-09-28T05:00:00Z",
  version: 1,
};
let listedEntries: TimeEntry[] = [];
let listedProjects: Project[] = [];
let post: (body: unknown) => Promise<unknown>;
const clients: QueryClient[] = [];
function itemAt(items: HTMLElement[], index: number): HTMLElement {
  const item = items[index];
  if (!item) throw new Error("Missing test element");
  return item;
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <TimesheetView weekStart={weekStart} memberId="member-1" />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

beforeEach(() => {
  listedEntries = [];
  listedProjects = [project];
  post = vi.fn().mockResolvedValue({});
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockImplementation(async (path, options) => {
    if (options?.method === "POST") return post(JSON.parse(options.body as string) as unknown);
    if (path.startsWith("/projects")) return { projects: listedProjects };
    if (path.startsWith("/tags")) return { tags: [] };
    return { entries: listedEntries };
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe("Timesheet workflows", () => {
  it("excludes archived clients from new rows and honors the project billable default", async () => {
    listedProjects = [
      { ...project, id: "unavailable", name: "Archived client project", client_status: "archived" },
      { ...project, billable_default: true },
    ];
    const user = userEvent.setup();
    mount();
    await screen.findByRole("button", { name: /Add row/ });
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/projects?status=active"));
    await user.click(screen.getByRole("button", { name: /Add row/ }));
    await screen.findByRole("option", { name: "Research" });
    expect(
      screen.queryByRole("option", { name: "Archived client project" }),
    ).not.toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Draft row project" }),
      project.id,
    );
    const cell = screen.getByRole("textbox", { name: "Research Mon" });
    await user.type(cell, "1:30{Enter}");
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: project.id, billable: true }),
      ),
    );
  });

  it("keeps every draft editable/removable and clears drafts on week changes", async () => {
    const user = userEvent.setup();
    const { rerender, client } = mount();
    await user.click(await screen.findByRole("button", { name: /Add row/ }));
    await user.click(screen.getByRole("button", { name: /Add row/ }));
    const descriptions = screen.getAllByRole("textbox", { name: "Draft row description" });
    await user.type(itemAt(descriptions, 0), "First draft");
    await user.type(itemAt(descriptions, 1), "Second draft");
    await user.selectOptions(
      itemAt(screen.getAllByRole("combobox", { name: "Draft row project" }), 0),
      "",
    );
    expect(descriptions[0]).toHaveValue("First draft");
    expect(descriptions[1]).toHaveValue("Second draft");
    await user.click(itemAt(screen.getAllByRole("button", { name: "Remove draft row" }), 0));
    expect(screen.getByRole("textbox", { name: "Draft row description" })).toHaveValue(
      "Second draft",
    );
    rerender(
      <QueryClientProvider client={client}>
        <TimesheetView weekStart={new Date(2026, 9, 5)} memberId="member-1" />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: /Add row/ });
    expect(
      screen.queryByRole("textbox", { name: "Draft row description" }),
    ).not.toBeInTheDocument();
  });

  it("rejects malformed hours and preserves input after failed creation", async () => {
    const user = userEvent.setup();
    post = vi.fn().mockRejectedValue(new Error("Save unavailable"));
    mount();
    await user.click(await screen.findByRole("button", { name: /Add row/ }));
    const duration = screen.getByRole("textbox", { name: "Research Mon" });
    await user.type(duration, "1:99{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Minutes must be 00–59");
    expect(post).not.toHaveBeenCalled();
    await user.clear(duration);
    await user.type(duration, "1.5{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Save unavailable");
    expect(duration).toHaveValue("1.5");
    expect(screen.getByRole("textbox", { name: "Draft row description" })).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        member_id: "member-1",
        started_at: "2026-09-28T04:00:00.000Z",
        stopped_at: "2026-09-28T05:30:00.000Z",
      }),
    );
    const query = vi
      .mocked(apiRequest)
      .mock.calls.find(([path]) => path.startsWith("/time-entries?"))?.[0];
    expect(query).toContain("limit=5000");
    expect(query).toContain("start=2026-09-27T19%3A00%3A00.000Z");
  });

  it("blocks duplicate pending creates and removes the draft after success", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => {};
    post = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mount();
    await user.click(await screen.findByRole("button", { name: /Add row/ }));
    const duration = screen.getByRole("textbox", { name: "Research Mon" });
    await user.type(duration, "1:30");
    fireEvent.blur(duration);
    fireEvent.blur(duration);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(duration).toBeDisabled();
    finish({});
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Draft row description" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("edits single entries and chooses individual entries from aggregate cells", async () => {
    const user = userEvent.setup();
    listedEntries = [
      entry,
      {
        ...entry,
        id: "entry-2",
        started_at: "2026-09-28T06:00:00Z",
        stopped_at: "2026-09-28T07:00:00Z",
      },
      {
        ...entry,
        id: "entry-3",
        started_at: "2026-09-29T04:00:00Z",
        stopped_at: "2026-09-29T05:00:00Z",
      },
    ];
    const { rerender, client } = mount();
    await user.click(await screen.findByRole("button", { name: "Edit Research Mon 2 entries" }));
    expect(screen.getByRole("dialog", { name: "Choose an entry to edit" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /11:00/ }));
    expect(screen.getByRole("dialog", { name: "Entry editor" })).toHaveTextContent("entry-2");
    expect(post).not.toHaveBeenCalled();
    rerender(
      <QueryClientProvider client={client}>
        <TimesheetView weekStart={weekStart} memberId="member-2" />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "Edit Research Tue 1 entry" }));
    expect(screen.getByRole("dialog", { name: "Entry editor" })).toHaveTextContent("entry-3");
  });
  it("splits overnight entries and clips both week boundaries without losing entry identity", async () => {
    const user = userEvent.setup();
    listedEntries = [
      {
        ...entry,
        id: "before-week",
        started_at: "2026-09-27T17:00:00Z",
        stopped_at: "2026-09-27T20:00:00Z",
        duration_ms: 3 * 3_600_000,
      },
      {
        ...entry,
        id: "overnight",
        started_at: "2026-09-28T18:00:00Z",
        stopped_at: "2026-09-28T21:00:00Z",
        duration_ms: 3 * 3_600_000,
      },
      {
        ...entry,
        id: "after-week",
        started_at: "2026-10-04T18:00:00Z",
        stopped_at: "2026-10-04T21:00:00Z",
        duration_ms: 3 * 3_600_000,
      },
      {
        ...entry,
        id: "outside-week",
        description: "Outside",
        started_at: "2026-10-05T04:00:00Z",
        stopped_at: "2026-10-05T05:00:00Z",
      },
    ];
    const { container } = mount();
    expect(
      await screen.findByRole("button", { name: "Edit Research Mon 2 entries" }),
    ).toHaveTextContent("2:00");
    expect(screen.getByRole("button", { name: "Edit Research Tue 1 entry" })).toHaveTextContent(
      "2:00",
    );
    expect(screen.getByRole("button", { name: "Edit Research Sun 1 entry" })).toHaveTextContent(
      "1:00",
    );
    const footer = container.querySelector("tfoot");
    if (!footer) throw new Error("Missing totals");
    expect(
      within(footer)
        .getAllByRole("cell")
        .map((cell) => cell.textContent.trim()),
    ).toEqual(["Total", "2 h", "2 h", "0 h", "0 h", "0 h", "0 h", "1 h", "5 h"]);
    expect(screen.queryByText("Outside")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit Research Tue 1 entry" }));
    expect(screen.getByRole("dialog", { name: "Entry editor" })).toHaveTextContent("overnight");
    expect(post).not.toHaveBeenCalled();
  });

  it("uses local midnight boundaries through a daylight saving change and clips running entries", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-02T07:00:00Z"));
    listedEntries = [
      {
        ...entry,
        id: "running",
        started_at: "2026-11-01T04:00:00Z",
        stopped_at: null,
        duration_ms: 0,
        running: true,
      },
    ];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    const { container } = render(
      <QueryClientProvider client={client}>
        <TimesheetView
          weekStart={new Date(2026, 9, 26)}
          memberId="member-1"
          timezone="America/New_York"
        />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("button", { name: "Edit Research Sun 1 entry" }),
    ).toHaveTextContent("25:00");
    const footer = container.querySelector("tfoot");
    if (!footer) throw new Error("Missing totals");
    expect(within(footer).getAllByRole("cell").at(-1)).toHaveTextContent("25 h");
  });
});
