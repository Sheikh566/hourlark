import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalTimerBar } from "@/web/features/timer/global-timer";
import type { TimeEntry } from "@/web/types";

const { apiRequestMock, ApiClientError } = vi.hoisted(() => {
  class ApiClientError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
      readonly requestId?: string,
      readonly details?: { authoritative?: unknown },
    ) {
      super(message);
    }
  }
  return {
    apiRequestMock: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(),
    ApiClientError,
  };
});

vi.mock("@/web/lib/api", () => ({
  apiRequest: apiRequestMock,
  idempotencyKey: () => "00000000-0000-4000-8000-000000000999",
  ApiClientError,
}));

vi.mock("@/web/lib/timer", () => ({
  broadcastTimerChange: vi.fn(),
}));

vi.mock("@/web/app/context", () => ({
  useMe: () => ({
    member: {
      id: "00000000-0000-4000-8000-000000000101",
      role: "admin",
      timezone: "Asia/Karachi",
    },
    workspace: {
      currency: "USD",
      members_can_set_billable: true,
    },
  }),
}));

const projectId = "00000000-0000-4000-8000-000000000301";
const otherProjectId = "00000000-0000-4000-8000-000000000302";
const tagId = "00000000-0000-4000-8000-000000000401";

function runningEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "00000000-0000-4000-8000-000000000701",
    member: { id: "00000000-0000-4000-8000-000000000101", name: "Sheikh Abdullah" },
    project: { id: projectId, name: "Internal Operations", color: "#21de47" },
    client: { id: "00000000-0000-4000-8000-000000000201", name: "IOMechs" },
    description: "Review specs",
    tags: [{ id: tagId, name: "R&D", color: "#82cf30", status: "active" }],
    started_at: "2026-07-30T12:00:00.000Z",
    stopped_at: null,
    duration_ms: 0,
    running: true,
    billable: true,
    rate_minor: 15000,
    rate_currency: "USD",
    deleted_at: null,
    created_at: "2026-07-30T12:00:00.000Z",
    updated_at: "2026-07-30T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  const body = init?.body;
  if (typeof body !== "string") throw new Error("Expected a JSON body string.");
  return JSON.parse(body) as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderTimer(queryClient = createClient()) {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <GlobalTimerBar />
    </QueryClientProvider>,
  );
  return { view, queryClient };
}

async function loadedDescription(name = "Review specs") {
  await screen.findByRole("button", { name: "Stop timer" });
  const description = screen.getByRole("combobox", { name: "Timer description" });
  await waitFor(() => {
    expect(description).toHaveValue(name);
  });
  return description;
}

