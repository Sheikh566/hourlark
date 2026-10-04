import { expect, test } from "@playwright/test";

test("report filters, CSV and PDF downloads, errors and mobile layout", async ({ page }) => {
  await page.goto("/reports");
  await page.getByRole("button", { name: "Report date range" }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Client", exact: true })
    .selectOption({ label: "Internal" });
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption({ label: "Internal operations" });
  await page.getByRole("button", { name: "More filters" }).click();
  await page.getByRole("combobox", { name: "Billing", exact: true }).selectOption("false");
  await page.getByRole("combobox", { name: "Entry status", exact: true }).selectOption("false");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox", { name: "Billing", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("combobox", { name: "Project", exact: true })).toHaveValue("");
  await page.getByRole("tab", { name: "Detailed", exact: true }).click();
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  expect((await csv).suggestedFilename()).toBe("hourlark-detailed.csv");
  await page.getByRole("button", { name: "Time Report PDF", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Client-ready Time Report" });
  await expect(dialog.getByRole("button", { name: "Generate PDF" })).toBeDisabled();
  await dialog.getByRole("combobox").first().selectOption({ label: "Internal" });
  await dialog.getByRole("textbox", { name: "Report title", exact: true }).fill("Workflow report");
  await page.route("**/api/v1/exports/pdf", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: "export_unavailable", message: "PDF temporarily unavailable" } },
    }),
  );
  await dialog.getByRole("button", { name: "Generate PDF" }).click();
  await expect(dialog.getByRole("alert")).toContainText("PDF temporarily unavailable");
  await page.unroute("**/api/v1/exports/pdf");
  const pdf = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Generate PDF" }).click();
  expect((await pdf).suggestedFilename()).toMatch(
    /^time-report-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.pdf$/,
  );
  await expect(dialog).toBeHidden();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole("button", { name: "Time Report PDF" }).click();
  await expect(dialog.getByRole("button", { name: "Generate PDF" })).toBeInViewport();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More filters" }).click();
  const filters = page.locator("details[open]");
  const bounds = await filters.locator(".timer-popover").boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(320);
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
