import { expect, test } from "@playwright/test";

test("notification settings persist and a test notification reaches the inbox", async ({
  page,
}) => {
  await page.goto("/time");

  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByRole("menuitem", { name: "Notifications" }).click();
  const dialog = page.getByRole("dialog", { name: "Notifications" });
  await expect(dialog.getByRole("switch", { name: "Long-running timer" })).toBeChecked();
  await dialog.getByLabel("Warn after (hours)").fill("6");
  // Idempotent so a Playwright retry against the same database still ends with Saturday on.
  const saturday = dialog.getByRole("button", { name: "Saturday" });
  if ((await saturday.getAttribute("aria-pressed")) !== "true") await saturday.click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Notification settings saved")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByRole("menuitem", { name: "Notifications" }).click();
  await expect(dialog.getByLabel("Warn after (hours)")).toHaveValue("6");
  await expect(dialog.getByRole("button", { name: "Saturday" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The server allows one test per minute; a retry inside the same minute waits it out.
  const send = dialog.getByRole("button", { name: "Send test notification" });
  const sent = page.getByText("Test notification sent");
  const throttled = page.getByText("Wait a minute before sending another.");
  await send.click();
  await expect(sent.or(throttled)).toBeVisible();
  if (await throttled.isVisible()) {
    test.setTimeout(120_000);
    await page.waitForTimeout(61_000 - (Date.now() % 60_000));
    await send.click();
    await expect(sent).toBeVisible();
  }
  await dialog.getByRole("button", { name: "Close dialog" }).click();

  const bell = page.getByRole("button", { name: "Notifications, 1 unread" });
  await expect(bell).toBeVisible();
  await bell.click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await expect(panel.getByText("Test notification (unread)", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
});
