import { expect, test } from "@playwright/test";

test("entry actions, bulk delete and Undo, Continue, and mobile pickers", async ({ page }) => {
  await page.goto("/time");
  const me = (await (await page.request.get("/api/v1/me")).json()) as { csrf_token: string };
  const name = `Actions ${crypto.randomUUID().slice(0, 8)}`;
  const fixture = await page.request.post("/api/v1/time-entries", {
    headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": me.csrf_token },
    data: {
      description: name,
      started_at: new Date(Date.now() - 3600000).toISOString(),
      stopped_at: new Date(Date.now() - 1800000).toISOString(),
      tag_ids: [],
      billable: false,
    },
  });
  expect(fixture.ok()).toBe(true);
  await page.reload();
  const original = page.locator("article").filter({ hasText: name });
  await original.getByRole("button", { name: "More actions" }).click();
  await page.keyboard.press("Escape");
  await expect(original.getByRole("button", { name: "Duplicate", exact: true })).toBeHidden();
  await original.getByRole("button", { name: "More actions" }).click();
  await original.getByRole("button", { name: "Duplicate", exact: true }).click();
  const duplicateName = `${name} copy`;
  await page.getByRole("textbox", { name: "Entry description" }).fill(duplicateName);
  await page.getByRole("button", { name: "Save time entry" }).click();
  const copy = page
    .locator("article")
    .filter({ has: page.getByRole("checkbox", { name: `Select ${duplicateName}`, exact: true }) });
  const source = page
    .locator("article")
    .filter({ has: page.getByRole("checkbox", { name: `Select ${name}`, exact: true }) });
  await source.getByRole("checkbox").check();
  await copy.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Delete selected", exact: true }).click();
  await expect(source).toBeHidden();
  await expect(copy).toBeHidden();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(source).toBeVisible();
  await expect(copy).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  await copy.getByRole("button", { name: duplicateName, exact: true }).click();
  for (const [trigger, control] of [
    ["Choose entry project", "Search entry projects"],
    ["Choose entry tags", "Search entry tags"],
    ["Edit entry date, time, and duration", "Start date"],
  ] as const) {
    await page.getByRole("button", { name: trigger, exact: true }).click();
    const bounds = await page.locator("form .timer-popover").boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(320);
    await expect(page.getByLabel(control, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Cancel editing" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await source.getByRole("button", { name: "Continue time entry" }).click();
  await expect(page.getByRole("button", { name: "Stop timer" })).toBeVisible();
  await page.getByRole("button", { name: "Stop timer" }).click();
  await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();
});
