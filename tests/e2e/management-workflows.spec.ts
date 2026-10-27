import { expect, test, type Locator } from "@playwright/test";

import { chooseOption } from "./select-helpers";

async function rowAction(row: Locator, label: string, action: string) {
  await row.getByRole("button", { name: `Actions for ${label}`, exact: true }).click();
  await row.page().getByRole("menuitem", { name: action, exact: true }).click();
}

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
    .getByRole("switch", { name: "Include descriptions by default", exact: true })
    .uncheck();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Workspace settings saved.");
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Include descriptions by default", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: "PDF", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("checkbox", { name: "Descriptions", exact: true }),
  ).not.toBeChecked();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("switch", { name: "Include descriptions by default", exact: true }).check();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Workspace settings saved.");
  await page.getByRole("button", { name: "Audit Log", exact: true }).click();
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
  await page.getByRole("button", { name: "Create client", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Please enter a Client name");
  await page.getByPlaceholder("Client name", { exact: true }).fill(client);
  await page.getByRole("button", { name: "Advanced options", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Billing email", exact: true })
    .fill("billing@example.com");
  await page.getByRole("spinbutton", { name: "Default hourly rate", exact: true }).fill("12");
  await page.getByRole("button", { name: "Create client", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const card = page.locator("tbody tr").filter({ hasText: client });
  await expect(card).toBeVisible();
  await rowAction(card, client, "Edit");
  await page.getByRole("button", { name: "Advanced options", exact: true }).click();
  await page.getByRole("textbox", { name: "Notes", exact: true }).fill("Client notes");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  // Toggl keeps the Client picker under "Advanced Options".
  await page.getByRole("button", { name: "Advanced options", exact: true }).click();
  await chooseOption(page.getByRole("combobox", { name: "Client", exact: true }), client);
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Please enter a Project name");
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill(project);
  await page.getByRole("spinbutton", { name: "Hourly rate", exact: true }).fill("25");
  await page.getByRole("spinbutton", { name: "Budget hours", exact: true }).fill("10");
  await page.getByRole("switch", { name: "Billable by default", exact: true }).click();
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const projectCard = page.locator("tbody tr").filter({ hasText: project });
  await expect(projectCard).toBeVisible();
  await projectCard.getByRole("button", { name: project, exact: true }).click();
  await page.getByRole("button", { name: "Advanced options", exact: true }).click();
  await page.getByRole("textbox", { name: "Notes", exact: true }).fill("Project notes");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Project name" }).click();
  await page.getByRole("searchbox", { name: "Project name" }).fill("no matching project");
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/projects?") && response.url().includes("search="),
    ),
    page.getByRole("searchbox", { name: "Project name" }).press("Enter"),
  ]);
  await expect(page.getByRole("heading", { name: "No projects found" })).toBeVisible();
  await page.getByRole("button", { name: "Project name" }).click();
  await page.getByRole("searchbox", { name: "Project name" }).fill(project);
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/projects?") && response.url().includes("search="),
    ),
    page.getByRole("searchbox", { name: "Project name" }).press("Enter"),
  ]);
  await expect(projectCard).toBeVisible();
  await rowAction(projectCard, project, "Archive");
  await expect(projectCard).toBeHidden();
  await page.getByRole("button", { name: "Filter projects by status", exact: true }).click();
  await page.getByRole("checkbox", { name: "Archived", exact: true }).check();
  await page.getByRole("checkbox", { name: "Active", exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await expect(projectCard).toBeVisible();
  await rowAction(projectCard, project, "Restore");
  await expect(projectCard).toBeHidden();
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/clients?") && response.url().includes("search="),
    ),
    page.getByRole("searchbox", { name: "Search clients" }).fill(client),
  ]);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await rowAction(card, client, "Archive");
  await expect(card).toBeHidden();
  await chooseOption(
    page.getByRole("combobox", { name: /^Filter (clients|tags) by status$/ }),
    "Show archived",
  );
  await expect(card).toBeVisible();
  // Existing project metadata remains editable while the client stays archived.
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "Project name" }).click();
  await page.getByRole("searchbox", { name: "Project name" }).fill(project);
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/projects?") && response.url().includes("search="),
    ),
    page.getByRole("searchbox", { name: "Project name" }).press("Enter"),
  ]);
  await page.getByRole("button", { name: project, exact: true }).click();
  await page.getByRole("button", { name: "Advanced options", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("Archived client, retained association");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(errors).toEqual([]);
});

test("tags and members have working validation, editing and status controls", async ({ page }) => {
  const suffix = crypto.randomUUID().slice(0, 8),
    tag = `Tag audit ${suffix}`,
    name = `Member audit ${suffix}`;
  await page.goto("/tags");
  await page.getByRole("button", { name: "New Tag", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter a tag name.");
  await page.getByRole("textbox", { name: "Tag name", exact: true }).fill(tag);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: tag, exact: true }).click();
  await page.getByRole("textbox", { name: "Tag name", exact: true }).fill(`${tag} edited`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const tagRow = page.locator("tbody tr").filter({ hasText: `${tag} edited` });
  await rowAction(tagRow, `${tag} edited`, "Archive");
  await expect(tagRow).toBeHidden();
  await chooseOption(
    page.getByRole("combobox", { name: /^Filter (clients|tags) by status$/ }),
    "Show archived",
  );
  await expect(tagRow).toBeVisible();
  await rowAction(tagRow, `${tag} edited`, "Restore");
  await expect(tagRow).toBeHidden();
  await page.getByRole("link", { name: "Members", exact: true }).click();
  await page.getByRole("button", { name: "Add member", exact: true }).click();
  await page.getByRole("button", { name: "Save member", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Enter a valid email");
  await page
    .getByRole("textbox", { name: "Company email", exact: true })
    .fill(`audit-${suffix}@example.com`);
  await page.getByRole("textbox", { name: "Display name", exact: true }).fill(name);
  await page.getByRole("spinbutton", { name: "Weekly target hours", exact: true }).fill("35");
  await page.getByRole("button", { name: "Save member", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("searchbox", { name: "Search members" }).fill(name);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await rowAction(page.locator("tbody tr").filter({ hasText: name }), name, "Edit");
  await page.getByRole("textbox", { name: "Display name", exact: true }).fill(`${name} edited`);
  await page.getByRole("button", { name: "Save member", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await rowAction(
    page.locator("tbody tr").filter({ hasText: `${name} edited` }),
    `${name} edited`,
    "Edit",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await chooseOption(
    page.getByRole("combobox", { name: "Account status", exact: true }),
    "Inactive",
  );
  await page.getByRole("button", { name: "Save member", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Filter members by status", exact: true }).click();
  await page.getByRole("checkbox", { name: "Inactive", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(page.locator("tr").filter({ hasText: `${name} edited` })).toContainText("Inactive");
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
      ["/tags", "New Tag"],
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
      await expect(dialog.getByRole("button", { name: /Save|Create/ })).toBeInViewport();
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
