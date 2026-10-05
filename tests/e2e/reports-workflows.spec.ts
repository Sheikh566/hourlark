import { expect, test } from "@playwright/test";

import { chooseOption } from "./select-helpers";

test("report filters, CSV and PDF downloads, errors and mobile layout", async ({ page }) => {
  await page.goto("/reports");
  await page.getByRole("button", { name: "Report date range" }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("button", { name: "Client", exact: true }).click();
  let filter = page.getByRole("dialog", { name: "Client filter" });
  await filter.getByRole("checkbox", { name: "Internal", exact: true }).check();
  await filter.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Project", exact: true }).click();
  filter = page.getByRole("dialog", { name: "Project filter" });
  await filter.getByRole("checkbox", { name: /Internal operations.*Internal/ }).check();
  await filter.getByRole("button", { name: "Add", exact: true }).click();
  for (const [label, value] of [
    ["Billable", "Non-billable"],
    ["Entry status", "Stopped"],
  ]) {
    await page.getByRole("button", { name: "Add filter", exact: true }).click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
    filter = page.getByRole("dialog", { name: `${label} filter` });
    await filter.getByRole("button", { name: "Match criteria", exact: true }).click();
    await filter.getByRole("option", { name: value, exact: true }).click();
    await filter.getByRole("button", { name: "Add", exact: true }).click();
  }
  await page.getByRole("button", { name: /^Entry status:/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Entry status filter" })).toBeHidden();
  for (const label of ["Project", "Client", "Billable", "Entry status"]) {
    await page.getByRole("button", { name: `Remove ${label} filter` }).click();
  }
  await expect(page.getByRole("button", { name: "Project", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Detailed", exact: true }).click();
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  expect((await csv).suggestedFilename()).toBe("hourlark-detailed.csv");
  await page.getByRole("button", { name: "Time Report PDF", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Client-ready Time Report" });
  await expect(dialog.getByRole("button", { name: "Generate PDF" })).toBeDisabled();
  await chooseOption(dialog.getByRole("combobox").first(), "Internal");
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
  const pdfRequest = page.waitForRequest("**/api/v1/exports/pdf");
  await dialog.getByRole("button", { name: "Generate PDF" }).click();
  const pdfFilters = (await pdfRequest).postDataJSON() as Record<string, unknown>;
  expect((await pdf).suggestedFilename()).toMatch(
    /^time-report-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.pdf$/,
  );
  await expect(dialog).toBeHidden();
  const filteredCsv = page.waitForEvent("download");
  const csvRequest = page.waitForRequest("**/api/v1/exports/csv");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  expect((await filteredCsv).suggestedFilename()).toBe("hourlark-detailed.csv");
  expect((await csvRequest).postDataJSON()).toMatchObject({
    start: pdfFilters.start,
    end: pdfFilters.end,
    timezone: pdfFilters.timezone,
    client_ids: pdfFilters.client_ids,
    client_condition: "is",
  });
  expect(pdfFilters.client_ids).toBe(pdfFilters.client_id);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole("button", { name: "Time Report PDF" }).click();
  await expect(dialog.getByRole("button", { name: "Generate PDF" })).toBeInViewport();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Add filter", exact: true }).click();
  const filters = page.getByRole("dialog", { name: "Add filter", exact: true });
  const bounds = await filters.boundingBox();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(320);
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
