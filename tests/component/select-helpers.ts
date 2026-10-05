import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/** Opens a `Select` trigger and picks the option with the given accessible name. */
export async function chooseOption(user: UserEvent, trigger: HTMLElement, option: string | RegExp) {
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: option }));
}
