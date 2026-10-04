import { expect, test } from "@playwright/test";
import { formatInTimeZone } from "date-fns-tz";

import type { Project } from "../../src/web/types";

test("project chip, picker dismissal, dates, and report navigation work at mobile width", async ({
  page,
}) => {
  await page.goto("/time");
  await page.getByRole("button", { name: "Choose project", exact: true }).click();
  await page.getByRole("button", { name: "Internal operations", exact: true }).click();
  const chip = page.getByRole("button", { name: /^Project: Internal operations/ });
  await expect(chip).toHaveText(/Internal operations.*Internal/);
  await chip.click();
  await expect(page.getByText("Selected project", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Search projects or clients" }).fill("no such project");
  await expect(page.getByText("No matching projects")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chip).toBeFocused();
  await chip.click();
  await expect(page.getByRole("textbox", { name: "Search projects or clients" })).toHaveValue("");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(chip).toHaveText(/Internal operations.*Internal/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 280, height: 740 });
  const switchBounds = await page.getByRole("radiogroup", { name: "Timer view" }).boundingBox();
  if (!switchBounds) throw new Error("Missing timer view switch");
  for (const radio of await page.getByRole("radio").all()) {
    const bounds = await radio.boundingBox();
    if (!bounds) throw new Error("Missing timer view control");
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(switchBounds.x + switchBounds.width + 1);
  }
  await page.setViewportSize({ width: 320, height: 740 });

  await page.getByRole("button", { name: "All dates", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Choose date range" });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByRole("button", { name: "Select previous period" })).toBeEnabled();
  await page.getByRole("button", { name: "Select previous period" }).click();
  await expect(page.getByRole("button", { name: "Yesterday", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Yesterday", exact: true }).click();
  await picker.getByRole("button", { name: "Reset to All dates" }).click();
  await expect(page.getByRole("button", { name: "Select previous period" })).toBeDisabled();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Summary", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Timer description" })).toBeHidden();
  await page.getByRole("button", { name: "Report date range" }).click();
  await expect(page.getByRole("dialog", { name: "Choose report dates" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Report date range" })).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Timer", exact: true }).click();
  await expect(chip).toHaveText(/Internal operations.*Internal/);
});

test("entry edit targets open directly and reports use inclusive member-local dates", async ({
  page,
}) => {
  await page.goto("/time");
  const meResponse = await page.request.get("/api/v1/me");
  const me = (await meResponse.json()) as { csrf_token: string; member: { timezone: string } };
  const projectsResponse = await page.request.get("/api/v1/projects?status=active");
  const { projects } = (await projectsResponse.json()) as { projects: Project[] };
  const project = projects.find((item) => item.name === "Internal operations");
  expect(project).toBeDefined();
  if (!project) throw new Error("The seeded internal project is missing.");
  const description = `UI parity ${crypto.randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/time-entries", {
    headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": me.csrf_token },
    data: {
      description,
      project_id: project.id,
      tag_ids: [],
      billable: false,
      started_at: new Date(Date.now() - 3_600_000).toISOString(),
      stopped_at: new Date(Date.now() - 1_800_000).toISOString(),
    },
  });
  expect(created.ok()).toBe(true);
  await page.reload();
  let row = page.locator("article").filter({ hasText: description });
  await row
    .getByRole("button", { name: `${project.name} ${project.client_name}`, exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Search entry projects" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Save time entry" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel editing" }).click();
  row = page.locator("article").filter({ hasText: description });
  await row.getByTitle("Edit date, times, and duration", { exact: true }).click();
  await expect(page.getByLabel("Start date", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Entry duration", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel editing" }).click();

  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await page.getByRole("button", { name: "Report date range" }).click();
  const todayQuery = page.waitForResponse(
    (response) =>
      response.url().includes("/reports/summary?") && response.url().includes("group_by=project"),
  );
  await page
    .getByRole("dialog", { name: "Choose report dates" })
    .getByRole("button", { name: "Today", exact: true })
    .click();
  expect((await todayQuery).ok()).toBe(true);
  const today = formatInTimeZone(new Date(), me.member.timezone, "yyyy-MM-dd");
  await page.getByRole("button", { name: "Report date range" }).click();
  await expect(page.getByLabel("Range start date")).toHaveValue(today);
  await expect(page.getByLabel("Range end date")).toHaveValue(today);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Detailed", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Detailed report sort" })).toBeVisible();
});
