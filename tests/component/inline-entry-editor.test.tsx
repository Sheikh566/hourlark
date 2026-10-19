import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InlineEntryEditor } from "@/web/features/time/inline-entry-editor";
import { apiRequest } from "@/web/lib/api";
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
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ entry });
  });
  afterEach(() => {
    cleanup();
  });

  it("preserves fractional timestamps and inherited rates on metadata saves", async () => {
    const user = userEvent.setup();
    const client = new QueryClient();
    const original = {
      ...entry,
      started_at: "2026-07-30T15:00:00.564Z",
      stopped_at: "2026-07-30T17:00:02.128Z",
      billable: true,
      rate_minor: 1200,
      rate_currency: "EUR",
    };
    render(
      <QueryClientProvider client={client}>
        <InlineEntryEditor
          entry={original}
          projects={projects}
          tags={tags}
          onCancel={vi.fn()}
          onSaved={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await user.type(screen.getByRole("textbox", { name: "Entry description" }), " updated");
    await user.click(screen.getByRole("button", { name: "Save time entry" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const body = JSON.parse(vi.mocked(apiRequest).mock.calls[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      started_at: original.started_at,
      stopped_at: original.stopped_at,
    });
    expect(body).not.toHaveProperty("rate_minor");
    client.clear();
  });

  it("retains invalid date and duration drafts with a visible error", async () => {
    const user = userEvent.setup();
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <InlineEntryEditor
          entry={entry}
          projects={projects}
          tags={tags}
          initialField="time"
          onCancel={vi.fn()}
          onSaved={vi.fn()}
        />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "Save time entry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose valid start and stop");
    expect(apiRequest).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Edit entry date, time, and duration" }));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-07-30" } });
    fireEvent.change(screen.getByLabelText("Entry duration"), { target: { value: "1:75" } });
    await user.click(screen.getByRole("button", { name: "Save time entry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a duration");
    expect(apiRequest).not.toHaveBeenCalled();
    client.clear();
  });

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
    const projectTrigger = screen.getByRole("button", { name: /Project: Korametrics/ });
    expect(projectTrigger).toBeVisible();
    expect(projectTrigger).toHaveTextContent("Korametrics");
    expect(projectTrigger).toHaveTextContent("IOMechs");
    expect(projectTrigger).toHaveTextContent("Korametrics • IOMechs");
    expect(projectTrigger.querySelector("span")).toHaveStyle({ color: "rgb(33, 222, 71)" });
    expect(screen.getByRole("button", { name: "Tags: Discussion" })).toBeVisible();

    await user.click(projectTrigger);
    expect(screen.getByRole("textbox", { name: "Search entry projects" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Internal operations" }));
    expect(screen.getByRole("button", { name: /Project: Internal operations/ })).toBeVisible();

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

  it("uses the measured project picker palette without changing the stored row colour", () => {
    const client = new QueryClient();
    const project = { ...projects[0], color: "#9e5bd9" } as Project;
    render(
      <QueryClientProvider client={client}>
        <InlineEntryEditor
          entry={{
            ...entry,
            project: { ...entry.project, id: project.id, name: project.name, color: project.color },
          }}
          projects={[project]}
          tags={tags}
          initialField="project"
          onCancel={vi.fn()}
          onSaved={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const option = screen.getByRole("button", { name: "Korametrics" });
    expect(option.querySelector('[style^="color:"]')).toHaveStyle({ color: "rgb(196, 139, 246)" });
    const trigger = screen.getByRole("button", { name: /Project: Korametrics/ });
    expect(trigger.querySelector("span")).toHaveStyle({ color: "rgb(158, 91, 217)" });
    client.clear();
  });

  it("opens the requested picker immediately and Escape closes it before canceling", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const onCancel = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <InlineEntryEditor
          entry={entry}
          projects={projects}
          tags={tags}
          initialField="project"
          onCancel={onCancel}
          onSaved={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const search = await screen.findByRole("textbox", { name: "Search entry projects" });
    expect(search).toBeVisible();
    expect(screen.getByRole("button", { name: /Project: Korametrics/ })).toHaveTextContent(
      "IOMechs",
    );

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("textbox", { name: "Search entry projects" }),
    ).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Project: Korametrics/ })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);

    queryClient.clear();
  });

  it("opens the time picker from the initial field without saving", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const onCancel = vi.fn();
    const onSaved = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <InlineEntryEditor
          entry={entry}
          projects={projects}
          tags={tags}
          initialField="time"
          onCancel={onCancel}
          onSaved={onSaved}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("Start date")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();

    queryClient.clear();
  });

  it("edits in place: changed rows save on a click outside, unchanged rows just close", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onCancel = vi.fn();
    const onSaved = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <button type="button">Elsewhere</button>
        <InlineEntryEditor
          entry={entry}
          projects={projects}
          tags={tags}
          onCancel={onCancel}
          onSaved={onSaved}
        />
      </QueryClientProvider>,
    );

    // Same 50px row grid as the display row, with a borderless description input.
    const form = screen.getByRole("form", { name: "Edit Development" });
    expect(form).toHaveClass("lg:h-[50px]");
    const description = screen.getByRole("textbox", { name: "Entry description" });
    expect(description).toHaveClass("entry-inline-input");
    expect(description).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(apiRequest).not.toHaveBeenCalled();

    await user.type(description, " v2");
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const body = JSON.parse(vi.mocked(apiRequest).mock.calls[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({ description: "Development v2", version: 1 });
    expect(onCancel).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });

  it("saves with Enter from the description and keeps billable as a row toggle", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onSaved = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <InlineEntryEditor
          entry={entry}
          projects={projects}
          tags={tags}
          onCancel={vi.fn()}
          onSaved={onSaved}
        />
      </QueryClientProvider>,
    );
    const toggle = screen.getByRole("button", { name: "Mark entry billable" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Mark entry non-billable" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.type(screen.getByRole("textbox", { name: "Entry description" }), "{Enter}");
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const body = JSON.parse(vi.mocked(apiRequest).mock.calls[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({ billable: true });
    queryClient.clear();
  });

  it("keeps the draft and save error when clicking another row", async () => {
    const user = userEvent.setup();
    const client = new QueryClient();
    let rejectSave!: (error: Error) => void;
    vi.mocked(apiRequest).mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
    );
    function Rows() {
      const [editing, setEditing] = useState(true);
      return (
        <>
          <button onClick={() => setEditing(false)}>Edit another row</button>
          {editing ? (
            <InlineEntryEditor
              entry={entry}
              projects={projects}
              tags={tags}
              onCancel={() => setEditing(false)}
              onSaved={() => setEditing(false)}
            />
          ) : null}
        </>
      );
    }
    render(
      <QueryClientProvider client={client}>
        <Rows />
      </QueryClientProvider>,
    );
    await user.type(screen.getByLabelText("Entry description"), " changed");
    await user.click(screen.getByRole("button", { name: "Edit another row" }));
    expect(apiRequest).toHaveBeenCalledTimes(1);
    rejectSave(new Error("Save failed"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Save failed");
    expect(screen.getByLabelText("Entry description")).toHaveValue("Development changed");
    client.clear();
  });

  it("validates an invalid duration on click-away and saves description on keyboard blur", async () => {
    const user = userEvent.setup();
    const client = new QueryClient();
    const onCancel = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <InlineEntryEditor
          entry={entry}
          projects={projects}
          tags={tags}
          initialField="time"
          onCancel={onCancel}
          onSaved={vi.fn()}
        />
        <button>Elsewhere</button>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Entry duration"), { target: { value: "1:75" } });
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a duration");
    expect(apiRequest).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Entry description"), { target: { value: "Updated" } });
    // Restore the duration through the picker, then move focus outside with the keyboard.
    await user.click(screen.getByRole("button", { name: "Edit entry date, time, and duration" }));
    fireEvent.change(screen.getByLabelText("Entry duration"), { target: { value: "2:00:02" } });
    fireEvent.blur(screen.getByLabelText("Entry description"), {
      relatedTarget: screen.getByRole("button", { name: "Elsewhere" }),
    });
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    client.clear();
  });
});
