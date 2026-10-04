import { expect, test } from "@playwright/test";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import type { TimeEntry } from "../../src/web/types";

function shiftLocalDate(date: string, days: number): string {
  const utc = new Date(`${date}T12:00:00.000Z`);
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

test("same-day matching sessions group, expand to real entries, and stay split across days", async ({
  page,
}) => {
  await page.goto("/time");
  if (await page.getByRole("button", { name: "Stop timer" }).isVisible()) {
    await page.getByRole("button", { name: "Stop timer" }).click();
  }
  await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();

  const description = `Grouped ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByRole("combobox", { name: "Timer description" }).fill(description);
  await page.getByRole("button", { name: "Start timer" }).click();
  await expect(page.getByRole("button", { name: "Stop timer" })).toBeVisible();
  await page.getByRole("button", { name: "Stop timer" }).click();
  await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();

  const firstRow = page.locator("article").filter({ hasText: description });
  await expect(firstRow).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: `Show 2 matching sessions for ${description}` }),
  ).toHaveCount(0);
  await firstRow.getByRole("button", { name: "Continue time entry" }).click();
  await expect(page.getByRole("button", { name: "Stop timer" })).toBeVisible();

  const count = page.getByRole("button", {
    name: new RegExp(`^(Show|Hide) 2 matching sessions for ${description}$`),
  });
  await expect(count).toBeVisible();
  await expect(count).toHaveText("2");
  await expect(count).toHaveAttribute("aria-expanded", "false");

  await page.getByRole("button", { name: "Stop timer" }).click();
  await expect(page.getByRole("button", { name: "Start timer" })).toBeVisible();
  await expect(count).toBeVisible();
  await expect(count).toHaveText("2");
  await expect(page.locator("article").filter({ hasText: description })).toHaveCount(1);

  await count.click();
  await expect(count).toHaveAttribute("aria-expanded", "true");
  await expect(count).toHaveAccessibleName(`Hide 2 matching sessions for ${description}`);
  const sessions = page.getByRole("checkbox", { name: `Select ${description}`, exact: true });
  await expect(sessions).toHaveCount(2);
  const sessionRows = page
    .locator("article")
    .filter({ has: page.getByRole("button", { name: "More actions" }) })
    .filter({ hasText: description });
  await expect(sessionRows).toHaveCount(2);
  const sessionMenus = sessionRows.locator("[data-entry-menu]");
  await expect(sessionMenus).toHaveCount(2);
  const sessionIds = await sessionMenus.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-entry-menu")),
  );
  expect(sessionIds.every(Boolean)).toBe(true);
  expect(new Set(sessionIds).size).toBe(2);

  const meResponse = await page.request.get("/api/v1/me");
  const me = (await meResponse.json()) as { csrf_token: string; member: { timezone: string } };
  const today = formatInTimeZone(new Date(), me.member.timezone, "yyyy-MM-dd");
  const previousDay = shiftLocalDate(today, -1);
  const created = await page.request.post("/api/v1/time-entries", {
    headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": me.csrf_token },
    data: {
      description,
      tag_ids: [],
      billable: false,
      started_at: fromZonedTime(`${previousDay}T10:00:00`, me.member.timezone).toISOString(),
      stopped_at: fromZonedTime(`${previousDay}T11:00:00`, me.member.timezone).toISOString(),
    },
  });
  expect(created.ok()).toBe(true);
  const { entry: previous } = (await created.json()) as { entry: TimeEntry };
  expect(previous.description).toBe(description);
  await page.reload();

  await expect(
    page.getByRole("button", { name: `Show 2 matching sessions for ${description}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: new RegExp(`Show \\d+ matching sessions for ${description}`),
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("checkbox", { name: `Select ${description}`, exact: true }),
  ).toHaveCount(1);

  await page.setViewportSize({ width: 320, height: 740 });
  const group = page
    .locator("article")
    .filter({
      has: page.getByRole("button", { name: `Show 2 matching sessions for ${description}` }),
    })
    .first();
  await expect(group).toBeVisible();
  const box = await group.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width ?? 0).toBeLessThanOrEqual(320);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
});
