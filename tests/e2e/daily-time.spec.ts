import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("member can open the daily time workspace and navigate core views", async ({ page }) => {
  await page.goto("/time");
  await expect(page.getByRole("heading", { name: "Time" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();
  await expect(page.getByLabel("Timer description")).toBeVisible();
  await expect(page.getByRole("button", { name: /project/i })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);

  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await navigation.getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();

  await navigation.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
});
