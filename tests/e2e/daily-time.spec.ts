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
      localStorage.setItem("iomechs.dev-user", "not-seeded@iomechs.com");
      sessionStorage.setItem("development-recovery-seeded", "true");
    }
  });
  await page.goto("/time");

  await expect(page.getByRole("heading", { name: "Unable to open IOMechs Time" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Development account recovery" })).toBeVisible();
  await page.getByRole("button", { name: "Use default development account" }).click();

  await expect(page.getByRole("heading", { name: "Time" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("iomechs.dev-user"))).toBeNull();
});

test("member can open the daily time workspace and navigate core views", async ({ page }) => {
  await page.goto("/time");
  await expect(page.getByRole("heading", { name: "Time" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();
  await expect(page.getByLabel("Timer description")).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose project", exact: true })).toBeVisible();
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

  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await navigation.getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
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

  await navigation.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
});
