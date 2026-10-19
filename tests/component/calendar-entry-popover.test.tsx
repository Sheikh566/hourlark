import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/web/components/ui";
import { CalendarEntryPopover } from "@/web/features/time/calendar-entry-popover";
import type * as ApiModule from "@/web/lib/api";
import { ApiClientError, apiRequest } from "@/web/lib/api";
import type { TimeEntry } from "@/web/types";

vi.mock("@/web/lib/api", async (original) => ({
  ...(await original<typeof ApiModule>()),
  apiRequest: vi.fn(),
}));
vi.mock("@/web/app/context", () => ({
  useMe: () => ({
    member: { id: "member-1", role: "admin", timezone: "America/New_York" },
    workspace: { currency: "USD", members_can_set_billable: true },
    permissions: { financial: true },
  }),
}));
const entry: TimeEntry = {
  id: "entry-1",
  member: { id: "member-1", name: "Admin" },
  project: null,
  client: null,
  description: "Review",
  tags: [],
  // Second occurrence of 01:30 during DST fallback; unchanged fields must retain the instant.
  started_at: "2026-11-01T06:30:00.123Z",
  stopped_at: "2026-11-01T07:00:00.456Z",
  duration_ms: 1800333,
  running: false,
  billable: false,
  deleted_at: null,
  created_at: "2026-11-01T07:00:00Z",
  updated_at: "2026-11-01T07:00:00Z",
  version: 3,
};
const clients: QueryClient[] = [];
function mount(targetMemberId = "member-1") {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  clients.push(client);
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <CalendarEntryPopover
          entry={entry}
          targetMemberId={targetMemberId}
          anchor={{ x: 200, y: 200 }}
          projects={[]}
          tags={[]}
          onClose={onClose}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return onClose;
}
function body(index = 0) {
  return JSON.parse(vi.mocked(apiRequest).mock.calls[index]?.[1]?.body as string) as Record<
    string,
    unknown
  >;
}
beforeEach(() => {
  vi.mocked(apiRequest).mockReset().mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

describe("calendar edit safeguards", () => {
  it("saves description with version and unchanged exact instants across a DST fold", async () => {
    const user = userEvent.setup();
    const onClose = mount();
    await user.clear(screen.getByRole("textbox", { name: "Entry description" }));
    await user.type(screen.getByRole("textbox", { name: "Entry description" }), "Updated");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(body()).toMatchObject({
      version: 3,
      description: "Updated",
      started_at: entry.started_at,
      stopped_at: entry.stopped_at,
    });
  });
  it("retries a lock only with the explicit audit reason and keeps the version", async () => {
    vi.mocked(apiRequest)
      .mockRejectedValueOnce(new ApiClientError(409, "override_reason_required", "Locked"))
      .mockResolvedValueOnce({});
    vi.spyOn(window, "prompt").mockReturnValue("Approved correction");
    const user = userEvent.setup();
    const onClose = mount();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(body(1)).toMatchObject({ version: 3, override_reason: "Approved correction" });
  });
  it("keeps the editor and draft on version conflict", async () => {
    vi.mocked(apiRequest).mockRejectedValue(
      new ApiClientError(409, "version_conflict", "Entry changed elsewhere"),
    );
    const user = userEvent.setup();
    const onClose = mount();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Entry changed elsewhere");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Entry description" })).toHaveValue("Review");
  });
  it("hides Continue when viewing another member", () => {
    mount("member-2");
    expect(screen.queryByRole("button", { name: "Continue time entry" })).not.toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
  });
  it("deletes with the labelled menu action and offers Undo", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByText("The time entry was deleted.")).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith("/time-entries/entry-1", { method: "DELETE" });
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("/time-entries/entry-1/restore", {
        method: "POST",
        body: "{}",
      }),
    );
  });
});
