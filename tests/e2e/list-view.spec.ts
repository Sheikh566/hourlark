import { expect, test } from "@playwright/test";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

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
    // Keyboard focus reveals row controls (a mouse click elsewhere in the row does not).
    await checkbox.focus();
    await page.keyboard.press("Shift");
    await expect(checkbox).toHaveCSS("opacity", "1");
    await row.hover();
    await expect(row).toHaveCSS("background-color", "rgb(58, 58, 58)");
    const durationRight = await row
      .getByTitle("Edit date, times, and duration")
      .locator(":scope > span:last-child > span > span")
      .evaluate((element) => element.getBoundingClientRect().right);
    const continueBox = await row
      .getByRole("button", { name: "Continue time entry", exact: true })
      .boundingBox();
    const durationGap = (continueBox?.x ?? 0) - durationRight;
    expect(durationGap).toBeGreaterThanOrEqual(21);
    expect(durationGap).toBeLessThanOrEqual(23);
    await label.click();
    const form = page.getByRole("form", { name: `Edit ${description}` });
    expect((await form.boundingBox())?.height).toBe(50);
    const input = page.getByLabel("Entry description");
    await expect(input).toBeFocused();
    expect((await input.boundingBox())?.width).toBe(210);
    expect((await input.boundingBox())?.height).toBe(17);
    await expect(form).toHaveCSS("background-color", "rgb(58, 58, 58)");
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

    // Exercise real ancestor scrolling without adding unrelated entries to the fixture.
    await row.evaluate((element) => {
      const spacer = document.createElement("div");
      spacer.id = "list-scroll-fixture";
      spacer.style.height = "1000px";
      element.closest("section")?.appendChild(spacer);
    });
    const main = page.getByRole("main");
    expect(await main.evaluate((element) => element.clientWidth)).toBe(1689);
    expect((await page.locator(".global-timer").boundingBox())?.width).toBe(1694);
    await row.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    const duplicate = page.getByRole("menuitem", { name: "Duplicate", exact: true });
    await expect(duplicate).toBeFocused();
    await expect(duplicate).toHaveCSS("background-color", "rgb(58, 58, 58)");
    await main.evaluate((element) => {
      element.scrollTop = 100;
    });
    await expect(page.getByRole("menu")).toBeHidden();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect((await page.locator(".global-timer").boundingBox())?.y).toBe(0);
    const sidebar = await page.getByRole("complementary").boundingBox();
    expect(sidebar?.y).toBe(0);
    expect(sidebar?.height).toBe(905);
    const dayHeader = page.getByRole("heading", { name: "Today", exact: true });
    expect((await dayHeader.locator("..").boundingBox())?.y).toBe(84);
    await main.evaluate((element) => {
      document.getElementById("list-scroll-fixture")?.remove();
      element.scrollTop = 0;
    });

    const period = page.getByTitle("Choose date range");
    await period.click();
    const picker = page.getByRole("dialog", { name: "Choose date range" });
    expect((await picker.boundingBox())?.width).toBe(568);
    const yearLabel = picker.getByRole("button", { name: /^Year / }).locator("span");
    // Toggl: 14/500 year button wrapping a 20/600 year label.
    await expect(yearLabel).toHaveCSS("font-size", "20px");
    await expect(yearLabel).toHaveCSS("font-weight", "600");
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

test("the content owns its scrollbar while the shell keeps the viewport width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 905 });
  for (const path of [
    "/time",
    "/time?view=calendar",
    "/time?view=timesheet",
    "/tags",
    "/reports",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", {
        name: path === "/tags" ? "Tags" : path === "/reports" ? "Reports" : "Timer",
        exact: true,
      }),
    ).toBeAttached();
    const main = page.getByRole("main");
    expect((await main.boundingBox())?.width).toBe(1694);
    await expect(main).toHaveCSS("overflow-y", "auto");
    const geometry = await main.evaluate((element) => ({
      fits: element.scrollHeight <= element.clientHeight,
      width: element.clientWidth,
    }));
    expect(geometry.width).toBe(geometry.fits ? 1694 : 1689);
    if (path.startsWith("/time")) {
      expect((await page.locator(".global-timer").boundingBox())?.width).toBe(1694);
    }
    expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(1920);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(905);
  }
  const main = page.getByRole("main");
  await main.evaluate((element) => {
    element.scrollTop = 100;
  });
  await page.getByRole("link", { name: "Tags", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tags", exact: true })).toBeVisible();
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(0);
});

test("phone-width rows keep play and menu beside the description and align durations", async ({
  page,
}) => {
  await page.goto("/time");
  const me = (await (await page.request.get("/api/v1/me")).json()) as { csrf_token: string };
  const headers = { Origin: new URL(page.url()).origin, "X-CSRF-Token": me.csrf_token };
  const description = `HLTEST phone row ${crypto.randomUUID().slice(0, 8)}`;
  const response = await page.request.post("/api/v1/time-entries", {
    headers,
    data: {
      description,
      started_at: new Date(Date.now() - 600_000).toISOString(),
      stopped_at: new Date(Date.now() - 589_000).toISOString(),
      tag_ids: [],
      billable: false,
    },
  });
  expect(response.ok()).toBe(true);
  const { entry } = (await response.json()) as { entry: { id: string } };
  try {
    for (const width of [360, 412]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      const row = page.locator(`[id="time-entry-${entry.id}"]`);
      const label = row.getByRole("button", { name: description, exact: true });
      const play = row.getByRole("button", { name: "Continue time entry", exact: true });
      const menu = row.getByRole("button", { name: "More actions", exact: true });
      const duration = row.getByTitle("Edit date, times, and duration");
      await expect(label).toBeVisible();
      const [labelBox, playBox, menuBox, rowBox, durationBox] = await Promise.all(
        [label, play, menu, row, duration].map((locator) => locator.boundingBox()),
      );
      if (!labelBox || !playBox || !menuBox || !rowBox || !durationBox) {
        throw new Error("phone row parts must be laid out");
      }
      const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
      // Play and menu share the description's line at the right edge; nothing wraps to a 3rd line.
      expect(Math.abs(middle(playBox) - middle(labelBox))).toBeLessThanOrEqual(2);
      expect(Math.abs(middle(menuBox) - middle(labelBox))).toBeLessThanOrEqual(2);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
      expect(rowBox.height).toBeLessThan(90);
      // The time cell ends at the row's right padding, under the menu.
      expect(
        Math.abs(durationBox.x + durationBox.width - (menuBox.x + menuBox.width)),
      ).toBeLessThanOrEqual(1);
      // The day total lines up with the entry durations.
      const day = page
        .locator("section > div")
        .filter({ has: page.getByRole("heading") })
        .first();
      const totalBox = await day.locator("span").last().boundingBox();
      expect(totalBox).not.toBeNull();
      expect(
        Math.abs((totalBox?.x ?? 0) + (totalBox?.width ?? 0) - (durationBox.x + durationBox.width)),
      ).toBeLessThanOrEqual(8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  } finally {
    await page.request.delete(`/api/v1/time-entries/${entry.id}`, { headers });
  }
});
