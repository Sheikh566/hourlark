import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

function seriousViolations(
  result: Awaited<ReturnType<InstanceType<typeof AxeBuilder>["analyze"]>>,
) {
  return result.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
}

test("development authentication can recover from an unusable selected identity", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("development-recovery-seeded")) {
      localStorage.setItem("hourlark.dev-user", "not-seeded@iomechs.com");
      sessionStorage.setItem("development-recovery-seeded", "true");
    }
  });
  await page.goto("/time");

  await expect(page).toHaveTitle("Hourlark");
  await expect(page.getByRole("heading", { name: "Unable to open Hourlark" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Development account recovery" })).toBeVisible();
  await page.getByRole("button", { name: "Use default development account" }).click();

  await expect(page.getByRole("heading", { name: "Timer" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("hourlark.dev-user"))).toBeNull();
});

test("timer description selects projects with @ prefix autocomplete", async ({ page }) => {
  await page.goto("/time");
  const timerDescription = page.getByLabel("Timer description");
  await timerDescription.fill("Review @in");

  const projectSuggestions = page.getByRole("listbox", { name: "Project suggestions" });
  await expect(projectSuggestions).toBeVisible();
  await expect(projectSuggestions.getByRole("option").first()).toBeVisible();
  expect(seriousViolations(await new AxeBuilder({ page }).analyze())).toEqual([]);

  await projectSuggestions.getByRole("option").first().click();
  await expect(timerDescription).toHaveValue("Review ");
  await expect(page.getByRole("button", { name: /^Project:/ })).toBeVisible();
});

test("member can open the timer workspace and navigate core views", async ({ page }) => {
  await page.goto("/time");
  await expect(page.getByRole("heading", { name: "Timer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();
  const timerDescription = page.getByLabel("Timer description");
  await expect(timerDescription).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose project", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "List view" })).toBeChecked();

  const editableDescription = page.getByTitle("Edit description").first();
  if (await editableDescription.isVisible()) {
    await editableDescription.click();
    await expect(page.getByRole("button", { name: "Save time entry" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(seriousViolations(await new AxeBuilder({ page }).analyze())).toEqual([]);
    await page.getByRole("button", { name: "Cancel editing" }).click();
  }
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(seriousViolations(accessibility)).toEqual([]);

  await page.getByRole("radio", { name: "Calendar" }).click();
  await expect(page).toHaveURL(/view=calendar/);
  const calendarColumn = page.locator(".fc-timegrid-col[data-date]").nth(2);
  const calendarBox = await calendarColumn.boundingBox();
  expect(calendarBox).not.toBeNull();
  if (calendarBox) {
    await page.mouse.move(calendarBox.x + calendarBox.width / 2, calendarBox.y + 180);
    await page.mouse.down();
    await page.mouse.move(calendarBox.x + calendarBox.width / 2, calendarBox.y + 230, {
      steps: 8,
    });
    await page.mouse.up();
    await expect(page.getByRole("form", { name: "Add calendar time entry" })).toBeVisible();
    expect(seriousViolations(await new AxeBuilder({ page }).analyze())).toEqual([]);
    await page.getByRole("button", { name: "Cancel new entry" }).click();
  }

  await page.getByRole("radio", { name: "Timesheet" }).click();
  await expect(page).toHaveURL(/view=timesheet/);
  await expect(page.getByRole("button", { name: "Add row" })).toBeVisible();

  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await navigation.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
});
