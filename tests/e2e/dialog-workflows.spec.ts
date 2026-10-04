import { expect, test, type Page } from "@playwright/test";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

test.use({ timezoneId: "America/Los_Angeles" });

async function createEntry(page: Page, description: string, running = false) {
  const me = (await (await page.request.get("/api/v1/me")).json()) as {
    csrf_token: string;
    member: { timezone: string };
  };
  const day = formatInTimeZone(new Date(), me.member.timezone, "yyyy-MM-dd");
  const started = fromZonedTime(`${day}T09:00:17`, me.member.timezone).toISOString();
  const stopped = fromZonedTime(`${day}T10:00:02`, me.member.timezone).toISOString();
  const result = await page.request.post("/api/v1/time-entries", {
    headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": me.csrf_token },
    data: {
      description,
      started_at: started,
      stopped_at: running ? null : stopped,
      tag_ids: [],
      billable: false,
    },
  });
  expect(result.ok()).toBe(true);
  return {
    day,
    started,
    stopped,
    entry: ((await result.json()) as { entry: { id: string } }).entry,
  };
}

async function fitDialog(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Edit time entry" });
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error("Missing editor");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const boxes = await dialog.locator('input[type="date"], input[type="time"]').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const parent = (el.closest("fieldset") ?? el).getBoundingClientRect();
      return { left: r.left, right: r.right, parentLeft: parent.left, parentRight: parent.right };
    }),
  );
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(box.parentLeft);
    expect(box.right).toBeLessThanOrEqual(box.parentRight);
  }
  await expect(dialog.getByRole("button", { name: "Save entry", exact: true })).toBeVisible();
}

test("calendar edit fits desktop, tablet and mobile and preserves timestamps", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/time");
  const name = `Calendar dialog ${crypto.randomUUID().slice(0, 8)}`;
  const fixture = await createEntry(page, name);
  await page.getByRole("radio", { name: "Calendar", exact: true }).click();
  await page.getByRole("combobox", { name: "Calendar density" }).selectOption("day");
  const event = page.locator(".fc-event").filter({ hasText: name });
  await expect(event).toBeVisible();
  // Browser timezone differs from the member timezone. Calendar must still show 09:00.
  const eventY = await event.boundingBox();
  const nine = await page.locator('.fc-timegrid-slot[data-time="09:00:00"]').last().boundingBox();
  expect(eventY).not.toBeNull();
  expect(nine).not.toBeNull();
  if (eventY && nine) expect(Math.abs(eventY.y - nine.y)).toBeLessThan(20);
  await event.click();
  await expect(page.getByRole("dialog", { name: "Edit time entry" })).toBeVisible();
  await expect(page.getByLabel("Start time", { exact: true })).toHaveValue("09:00:17");
  await expect(page.getByLabel("Stop time", { exact: true })).toHaveValue("10:00:02");
  for (const width of [1280, 768, 320]) {
    await page.setViewportSize({ width, height: 740 });
    await fitDialog(page);
  }
  await page.getByRole("textbox", { name: "Description", exact: true }).fill(`${name} edited`);
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const updated = (await (
    await page.request.get(
      `/api/v1/time-entries?start=${encodeURIComponent(fixture.started)}&end=${encodeURIComponent(new Date(Date.parse(fixture.stopped) + 1000).toISOString())}`,
    )
  ).json()) as {
    entries: { id: string; started_at: string; stopped_at: string; description: string }[];
  };
  expect(updated.entries.find((item) => item.id === fixture.entry.id)).toMatchObject({
    started_at: fixture.started,
    stopped_at: fixture.stopped,
    description: `${name} edited`,
  });
  expect(errors).toEqual([]);
});

