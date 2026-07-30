import { expect, test } from "@playwright/test";

test("member can open the daily time workspace and navigate core views", async ({ page }) => {
  await page.goto("/time");
  await expect(page.getByRole("heading", { name: "Time" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();
  await expect(
    page.getByText("Server time is used when the timer starts and stops."),
  ).toBeVisible();

  await page.getByRole("link", { name: "Calendar" }).click();
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();

  await page.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
});
