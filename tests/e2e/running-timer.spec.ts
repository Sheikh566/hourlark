import { expect, test } from "@playwright/test";

import type { TimeEntry } from "../../src/web/types";

const createdEntries = new Set<string>();
const createdTags = new Set<string>();

test.afterEach(async ({ page }) => {
  const { csrf_token: csrfToken } = (await (await page.request.get("/api/v1/me")).json()) as {
    csrf_token: string;
  };
  const headers = { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrfToken };
  const { entry } = (await (await page.request.get("/api/v1/timer")).json()) as {
    entry: TimeEntry | null;
  };
  if (entry) {
    expect(
      (
        await page.request.post("/api/v1/timer/stop", {
          headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
          data: {},
        })
      ).ok(),
    ).toBe(true);
  }
  for (const id of createdEntries) {
    expect((await page.request.delete(`/api/v1/time-entries/${id}`, { headers })).ok()).toBe(true);
  }
  for (const id of createdTags) {
    expect((await page.request.post(`/api/v1/tags/${id}/archive`, { headers })).ok()).toBe(true);
  }
  createdEntries.clear();
  createdTags.clear();
});

test("running metadata persists on the same D1 entry before Stop", async ({ page }) => {
  const loadingTimer = page.waitForResponse((response) => response.url().endsWith("/timer"));
  await page.goto("/time");
  const { entry: previous } = (await (await loadingTimer).json()) as { entry: TimeEntry | null };
  if (previous) {
    await page.getByRole("button", { name: "Stop timer" }).click();
  }
  await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();
  const meResponse = await page.request.get("/api/v1/me");
  const { csrf_token: csrfToken } = (await meResponse.json()) as { csrf_token: string };
  const tagName = `HLTEST Running edit ${crypto.randomUUID().slice(0, 8)}`;
  const tagFixture = await page.request.post("/api/v1/tags", {
    headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrfToken },
    data: { name: tagName, color: "#cd7fc2" },
  });
  expect(tagFixture.ok()).toBe(true);
  const { tag } = (await tagFixture.json()) as { tag: { id: string } };
  createdTags.add(tag.id);
  await page.reload();
  const description = page.getByRole("combobox", { name: "Timer description" });
  await description.fill("HLTEST Running entry verification");
  await page.getByRole("button", { name: "Choose project", exact: true }).click();
  await page.getByRole("button", { name: "Internal operations", exact: true }).click();

  const starting = page.waitForResponse((response) => response.url().endsWith("/timer/start"));
  await page.getByRole("button", { name: "Start timer" }).click();
  const startResponse = await starting;
  expect(startResponse.ok()).toBe(true);
  const { entry: started } = (await startResponse.json()) as { entry: TimeEntry };
  createdEntries.add(started.id);
  await expect(page.getByRole("button", { name: "Stop timer" })).toBeVisible();

  const patch = () =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith(`/time-entries/${started.id}`) &&
        response.request().method() === "PATCH",
    );
  const edited = patch();
  await description.fill("HLTEST Updated while running");
  await description.press("Enter");
  const editResponse = await edited;
  expect(editResponse.ok()).toBe(true);
  const { entry: updated } = (await editResponse.json()) as { entry: TimeEntry };
  expect(updated).toMatchObject({
    id: started.id,
    started_at: started.started_at,
    stopped_at: null,
    running: true,
    description: "HLTEST Updated while running",
  });
  expect(updated.version).toBe(started.version + 1);

  const projectButton = page.getByRole("button", { name: /^Project: Internal operations/ });
  await expect(projectButton).toBeEnabled();
  await projectButton.click();
  const cleared = patch();
  await page.getByRole("button", { name: "No project", exact: true }).click();
  const clearResponse = await cleared;
  expect(clearResponse.ok()).toBe(true);
  const { entry: noProject } = (await clearResponse.json()) as { entry: TimeEntry };
  expect(noProject.project).toBeNull();
  expect(noProject.started_at).toBe(started.started_at);
  expect(noProject.stopped_at).toBeNull();
  expect(noProject.version).toBe(updated.version + 1);

  await expect(page.getByRole("button", { name: "Choose timer tags" })).toBeEnabled();
  await page.getByRole("button", { name: "Choose timer tags" }).click();
  const tagged = patch();
  const tagCheckbox = page.getByRole("checkbox", { name: tagName, exact: true });
  await tagCheckbox.click();
  const tagResponse = await tagged;
  expect(tagResponse.ok()).toBe(true);
  const { entry: withTag } = (await tagResponse.json()) as { entry: TimeEntry };
  expect(withTag.tags.map((tag) => tag.name)).toContain(tagName);
  expect(withTag.started_at).toBe(started.started_at);
  expect(withTag.stopped_at).toBeNull();
  expect(withTag.version).toBe(noProject.version + 1);
  await expect(tagCheckbox).toBeChecked();

  await description.fill("HLTEST Final description before stopping");
  const finalEdit = patch();
  const stopping = page.waitForResponse((response) => response.url().endsWith("/timer/stop"));
  await page.getByRole("button", { name: "Stop timer" }).click();
  expect((await finalEdit).ok()).toBe(true);
  const stopResponse = await stopping;
  expect(stopResponse.ok()).toBe(true);
  const { entry: stopped } = (await stopResponse.json()) as { entry: TimeEntry };
  expect(stopped).toMatchObject({
    id: started.id,
    started_at: started.started_at,
    description: "HLTEST Final description before stopping",
    running: false,
  });
  expect(stopped.stopped_at).not.toBeNull();
  await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();
});
