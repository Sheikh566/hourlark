import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  COLOR,
  expectBackground,
  expectNoBackground,
  expectSingleHighlight,
  expectStyle,
  expectSvgPaint,
  hover,
  seedHoverData,
  settle,
  style,
  svgPaint,
  unhover,
  type HoverFixtures,
} from "./hover-helpers";

// Measured Toggl hover states (patterns P1-P14), asserted with the real mouse and exact computed
// colours so Hourlark's hover parity cannot regress.

let data: HoverFixtures;

test.beforeAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  try {
    data = await seedHoverData(request);
  } finally {
    await request.dispose();
  }
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

const entryRow = (page: Page, description: string) =>
  page.locator("article").filter({ hasText: description });

async function openProjectsPage(page: Page) {
  await page.goto("/projects");
  const row = page.locator("tbody tr").filter({ hasText: data.projectName });
  await expect(row).toBeVisible();
  return row;
}

async function openClientsPage(page: Page) {
  await page.goto("/clients");
  const row = page.locator("tbody tr").filter({ hasText: data.clientName });
  await expect(row).toBeVisible();
  return row;
}

async function openEntryMenu(page: Page, row: Locator) {
  await row.hover();
  await row.getByRole("button", { name: "More actions", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

test.describe("P6 checkbox hover", () => {
  test("projects table checkbox goes #1b1b1b to #3a3a3a and keeps the accent when checked", async ({
    page,
  }) => {
    const row = await openProjectsPage(page);
    const checkbox = row.getByRole("checkbox", { name: `Select ${data.projectName}`, exact: true });
    await row.hover({ position: { x: 300, y: 5 } });
    await expectBackground(checkbox, COLOR.surface, "resting checkbox");
    await hover(checkbox);
    await expectBackground(checkbox, COLOR.surfaceHover, "hovered checkbox");

    await checkbox.check();
    await unhover(page);
    await settle(checkbox);
    const accent = await style(checkbox, "backgroundColor");
    expect(accent).not.toBe(COLOR.surface);
    expect(accent).not.toBe(COLOR.surfaceHover);
    await hover(checkbox);
    await expectBackground(checkbox, accent, "checked checkbox keeps its accent while hovered");
    await checkbox.uncheck();
  });

  test("clients table checkbox goes #1b1b1b to #3a3a3a", async ({ page }) => {
    const row = await openClientsPage(page);
    const checkbox = row.getByRole("checkbox", { name: `Select ${data.clientName}`, exact: true });
    await row.hover({ position: { x: 300, y: 5 } });
    await expectBackground(checkbox, COLOR.surface, "resting checkbox");
    await hover(checkbox);
    await expectBackground(checkbox, COLOR.surfaceHover, "hovered checkbox");
  });

  test("tag picker checkbox goes #1b1b1b to #3a3a3a and keeps the accent when checked", async ({
    page,
  }) => {
    await page.goto("/time");
    await page.getByRole("button", { name: "Choose timer tags", exact: true }).click();
    const popover = page.locator(".timer-popover");
    const checkbox = popover.getByRole("checkbox").first();
    await expect(checkbox).toBeVisible();
    await unhover(page);
    await expectBackground(checkbox, COLOR.surface, "resting checkbox");
    await hover(checkbox);
    await expectBackground(checkbox, COLOR.surfaceHover, "hovered checkbox");
    await checkbox.check();
    await unhover(page);
    await settle(checkbox);
    const accent = await style(checkbox, "backgroundColor");
    expect(accent).not.toBe(COLOR.surface);
    expect(accent).not.toBe(COLOR.surfaceHover);
    await hover(checkbox);
    await expectBackground(checkbox, accent, "checked checkbox keeps its accent while hovered");
    await checkbox.uncheck();
  });
});

test.describe("P1 icon button dark box on a hovered row", () => {
  test("clients row: row #3a3a3a, expand chevron and kebab show the #1b1b1b box", async ({
    page,
  }) => {
    const row = await openClientsPage(page);
    await hover(row, { position: { x: 300, y: 5 } });
    await expectBackground(row, COLOR.surfaceHover, "hovered row");

    const chevron = row.getByRole("button", { name: `Expand ${data.clientName}`, exact: true });
    await hover(chevron);
    await expectBackground(row, COLOR.surfaceHover, "row stays highlighted under the chevron");
    await expectBackground(chevron, COLOR.surface, "chevron dark box");
    await expectSvgPaint(chevron, COLOR.fgHover, "chevron icon");

    const kebab = row.getByRole("button", { name: `Actions for ${data.clientName}`, exact: true });
    await hover(kebab);
    await expectBackground(row, COLOR.surfaceHover, "row stays highlighted under the kebab");
    await expectBackground(kebab, COLOR.surface, "kebab dark box");
    await expectSvgPaint(kebab, COLOR.fgHover, "kebab icon");
  });

  test("clients header expand-all chevron shows the #1b1b1b box", async ({ page }) => {
    await openClientsPage(page);
    const expandAll = page.getByRole("button", { name: "Expand all clients", exact: true });
    await hover(expandAll);
    await expectBackground(expandAll, COLOR.surface, "expand-all dark box");
    await expectSvgPaint(expandAll, COLOR.fgHover, "expand-all icon");
  });

  test("tags row action button shows the #1b1b1b box on a hovered row", async ({ page }) => {
    await page.goto("/tags");
    const row = page.locator("tbody tr").filter({ hasText: data.tagNames[0] });
    await expect(row).toBeVisible();
    await hover(row, { position: { x: 300, y: 5 } });
    await expectBackground(row, COLOR.surfaceHover, "hovered row");
    const action = row.getByRole("button", { name: `Actions for ${data.tagNames[0]}` });
    await hover(action);
    await expectBackground(row, COLOR.surfaceHover, "row stays highlighted under the action");
    await expectBackground(action, COLOR.surface, "action dark box");
  });
});

test.describe("RowMenu tones", () => {
  test("list view entry kebab highlights #3a3a3a", async ({ page }) => {
    await page.goto("/time");
    const row = entryRow(page, data.describedEntry);
    await expect(row).toBeVisible();
    await row.hover();
    const kebab = row.getByRole("button", { name: "More actions", exact: true });
    await hover(kebab);
    await expectBackground(kebab, COLOR.surfaceHover);
  });

  test("projects kebab has no background and its icon brightens to #cecece", async ({ page }) => {
    const row = await openProjectsPage(page);
    await hover(row, { position: { x: 300, y: 5 } });
    const kebab = row.getByRole("button", {
      name: `Actions for ${data.projectName}`,
      exact: true,
    });
    await expectNoBackground(kebab, "resting kebab");
    await expectSvgPaint(kebab, "rgb(164, 164, 164)", "resting kebab icon (#a4a4a4)");
    await hover(kebab);
    await expectNoBackground(kebab, "hovered kebab has no box");
    await expectSvgPaint(kebab, COLOR.fgSoft, "hovered kebab icon");
  });
});

test.describe("P8 menu items follow the pointer", () => {
  test("hovering the 3rd entry menu item leaves exactly one highlighted, focused item", async ({
    page,
  }) => {
    await page.goto("/time");
    const row = entryRow(page, data.describedEntry);
    await expect(row).toBeVisible();
    const menu = await openEntryMenu(page, row);
    const items = menu.getByRole("menuitem");
    await expect(items).toHaveCount(3);

    // Toggl focuses the first item when the menu opens.
    await expect(items.nth(0)).toBeFocused();

    const third = items.nth(2);
    await hover(third);
    await expectSingleHighlight(items, third, COLOR.surfaceHover);
    await expect(third).toBeFocused();

    const second = items.nth(1);
    await hover(second);
    await expectSingleHighlight(items, second, COLOR.surfaceHover);
    await expect(second).toBeFocused();
  });

  test("disabled menu items get no hover background", async ({ page }) => {
    await page.goto("/time");
    const row = entryRow(page, data.blankEntryProject);
    await expect(row).toBeVisible();
    const menu = await openEntryMenu(page, row);
    const disabled = menu.getByRole("menuitem", { name: "Copy description", exact: true });
    await expect(disabled).toBeDisabled();
    await hover(disabled);
    await expectNoBackground(disabled, "disabled item hovered");
    await expect(disabled).not.toBeFocused();
  });
});

test.describe("P9 and P10 pickers and filters", () => {
  test("timer project picker highlights only the row under the pointer", async ({ page }) => {
    await page.goto("/time");
    await page.getByRole("button", { name: "Choose project", exact: true }).click();
    const popover = page.locator(".timer-popover");
    const rows = popover.locator("[data-picker-row]");
    await expect(rows.first()).toBeVisible();
    const target = popover.getByRole("button", { name: data.secondProjectName, exact: true });
    await hover(target);
    await expectSingleHighlight(rows, target, COLOR.surfaceHover);
    const other = popover.getByRole("button", { name: data.projectName, exact: true });
    await hover(other);
    await expectSingleHighlight(rows, other, COLOR.surfaceHover);
  });

  test("timer tag picker rows use the soft hover tint", async ({ page }) => {
    await page.goto("/time");
    await page.getByRole("button", { name: "Choose timer tags", exact: true }).click();
    const popover = page.locator(".timer-popover");
    const rows = popover.locator("label").filter({ has: page.getByRole("checkbox") });
    const target = rows.filter({ hasText: data.tagNames[1] });
    await expect(target).toBeVisible();
    await hover(target.locator("span").last());
    await expectBackground(target, COLOR.hoverSoft);
    await expectSingleHighlight(rows, target, COLOR.hoverSoft);
  });

  async function openStatusFilter(page: Page) {
    await page.goto("/projects");
    await page.getByRole("button", { name: "Filter projects by status", exact: true }).click();
    const group = page.getByRole("dialog", { name: "Project status" });
    await expect(group).toBeVisible();
    const unchecked = group.locator("label").filter({ hasText: "Archived" });
    const checked = group.locator("label").filter({ hasText: "Active" });
    await expect(unchecked.getByRole("checkbox")).not.toBeChecked();
    await expect(checked.getByRole("checkbox")).toBeChecked();
    await unhover(page);
    return { unchecked, checked };
  }

  test("project status filter: unchecked row hover-soft", async ({ page }) => {
    const { unchecked } = await openStatusFilter(page);
    await expectNoBackground(unchecked, "resting unchecked row");
    await hover(unchecked, { position: { x: 100, y: 10 } });
    await expectBackground(unchecked, COLOR.hoverSoft, "hovered unchecked row");
  });

  test("project status filter: checked row goes #3a3a3a to #4d4d4d", async ({ page }) => {
    const { checked } = await openStatusFilter(page);
    await expectBackground(checked, COLOR.surfaceHover, "resting checked row");
    await hover(checked, { position: { x: 100, y: 10 } });
    await expectBackground(checked, COLOR.surfaceHoverStrong, "hovered checked row");
  });
});

test.describe("P11 and P12 list entry row", () => {
  test("tag icon brightens to #cecece", async ({ page }) => {
    await page.goto("/time");
    const row = entryRow(page, data.describedEntry);
    await expect(row).toBeVisible();
    await row.hover();
    const tags = row.getByRole("button", { name: /^Edit tags for/ });
    await hover(tags);
    await expectSvgPaint(tags, COLOR.fgSoft);
  });

  test("time range gets the faint tint and #fafafa text, duration the faint tint", async ({
    page,
  }) => {
    await page.goto("/time");
    const row = entryRow(page, data.describedEntry);
    await expect(row).toBeVisible();
    const time = row.getByTitle("Edit date, times, and duration");
    const range = time.locator(":scope > span").first();
    const duration = time.locator(":scope > span:last-child > span");
    await row.hover();
    await expectNoBackground(range, "resting time range");
    await hover(range);
    await expectBackground(range, COLOR.hoverFaint, "hovered time range");
    await expectStyle(range, "color", COLOR.fg, "hovered time range text");
    await hover(duration);
    await expectBackground(duration, COLOR.hoverFaint, "hovered duration");
  });

  test("continue button is 0.5 on row hover and 1 on its own hover", async ({ page }) => {
    await page.goto("/time");
    const row = entryRow(page, data.describedEntry);
    await expect(row).toBeVisible();
    const play = row.getByRole("button", { name: "Continue time entry", exact: true });
    await unhover(page);
    await expectStyle(play, "opacity", "0", "resting continue button");
    await row.hover({ position: { x: 400, y: 5 } });
    await expectStyle(play, "opacity", "0.5", "continue button while the row is hovered");
    await hover(play);
    await expectStyle(play, "opacity", "1", "continue button on its own hover");
  });
});

test.describe("P13 sidebar", () => {
  test("workspace switcher gets the #1b1b1b box and #f5f5f5 text", async ({ page }) => {
    await page.goto("/time");
    const switcher = page.getByRole("button", { name: data.workspaceName }).first();
    await expect(switcher).toBeVisible();
    const label = switcher.locator("span").first();
    await unhover(page);
    await expectNoBackground(switcher, "resting switcher");
    await hover(switcher);
    await expectBackground(switcher, COLOR.surface, "hovered switcher");
    await expectStyle(label, "color", COLOR.fgStrongHover, "hovered switcher text");
  });

  test("workspace menu Settings item gets #3a3a3a and #f5f5f5 text", async ({ page }) => {
    await page.goto("/time");
    await page.getByRole("button", { name: data.workspaceName }).first().click();
    const settings = page.getByRole("menuitem", { name: "Settings", exact: true });
    await expect(settings).toBeVisible();
    await hover(settings);
    await expectBackground(settings, COLOR.surfaceHover);
    await expectStyle(settings, "color", COLOR.fgStrongHover);
  });
});

test.describe("P14 dialogs", () => {
  test("New project dialog: close x keeps its colour, colour swatch shows the #555555 halo", async ({
    page,
  }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: "New project", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const close = dialog.getByRole("button", { name: "Close dialog", exact: true });
    await unhover(page);
    const restingIcon = await svgPaint(close);
    const restingColor = await style(close, "color");
    await hover(close);
    expect(await svgPaint(close), "close icon colour must not change on hover").toBe(restingIcon);
    expect(await style(close, "color"), "close colour must not change on hover").toBe(restingColor);
    await expectNoBackground(close, "close button has no hover box");

    const swatch = dialog.getByRole("button", { name: "Project color", exact: true });
    await unhover(page);
    await expectNoBackground(swatch, "resting swatch trigger");
    await hover(swatch);
    await expectBackground(swatch, COLOR.surfaceActive, "swatch trigger halo");
  });
});

test.describe("P5 and P11 timer and reports icons", () => {
  test("reports period arrows get a #3a3a3a background and a pointer cursor", async ({ page }) => {
    await page.goto("/reports");
    for (const name of ["Previous report period", "Next report period"]) {
      const arrow = page.getByRole("button", { name, exact: true });
      await expect(arrow).toBeVisible({ timeout: 15_000 });
      await hover(arrow);
      await expectBackground(arrow, COLOR.surfaceHover, name);
      await expectStyle(arrow, "cursor", "pointer", `${name} cursor`);
    }
  });

  test("reports date range trigger gets #3a3a3a", async ({ page }) => {
    await page.goto("/reports");
    const trigger = page.getByRole("button", { name: "Report date range", exact: true });
    await hover(trigger);
    await expectBackground(trigger, COLOR.surfaceHover);
  });

  test("timer Manual mode and active Timer mode icons brighten to #cecece", async ({ page }) => {
    await page.goto("/time");
    const manual = page.getByRole("button", { name: "Manual mode", exact: true });
    await expect(manual).toBeVisible();
    await unhover(page);
    await expectSvgPaint(manual, "rgb(164, 164, 164)", "resting Manual mode icon (#a4a4a4)");
    await hover(manual);
    await expectSvgPaint(manual, COLOR.fgSoft, "hovered Manual mode icon");

    const timer = page.getByRole("button", { name: "Timer mode", exact: true });
    await hover(timer);
    await expectSvgPaint(timer, COLOR.fgSoft, "hovered active Timer mode icon");
  });
});

test.describe("P1, P2 and P4 buttons and selects", () => {
  test("projects Client filter (ghost) gets #3a3a3a with unchanged text", async ({ page }) => {
    await page.goto("/projects");
    const filter = page.getByRole("button", { name: /^Client/ }).first();
    await expect(filter).toBeVisible();
    await unhover(page);
    const text = await style(filter, "color");
    await hover(filter);
    await expectBackground(filter, COLOR.surfaceHover);
    await expectStyle(filter, "color", text, "ghost filter text is unchanged");
  });

  test("dialog Advanced options gets the #1b1b1b box and keeps its text colour", async ({
    page,
  }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: "New project", exact: true }).click();
    const advanced = page.getByRole("dialog").getByRole("button", {
      name: "Advanced options",
      exact: true,
    });
    await unhover(page);
    const text = await style(advanced, "color");
    await hover(advanced);
    await expectBackground(advanced, COLOR.surface);
    await expectStyle(advanced, "color", text, "Advanced options text is unchanged");
  });

  test("timesheet project sort header gets the #1b1b1b box and keeps its text colour", async ({
    page,
  }) => {
    await page.goto("/time?view=timesheet");
    const sort = page.getByRole("button", { name: "Sort by project", exact: true });
    await expect(sort).toBeVisible();
    await unhover(page);
    const text = await style(sort, "color");
    await hover(sort);
    await expectBackground(sort, COLOR.surface);
    await expectStyle(sort, "color", text, "sort header text is unchanged");
  });

  test("report Primary group select only recolours its text to #d5d5d5", async ({ page }) => {
    await page.goto("/reports");
    const select = page.getByRole("combobox", { name: "Primary group", exact: true });
    await expect(select).toBeVisible({ timeout: 15_000 });
    await unhover(page);
    const background = await style(select, "backgroundColor");
    await hover(select);
    await expectStyle(select, "color", COLOR.fgHover, "hovered select text");
    await expectBackground(select, background, "select background does not change");
  });
});

test.describe("Settings tabs", () => {
  test("inactive tab gets #3a3a3a background and #ffffff text", async ({ page }) => {
    await page.goto("/administration");
    const tab = page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Audit Log", exact: true });
    await expect(tab).toBeVisible();
    await unhover(page);
    await expectNoBackground(tab, "resting tab");
    await hover(tab);
    await expectBackground(tab, COLOR.surfaceHover);
    await expectStyle(tab, "color", COLOR.white);
  });
});
