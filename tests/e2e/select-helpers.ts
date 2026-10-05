import type { Locator } from "@playwright/test";

/** Opens a `Select` trigger and picks the option with the given accessible name. */
export async function chooseOption(trigger: Locator, option: string) {
  await trigger.click();
  await trigger.page().getByRole("option", { name: option, exact: true }).click();
}