test("calendar range creation validates times and supports nested Escape", async ({ page }) => {
  await page.goto("/time?view=calendar");
  await page
    .getByRole("combobox", { name: "Timer member" })
    .selectOption({ label: "IOMechs Manager" });
  const me = (await (await page.request.get("/api/v1/me")).json()) as {
    member: { timezone: string };
  };
  const day = formatInTimeZone(new Date(), me.member.timezone, "yyyy-MM-dd");
  const column = page.locator(`.fc-timegrid-col[data-date="${day}"]`);
  const box = await column.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("Missing calendar column");
  const slot = await page.locator('.fc-timegrid-slot[data-time="11:00:00"]').last().boundingBox();
  if (!slot) throw new Error("Missing calendar hour");
  await page.mouse.move(box.x + box.width / 2, slot.y + 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, slot.y + 30, { steps: 8 });
  await page.mouse.up();
  const form = page.getByRole("form", { name: "Add calendar time entry" });
  await expect(form).toBeVisible();
  await expect(form.getByLabel("Start time", { exact: true })).toHaveValue("11:00");
  await form.getByRole("button", { name: "Choose tags", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(form).toBeVisible();
  await form.getByLabel("Stop time", { exact: true }).fill("10:00");
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(form.getByRole("alert")).toHaveText("Stop must be after start.");
  await form.getByLabel("Stop time", { exact: true }).fill("12:00");
  const desc = `Calendar create ${crypto.randomUUID().slice(0, 8)}`;
  await form.getByRole("textbox", { name: "New entry description" }).fill(desc);
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page.locator(".fc-event").filter({ hasText: desc })).toBeVisible();
});

test("timesheet drafts validate, save and reopen existing entries", async ({ page }) => {
  await page.goto("/time?view=timesheet");
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  const description = page.getByRole("textbox", { name: "Draft row description" });
  await expect(description).toBeVisible();
  const name = `Timesheet audit ${crypto.randomUUID().slice(0, 8)}`;
  await description.fill(name);
  const first = page
    .locator("tr")
    .filter({ has: description })
    .locator('input[placeholder="-"]')
    .first();
  await first.fill("1:75");
  await first.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Minutes must be 00–59");
  await first.fill("1:30");
  await first.press("Enter");
  await expect(description).toBeHidden();
  const row = page.locator("tr").filter({ hasText: name });
  await row.getByRole("button").first().click();
  await expect(page.getByRole("dialog", { name: "Edit time entry" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(name);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("calendar drag and resize persist member-local times and roll back failures", async ({
  page,
}) => {
  await page.goto("/time");
  const name = `Calendar movement ${crypto.randomUUID().slice(0, 8)}`;
  const fixture = await createEntry(page, name);
  const me = (await (await page.request.get("/api/v1/me")).json()) as {
    csrf_token: string;
    member: { timezone: string };
  };
  const start = fromZonedTime(`${fixture.day}T13:00:00`, me.member.timezone).toISOString();
  const stop = fromZonedTime(`${fixture.day}T14:00:00`, me.member.timezone).toISOString();
  const updated = await page.request.patch(`/api/v1/time-entries/${fixture.entry.id}`, {
    headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": me.csrf_token },
    data: { version: 1, started_at: start, stopped_at: stop },
  });
  expect(updated.ok()).toBe(true);
  await page.getByRole("radio", { name: "Calendar", exact: true }).click();
  await page.getByRole("combobox", { name: "Calendar density" }).selectOption("day");
  const event = page.locator(".fc-event").filter({ hasText: name });
  await expect(event).toBeVisible();
  await page.locator('.fc-timegrid-slot[data-time="14:00:00"]').last().scrollIntoViewIfNeeded();
  const thirteen = await page
    .locator('.fc-timegrid-slot[data-time="13:00:00"]')
    .last()
    .boundingBox();
  const fourteen = await page
    .locator('.fc-timegrid-slot[data-time="14:00:00"]')
    .last()
    .boundingBox();
  if (!thirteen || !fourteen) throw new Error("Calendar hours are missing");
  const hourHeight = fourteen.y - thirteen.y;
  const patch = () =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith(`/time-entries/${fixture.entry.id}`) &&
        response.request().method() === "PATCH",
    );
  const drag = async (delta: number) => {
    const box = await event.boundingBox();
    if (!box) throw new Error("Calendar event is missing");
    await page.mouse.move(box.x + box.width / 2, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 12 + delta, { steps: 12 });
    await page.mouse.up();
  };
  const moved = patch();
  await drag(hourHeight);
  const movedResponse = await moved;
  expect(movedResponse.ok()).toBe(true);
  const movedEntry = (
    (await movedResponse.json()) as { entry: { started_at: string; stopped_at: string } }
  ).entry;
  expect(formatInTimeZone(movedEntry.started_at, me.member.timezone, "HH:mm")).toBe("14:00");
  expect(formatInTimeZone(movedEntry.stopped_at, me.member.timezone, "HH:mm")).toBe("15:00");
  await event.scrollIntoViewIfNeeded();
  const handle = await event.locator(".fc-event-resizer-end").boundingBox();
  if (!handle) throw new Error("Calendar resize handle is missing");
  const resized = patch();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2 + hourHeight / 2,
    { steps: 12 },
  );
  await page.mouse.up();
  const resizeResponse = await resized;
  expect(resizeResponse.ok()).toBe(true);
  const resizedEntry = ((await resizeResponse.json()) as { entry: { stopped_at: string } }).entry;
  expect(formatInTimeZone(resizedEntry.stopped_at, me.member.timezone, "HH:mm")).toBe("15:30");
  await page.route(`**/api/v1/time-entries/${fixture.entry.id}`, (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: "entry_conflict", message: "Entry changed elsewhere" } },
    }),
  );
  const rejected = patch();
  await drag(-hourHeight / 2);
  expect((await rejected).status()).toBe(409);
  await expect(
    page.getByText("The calendar change was rolled back: Entry changed elsewhere"),
  ).toBeVisible();
});
