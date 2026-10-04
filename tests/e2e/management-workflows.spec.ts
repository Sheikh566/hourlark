import { expect, test } from "@playwright/test";

test("workspace settings validate, persist report defaults, and load audit history", async ({
  page,
}) => {
  await page.goto("/administration");
  const currency = page.getByRole("textbox", { name: "Default currency", exact: true });
  await expect(currency).toHaveValue("USD");
  await currency.fill("??");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Enter a three-letter currency code.");
  await currency.fill("USD");
  await page
    .getByRole("checkbox", { name: "Include descriptions by default", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Workspace settings saved.");
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Include descriptions by default", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await page.getByRole("button", { name: "Time Report PDF", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("checkbox", { name: "Descriptions", exact: true }),
  ).not.toBeChecked();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Administration", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Include descriptions by default", exact: true })
    .check();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Workspace settings saved.");
  await page.getByRole("button", { name: "Audit log", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Immutable audit history", exact: true }),
  ).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();
});

test("client and project creation, editing, search and archive recovery", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const suffix = crypto.randomUUID().slice(0, 8);
  const client = `Client audit ${suffix}`,
    project = `Project audit ${suffix}`;
  await page.goto("/clients");
  await page.getByRole("button", { name: "New client", exact: true }).click();
  await page.getByRole("button", { name: "Save client", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("This field is required");
  await page.getByRole("textbox", { name: "Client name", exact: true }).fill(client);
  await page
    .getByRole("textbox", { name: "Billing email", exact: true })
    .fill("billing@iomechs.com");
  await page.getByRole("spinbutton", { name: "Default hourly rate", exact: true }).fill("12");
  await page.getByRole("button", { name: "Save client", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const card = page.locator("article").filter({ hasText: client });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: `Edit ${client}`, exact: true }).click();
  await page.getByRole("textbox", { name: "Notes", exact: true }).fill("Client notes");
  await page.getByRole("button", { name: "Save client", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await card.getByRole("button", { name: "View projects", exact: true }).click();
  await expect(page).toHaveURL(/client_id=/);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByRole("combobox", { name: "Client", exact: true }).selectOption({ label: client });
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("This field is required");
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill(project);
  await page.getByRole("spinbutton", { name: "Hourly rate", exact: true }).fill("25");
  await page.getByRole("spinbutton", { name: "Budget hours", exact: true }).fill("10");
  await page.getByRole("checkbox", { name: "Billable by default", exact: true }).check();
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const projectCard = page.locator("article").filter({ hasText: project });
  await expect(projectCard).toBeVisible();
  await projectCard.getByRole("button", { name: `Edit ${project}`, exact: true }).click();
  await page.getByRole("textbox", { name: "Notes", exact: true }).fill("Project notes");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByPlaceholder("Search projects").fill("no matching project");
  await expect(page.getByRole("heading", { name: "No projects found" })).toBeVisible();
  await page.getByPlaceholder("Search projects").fill(project);
  await expect(projectCard).toBeVisible();
  await projectCard.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(projectCard).toBeHidden();
  await page.getByRole("combobox", { name: "Filter projects by status" }).selectOption("archived");
  await expect(projectCard).toBeVisible();
  await projectCard.getByRole("button", { name: "Reactivate", exact: true }).click();
  await expect(projectCard).toBeHidden();
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.getByPlaceholder("Search clients").fill(client);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(card).toBeHidden();
  await page.locator("main select").selectOption("archived");
  await expect(card).toBeVisible();
  // Existing project metadata remains editable while the client stays archived.
  await card.getByRole("button", { name: "View projects", exact: true }).click();
  await page.getByRole("button", { name: `Edit ${project}`, exact: true }).click();
  await page
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("Archived client, retained association");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(errors).toEqual([]);
});

test("tags and members have working validation, editing and status controls", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8),
    tag = `Tag audit ${suffix}`,
    name = `Member audit ${suffix}`;
  await page.goto("/tags");
  await page.getByRole("button", { name: "New tag", exact: true }).click();
  await page.getByRole("button", { name: "Save tag", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter a tag name.");
  await page.getByRole("textbox", { name: "Tag name", exact: true }).fill(tag);
  await page.getByRole("button", { name: "Save tag", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: `${tag} active`, exact: true }).click();
  await page.getByRole("textbox", { name: "Tag name", exact: true }).fill(`${tag} edited`);
  await page.getByRole("button", { name: "Save tag", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const tagRow = page.locator("section .divide-y > div").filter({ hasText: `${tag} edited` });
  await tagRow.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(tagRow).toBeHidden();
  await page.locator("main select").selectOption("archived");
  await expect(tagRow).toBeVisible();
  await tagRow.getByRole("button", { name: "Reactivate", exact: true }).click();
  await expect(tagRow).toBeHidden();
  await page.getByRole("link", { name: "Members", exact: true }).click();
  await page.getByRole("button", { name: "Add member", exact: true }).click();
  await page.getByRole("button", { name: "Save member", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Enter a valid email");
  await page
    .getByRole("textbox", { name: "Company email", exact: true })
    .fill(`audit-${suffix}@iomechs.com`);
  await page.getByRole("textbox", { name: "Display name", exact: true }).fill(name);
  await page.getByRole("spinbutton", { name: "Weekly target hours", exact: true }).fill("35");
  await page.getByRole("button", { name: "Save member", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByPlaceholder("Search members").fill(name);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  await page.getByRole("textbox", { name: "Display name", exact: true }).fill(`${name} edited`);
  await page.getByRole("button", { name: "Save member", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: `Edit ${name} edited`, exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("combobox", { name: "Account status", exact: true })
    .selectOption("inactive");
  await page.getByRole("button", { name: "Save member", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("tr").filter({ hasText: `${name} edited` })).toContainText("inactive");
});

test("every management dialog fits 320px and 768px with visible footer actions", async ({
  page,
}) => {
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 640 });
    for (const [path, button] of [
      ["/clients", "New client"],
      ["/projects", "New project"],
      ["/members", "Add member"],
      ["/tags", "New tag"],
    ] as const) {
      await page.goto(path);
      await page.getByRole("button", { name: button, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      for (const box of await dialog.locator("input,select,textarea").evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          const d = (el.closest('[role="dialog"]') ?? el).getBoundingClientRect();
          return { left: r.left, right: r.right, dialogLeft: d.left, dialogRight: d.right };
        }),
      )) {
        expect(box.left).toBeGreaterThanOrEqual(box.dialogLeft);
        expect(box.right).toBeLessThanOrEqual(box.dialogRight);
      }
      await expect(dialog.getByRole("button", { name: /Save/ })).toBeInViewport();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        )
        .toBe(true);
    }
  }
});