describe("global timer running edits", () => {
  let currentEntry: TimeEntry;

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    currentEntry = runningEntry();
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/projects?status=active") {
        return Promise.resolve({
          projects: [
            {
              id: projectId,
              name: "Internal Operations",
              color: "#21de47",
              client_id: "00000000-0000-4000-8000-000000000201",
              client_name: "IOMechs",
              billable_default: false,
            },
            {
              id: otherProjectId,
              name: "External Delivery",
              color: "#82cf30",
              client_id: "00000000-0000-4000-8000-000000000202",
              client_name: "Client",
              billable_default: true,
            },
          ],
        });
      }
      if (path === "/tags?status=active") {
        return Promise.resolve({
          tags: [{ id: tagId, name: "R&D", color: "#82cf30", status: "active" }],
        });
      }
      if (path === "/me/recent") return Promise.resolve({ recent: [] });
      if (path === "/timer") {
        return Promise.resolve({
          entry: currentEntry,
          server_now: "2026-07-30T12:05:00.000Z",
        });
      }
      if (path === `/time-entries/${currentEntry.id}` && init?.method === "PATCH") {
        const body = parseBody(init);
        currentEntry = {
          ...currentEntry,
          description:
            body.description === undefined
              ? currentEntry.description
              : asString(body.description, currentEntry.description).trim(),
          project:
            body.project_id === undefined
              ? currentEntry.project
              : body.project_id
                ? {
                    id: asString(body.project_id),
                    name: "External Delivery",
                    color: "#82cf30",
                  }
                : null,
          tags:
            body.tag_ids === undefined
              ? currentEntry.tags
              : (body.tag_ids as string[]).includes(tagId)
                ? currentEntry.tags
                : [],
          billable: body.billable === undefined ? currentEntry.billable : Boolean(body.billable),
          version: Number(body.version) + 1,
          updated_at: "2026-07-30T12:06:00.000Z",
          running: true,
          started_at: currentEntry.started_at,
          stopped_at: null,
        };
        return Promise.resolve({
          entry: currentEntry,
          warnings: { overlap: false },
          server_now: "2026-07-30T12:06:00.000Z",
        });
      }
      if (path === "/timer/stop") {
        currentEntry = {
          ...currentEntry,
          running: false,
          stopped_at: "2026-07-30T12:07:00.000Z",
        };
        return Promise.resolve({ entry: currentEntry, server_now: "2026-07-30T12:07:00.000Z" });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
  });

  it("saves a running description without touching timestamps or stopping the timer", async () => {
    const user = userEvent.setup();
    const { view, queryClient } = renderTimer();
    const description = await loadedDescription();
    expect(description).toBeEnabled();

    await user.clear(description);
    await user.type(description, "Write tests");
    await user.tab();

    await waitFor(() => {
      const patch = apiRequestMock.mock.calls.find(
        ([path, init]) =>
          path === `/time-entries/${currentEntry.id}` &&
          (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeTruthy();
      const body = parseBody(patch?.[1] as RequestInit);
      expect(body).toEqual({ version: 1, description: "Write tests" });
      expect(body).not.toHaveProperty("started_at");
      expect(body).not.toHaveProperty("stopped_at");
      expect(body).not.toHaveProperty("rate_minor");
      expect(body).not.toHaveProperty("rate_currency");
    });

    expect(apiRequestMock.mock.calls.some(([path]) => path === "/timer/stop")).toBe(false);
    expect(apiRequestMock.mock.calls.some(([path]) => path === "/timer/start")).toBe(false);
    expect(queryClient.getQueryData<{ entry: TimeEntry }>(["timer"])?.entry.started_at).toBe(
      "2026-07-30T12:00:00.000Z",
    );
    expect(queryClient.getQueryData<{ entry: TimeEntry }>(["timer"])?.entry.running).toBe(true);
    view.unmount();
    queryClient.clear();
  });

  it("persists project, tags, and billable on the running entry with advancing versions", async () => {
    const user = userEvent.setup();
    const { view, queryClient } = renderTimer();
    await loadedDescription();

    const selectedProject = screen.getByRole("button", { name: /Project: Internal Operations/ });
    expect(selectedProject).toHaveTextContent("Internal Operations");
    expect(selectedProject).toHaveTextContent("IOMechs");
    await user.click(selectedProject);
    await user.click(await screen.findByRole("button", { name: "External Delivery" }));

    await waitFor(() => {
      const body = parseBody(
        apiRequestMock.mock.calls.find(
          ([path, init]) =>
            path === `/time-entries/${currentEntry.id}` &&
            (init as RequestInit | undefined)?.method === "PATCH",
        )?.[1] as RequestInit,
      );
      expect(body).toEqual({ version: 1, project_id: otherProjectId });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Mark non-billable" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "Mark non-billable" }));

    await waitFor(() => {
      const patches = apiRequestMock.mock.calls.filter(
        ([path, init]) =>
          path === `/time-entries/${currentEntry.id}` &&
          (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(parseBody(patches[1]?.[1] as RequestInit)).toEqual({ version: 2, billable: false });
    });

    await user.click(screen.getByRole("button", { name: "1 timer tags selected" }));
    await user.click(await screen.findByRole("button", { name: "R&D" }));

    await waitFor(() => {
      const patches = apiRequestMock.mock.calls.filter(
        ([path, init]) =>
          path === `/time-entries/${currentEntry.id}` &&
          (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(parseBody(patches[2]?.[1] as RequestInit)).toEqual({ version: 3, tag_ids: [] });
    });

    expect(apiRequestMock.mock.calls.some(([path]) => path === "/timer/stop")).toBe(false);
    expect(queryClient.getQueryData<{ entry: TimeEntry }>(["timer"])?.entry.billable).toBe(false);
    expect(queryClient.getQueryData<{ entry: TimeEntry }>(["timer"])?.entry.version).toBe(4);
    view.unmount();
    queryClient.clear();
  });

  it("keeps a running null project instead of a stale idle project selection", async () => {
    currentEntry = null as unknown as TimeEntry;
    apiRequestMock.mockImplementation((path: string) => {
      if (path === "/projects?status=active") {
        return Promise.resolve({
          projects: [
            {
              id: projectId,
              name: "Internal Operations",
              color: "#21de47",
              client_id: "00000000-0000-4000-8000-000000000201",
              client_name: "IOMechs",
              billable_default: false,
            },
          ],
        });
      }
      if (path === "/tags?status=active") return Promise.resolve({ tags: [] });
      if (path === "/me/recent") return Promise.resolve({ recent: [] });
      if (path === "/timer") {
        return Promise.resolve({ entry: currentEntry, server_now: "2026-07-30T12:05:00.000Z" });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    const user = userEvent.setup();
    const { view, queryClient } = renderTimer();
    await screen.findByRole("button", { name: "Start timer" });
    await user.click(screen.getByRole("button", { name: "Choose project" }));
    await user.click(await screen.findByRole("button", { name: "Internal Operations" }));
    expect(screen.getByRole("button", { name: /Project: Internal Operations/ })).toBeVisible();

    currentEntry = runningEntry({ project: null, client: null, billable: false });
    queryClient.setQueryData(["timer"], {
      entry: currentEntry,
      server_now: "2026-07-30T12:05:00.000Z",
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Choose project" })).toBeVisible();
    });
    expect(
      screen.queryByRole("button", { name: /Project: Internal Operations/ }),
    ).not.toBeInTheDocument();
    view.unmount();
    queryClient.clear();
  });

  it("retains a rejected description draft through conflict and does not retry silently", async () => {
    const authoritative = runningEntry({
      description: "Server description",
      version: 2,
    });
    apiRequestMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/projects?status=active") {
        return Promise.resolve({
          projects: [
            {
              id: projectId,
              name: "Internal Operations",
              color: "#21de47",
              client_id: "00000000-0000-4000-8000-000000000201",
              client_name: "IOMechs",
              billable_default: false,
            },
          ],
        });
      }
      if (path === "/tags?status=active") return Promise.resolve({ tags: [] });
      if (path === "/me/recent") return Promise.resolve({ recent: [] });
      if (path === "/timer") {
        return Promise.resolve({
          entry: currentEntry,
          server_now: "2026-07-30T12:05:00.000Z",
        });
      }
      if (path === `/time-entries/${currentEntry.id}` && init?.method === "PATCH") {
        currentEntry = authoritative;
        return Promise.reject(
          new ApiClientError(409, "entry_conflict", "The entry changed elsewhere.", "req-1", {
            authoritative,
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    const user = userEvent.setup();
    const { view, queryClient } = renderTimer();
    const description = await loadedDescription();
    await user.clear(description);
    await user.type(description, "Rejected draft");
    await user.tab();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("This entry changed elsewhere");
    });
    expect(description).toHaveValue("Rejected draft");
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();

    const patchesBeforeRetry = apiRequestMock.mock.calls.filter(
      ([path, init]) =>
        path === `/time-entries/${currentEntry.id}` &&
        (init as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patchesBeforeRetry).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Stop timer" }));
    expect(apiRequestMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(
      1,
    );
    expect(apiRequestMock.mock.calls.some(([path]) => path === "/timer/stop")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(description).toHaveValue("Server description");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    view.unmount();
    queryClient.clear();
  });

  it("blocks Stop until a pending description save finishes and skips Stop when it fails", async () => {
    let rejectPatch: ((error: Error) => void) | undefined;
    apiRequestMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/projects?status=active") return Promise.resolve({ projects: [] });
      if (path === "/tags?status=active") return Promise.resolve({ tags: [] });
      if (path === "/me/recent") return Promise.resolve({ recent: [] });
      if (path === "/timer") {
        return Promise.resolve({
          entry: currentEntry,
          server_now: "2026-07-30T12:05:00.000Z",
        });
      }
      if (path === `/time-entries/${currentEntry.id}` && init?.method === "PATCH") {
        return new Promise((_, reject) => {
          rejectPatch = reject;
        });
      }
      if (path === "/timer/stop") {
        return Promise.resolve({ entry: currentEntry, server_now: "2026-07-30T12:07:00.000Z" });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    const user = userEvent.setup();
    const { view, queryClient } = renderTimer();
    const description = await loadedDescription();
    await user.type(description, " and more");
    await user.click(screen.getByRole("button", { name: "Stop timer" }));

    await waitFor(() => {
      expect(
        apiRequestMock.mock.calls.some(
          ([path, init]) =>
            path === `/time-entries/${currentEntry.id}` &&
            (init as RequestInit | undefined)?.method === "PATCH",
        ),
      ).toBe(true);
    });
    expect(apiRequestMock.mock.calls.some(([path]) => path === "/timer/stop")).toBe(false);

    rejectPatch?.(new Error("Save failed"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Save failed");
    });
    expect(description).toHaveValue("Review specs and more");
    expect(apiRequestMock.mock.calls.some(([path]) => path === "/timer/stop")).toBe(false);
    view.unmount();
    queryClient.clear();
  });

  it("waits for a pending metadata save before stopping", async () => {
    const original = apiRequestMock.getMockImplementation();
    if (!original) throw new Error("API fixture missing.");
    let finishPatch: (() => void) | undefined;
    apiRequestMock.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Promise((resolve) => {
          finishPatch = () => resolve(original(path, init));
        });
      }
      return original(path, init);
    });
    const user = userEvent.setup();
    const { view, queryClient } = renderTimer();
    await loadedDescription();
    await user.click(screen.getByRole("button", { name: "Mark non-billable" }));
    await user.click(screen.getByRole("button", { name: "Stop timer" }));
    expect(apiRequestMock.mock.calls.some(([path]) => path === "/timer/stop")).toBe(false);
    finishPatch?.();
    await waitFor(() => {
      expect(apiRequestMock.mock.calls.some(([path]) => path === "/timer/stop")).toBe(true);
    });
    expect(currentEntry.billable).toBe(false);
    view.unmount();
    queryClient.clear();
  });

  it("accepts the server's trimmed description without resaving the old draft", async () => {
    const user = userEvent.setup();
    const { view, queryClient } = renderTimer();
    const description = await loadedDescription();
    await user.clear(description);
    await user.type(description, "  Write tests  ");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(description).toHaveValue("Write tests"));
    await user.tab();
    expect(apiRequestMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(
      1,
    );
    view.unmount();
    queryClient.clear();
  });

  it("saves typing added during a pending save before Stop", async () => {
    const original = apiRequestMock.getMockImplementation();
    if (!original) throw new Error("API fixture missing.");
    let finishPatch: (() => void) | undefined;
    let patches = 0;
    apiRequestMock.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "PATCH" && patches++ === 0) {
        return new Promise((resolve) => {
          finishPatch = () => resolve(original(path, init));
        });
      }
      return original(path, init);
    });
    const user = userEvent.setup();
    const { view, queryClient } = renderTimer();
    const description = await loadedDescription();
    await user.clear(description);
    await user.type(description, "Draft");
    await user.keyboard("{Enter}");
    await user.type(description, " updated");
    await user.click(screen.getByRole("button", { name: "Stop timer" }));
    finishPatch?.();
    await waitFor(() => {
      expect(apiRequestMock.mock.calls.some(([path]) => path === "/timer/stop")).toBe(true);
    });
    const bodies = apiRequestMock.mock.calls
      .filter(([, init]) => init?.method === "PATCH")
      .map(([, init]) => parseBody(init as RequestInit));
    expect(bodies).toEqual([
      { version: 1, description: "Draft" },
      { version: 2, description: "Draft updated" },
    ]);
    expect(currentEntry.description).toBe("Draft updated");
    view.unmount();
    queryClient.clear();
  });

  it("does not carry a draft or late save into a replacement timer from another tab", async () => {
    const original = apiRequestMock.getMockImplementation();
    if (!original) throw new Error("API fixture missing.");
    const oldEntry = currentEntry;
    let finishPatch: (() => void) | undefined;
    apiRequestMock.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = parseBody(init);
        return new Promise((resolve) => {
          finishPatch = () =>
            resolve({
              entry: { ...oldEntry, description: body.description, version: 2 },
            });
        });
      }
      return original(path, init);
    });
    const user = userEvent.setup();
    const { view, queryClient } = renderTimer();
    const description = await loadedDescription();
    await user.type(description, " old draft");
    await user.click(screen.getByRole("button", { name: "Stop timer" }));
    currentEntry = runningEntry({
      id: "00000000-0000-4000-8000-000000000702",
      description: "Replacement timer",
    });
    act(() => {
      queryClient.setQueryData(["timer"], {
        entry: currentEntry,
        server_now: currentEntry.updated_at,
      });
    });
    await waitFor(() => expect(description).toHaveValue("Replacement timer"));
    await act(async () => {
      await Promise.resolve(finishPatch?.());
    });
    await waitFor(() => {
      expect(description).toHaveValue("Replacement timer");
      expect(screen.getByRole("button", { name: "Mark non-billable" })).toBeEnabled();
    });
    expect(apiRequestMock.mock.calls.some(([path]) => path === "/timer/stop")).toBe(false);
    expect(queryClient.getQueryData<{ entry: TimeEntry }>(["timer"])?.entry.id).toBe(
      currentEntry.id,
    );
    view.unmount();
    queryClient.clear();
  });

  it("persists a dirty description before Stop and keeps the local draft while polling", async () => {
    const order: string[] = [];
    apiRequestMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/projects?status=active") return Promise.resolve({ projects: [] });
      if (path === "/tags?status=active") return Promise.resolve({ tags: [] });
      if (path === "/me/recent") return Promise.resolve({ recent: [] });
      if (path === "/timer") {
        return Promise.resolve({
          entry: currentEntry,
          server_now: "2026-07-30T12:05:00.000Z",
        });
      }
      if (path === `/time-entries/${currentEntry.id}` && init?.method === "PATCH") {
        order.push("patch");
        const body = parseBody(init);
        currentEntry = {
          ...currentEntry,
          description: asString(body.description),
          version: Number(body.version) + 1,
        };
        return Promise.resolve({
          entry: currentEntry,
          warnings: { overlap: false },
          server_now: "2026-07-30T12:06:00.000Z",
        });
      }
      if (path === "/timer/stop") {
        order.push("stop");
        return Promise.resolve({ entry: currentEntry, server_now: "2026-07-30T12:07:00.000Z" });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    const user = userEvent.setup();
    const { view, queryClient } = renderTimer();
    const description = await loadedDescription();
    await user.type(description, " extra");
    await queryClient.invalidateQueries({ queryKey: ["timer"] });
    expect(description).toHaveValue("Review specs extra");

    await user.keyboard("{Escape}");
    expect(description).toHaveValue("Review specs");
    await user.type(description, " extra");
    await user.click(screen.getByRole("button", { name: "Stop timer" }));

    await waitFor(() => {
      expect(order).toEqual(["patch", "stop"]);
    });
    const patch = apiRequestMock.mock.calls.find(
      ([path, init]) =>
        path === `/time-entries/${currentEntry.id}` &&
        (init as RequestInit | undefined)?.method === "PATCH",
    );
    expect(parseBody(patch?.[1] as RequestInit)).toEqual({
      version: 1,
      description: "Review specs extra",
    });
    view.unmount();
    queryClient.clear();
  });

  it("keeps an archived running project label visible and restores picker focus on Escape", async () => {
    currentEntry = runningEntry({
      project: { id: "archived-project", name: "Legacy Training", color: "#f59e0b" },
      client: null,
    });
    const user = userEvent.setup();
    const { view, queryClient } = renderTimer();
    await loadedDescription();

    const trigger = screen.getByRole("button", { name: /Project: Legacy Training/ });
    expect(trigger).toHaveTextContent("Legacy Training");
    expect(trigger).toHaveTextContent("Archived");

    await user.click(trigger);
    expect(screen.getByText("Selected project")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(
      screen.queryByRole("textbox", { name: "Search projects or clients" }),
    ).not.toBeInTheDocument();

    view.unmount();
    queryClient.clear();
  });
});
