import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { InlineEntryEditor } from "@/web/features/time/inline-entry-editor";
import type { Project, Tag, TimeEntry } from "@/web/types";

vi.mock("@/web/lib/api", () => ({
  apiRequest: vi.fn(),
  ApiClientError: class ApiClientError extends Error {
    code = "api_error";
  },
}));

vi.mock("@/web/app/context", () => ({
  useMe: () => ({
    member: {
      id: "member-1",
      role: "admin",
      timezone: "Asia/Karachi",
    },
    workspace: {
      currency: "USD",
      members_can_set_billable: true,
    },
    permissions: {
      financial: true,
    },
  }),
}));

const projects: Project[] = [
  {
    id: "project-1",
    name: "Korametrics",
    color: "#21de47",
    client_id: "client-1",
    client_name: "IOMechs",
    billable_default: false,
  },
  {
    id: "project-2",
    name: "Internal operations",
    color: "#82cf30",
    client_id: "client-1",
    client_name: "IOMechs",
    billable_default: false,
  },
];

const discussionTag: Tag = {
  id: "tag-1",
  name: "Discussion",
  color: "#82cf30",
  status: "active",
};
const researchTag: Tag = {
  id: "tag-2",
  name: "R&D",
  color: "#21de47",
  status: "active",
};
const tags: Tag[] = [discussionTag, researchTag];

const entry: TimeEntry = {
  id: "entry-1",
  member: { id: "member-1", name: "Sheikh Abdullah" },
  project: { id: "project-1", name: "Korametrics", color: "#21de47" },
  client: { id: "client-1", name: "IOMechs" },
  description: "Development",
  tags: [discussionTag],
  started_at: "2026-07-30T15:00:00.000Z",
  stopped_at: "2026-07-30T17:00:02.000Z",
  duration_ms: 7_202_000,
  running: false,
  billable: false,
  deleted_at: null,
  created_at: "2026-07-30T17:00:02.000Z",
  updated_at: "2026-07-30T17:00:02.000Z",
  version: 1,
};

describe("inline time-entry editor", () => {
  it("uses compact project, tag, and time popovers", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <InlineEntryEditor
          entry={entry}
          projects={projects}
          tags={tags}
          onCancel={vi.fn()}
          onSaved={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("textbox", { name: "Entry description" })).toHaveValue("Development");
    expect(screen.getByRole("button", { name: "Project: Korametrics" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Tags: Discussion" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Project: Korametrics" }));
    expect(screen.getByRole("textbox", { name: "Search entry projects" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Internal operations" }));
    expect(screen.getByRole("button", { name: "Project: Internal operations" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Tags: Discussion" }));
    await user.click(screen.getByRole("button", { name: "R&D" }));
    expect(screen.getByRole("button", { name: "Tags: Discussion, R&D" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Edit entry date, time, and duration" }));
    expect(screen.getByLabelText("Start date")).toBeVisible();
    expect(screen.getByLabelText("Start time")).toBeVisible();
    expect(screen.getByLabelText("Stop date")).toBeVisible();
    expect(screen.getByLabelText("Stop time")).toBeVisible();
    expect(screen.getByLabelText("Entry duration")).toHaveValue("2:00:02");

    queryClient.clear();
  });
});
