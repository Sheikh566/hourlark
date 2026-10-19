import { expect, test } from "@playwright/test";

test("list rows, in-place editing, grouped selection and date ranges retain measured geometry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 905 });
  await page.goto("/time");
  const me = (await (await page.request.get("/api/v1/me")).json()) as { csrf_token: string };
  const headers = { Origin: new URL(page.url()).origin, "X-CSRF-Token": me.csrf_token };
  const description = `HLTEST list parity ${crypto.randomUUID().slice(0, 8)}`;
  const ids: string[] = [];
  try {
    for (let index = 0; index < 2; index++) {
      const response = await page.request.post("/api/v1/time-entries", {
        headers,
        data: {
          description,
          started_at: new Date(Date.now() - (index + 2) * 3_600_000).toISOString(),
          stopped_at: new Date(Date.now() - (index + 2) * 3_600_000 + 1_800_000).toISOString(),
          tag_ids: [],
          billable: false,
        },
      });
      expect(response.ok()).toBe(true);
      const data = (await response.json()) as { entry: { id: string } };
      ids.push(data.entry.id);
    }
    await page.reload();
    const summary = page.locator("article").filter({ hasText: description });
    await expect(summary).toHaveCount(1);
    expect((await summary.boundingBox())?.height).toBe(50);
    const badge = summary.getByRole("button", {
      name: `Show 2 matching sessions for ${description}`,
    });
    expect((await badge.boundingBox())?.width).toBe(30);
    await badge.click();
    const row = page.locator(`[id="time-entry-${ids[0]}"]`);
    const label = row.getByRole("button", { name: description, exact: true });
    const rowBox = await row.boundingBox();
    const labelBox = await label.boundingBox();
    expect((labelBox?.x ?? 0) - (rowBox?.x ?? 0)).toBe(90);
    await page.mouse.move(1919, 904);
    const checkbox = row.getByRole("checkbox");
    await expect(checkbox).toHaveCSS("opacity", "0");
    await checkbox.focus();
    await expect(checkbox).toHaveCSS("opacity", "1");
    await row.hover();
    await expect(row).toHaveCSS("background-color", "rgb(58, 58, 58)");
    await label.click();
    const form = page.getByRole("form", { name: `Edit ${description}` });
    expect((await form.boundingBox())?.height).toBe(50);
    const input = page.getByLabel("Entry description");
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS("outline-style", "none");
    await input.fill(`${description} edited`);
    await input.press("Enter");
    await expect(form).toBeHidden();
    await row.getByRole("checkbox").check();
    const bulk = page.getByRole("group", { name: "Selected entries actions" });
    expect((await bulk.boundingBox())?.height).toBe(50);
    await expect(bulk).toHaveText(/1 item selected/);
    await bulk.getByRole("button", { name: "Delete selected" }).click();
    await expect(row).toBeHidden();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(row).toBeVisible();

    const period = page.getByTitle("Choose date range");
    await period.click();
    const picker = page.getByRole("dialog", { name: "Choose date range" });
    expect((await picker.boundingBox())?.width).toBe(568);
    await picker.getByRole("button", { name: "Last week", exact: true }).click();
    await expect(period).toHaveText(/Last week.*· W\d+/);
    await page.getByRole("button", { name: "Clear and reset to default" }).click();
    await expect(period).toHaveText("All dates");
    await expect(page.getByRole("button", { name: "Select previous period" })).toBeDisabled();

    await page.setViewportSize({ width: 320, height: 740 });
    await period.click();
    await expect(picker).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.keyboard.press("Escape");
    await expect(period).toBeFocused();
  } finally {
    for (const id of ids) await page.request.delete(`/api/v1/time-entries/${id}`, { headers });
  }
});
