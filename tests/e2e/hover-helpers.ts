import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/** Exact computed-colour strings for the hover tokens in docs of the Toggl hover parity spec. */
export const COLOR = {
  surface: "rgb(27, 27, 27)", // #1b1b1b
  surfaceHover: "rgb(58, 58, 58)", // #3a3a3a
  surfaceHoverStrong: "rgb(77, 77, 77)", // #4d4d4d
  surfaceActive: "rgb(85, 85, 85)", // #555555
  fgHover: "rgb(213, 213, 213)", // #d5d5d5
  fgSoft: "rgb(206, 206, 206)", // #cecece
  fgStrongHover: "rgb(245, 245, 245)", // #f5f5f5
  fg: "rgb(250, 250, 250)", // #fafafa
  white: "rgb(255, 255, 255)", // #ffffff
  controlHover: "rgb(144, 144, 144)", // #909090
  hoverSoft: "rgba(250, 250, 250, 0.05)",
  hoverFaint: "rgba(250, 250, 250, 0.03)",
  transparent: "rgba(0, 0, 0, 0)",
} as const;

export type StyleProperty =
  "backgroundColor" | "color" | "boxShadow" | "opacity" | "cursor" | "borderColor";

/** Resolves once every CSS transition/animation running on the element has finished. */
export async function settle(locator: Locator) {
  await locator.page().evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await locator.evaluate(async (element) => {
    const running = element.getAnimations({ subtree: true });
    await Promise.all(running.map((animation) => animation.finished.catch(() => undefined)));
  });
}

/** Moves the real mouse over the element, then waits for hover transitions to finish. */
export async function hover(locator: Locator, options?: Parameters<Locator["hover"]>[0]) {
  await locator.hover(options);
  await settle(locator);
}

/** Moves the real mouse to a neutral spot (page corner) so nothing is hovered. */
export async function unhover(page: Page) {
  const viewport = page.viewportSize();
  await page.mouse.move((viewport?.width ?? 1280) - 2, (viewport?.height ?? 720) - 2);
}

export function style(locator: Locator, property: StyleProperty): Promise<string> {
  return locator.evaluate((element, name) => getComputedStyle(element)[name as "color"], property);
}

/**
 * The colour an icon is actually painted with: the first stroke, else fill, found on the svg's
 * shapes (or on the svg itself). Pass either the svg or any ancestor, e.g. its button.
 */
export function svgPaint(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    const svg = element instanceof SVGSVGElement ? element : element.querySelector("svg");
    if (!svg) throw new Error("No svg found inside the locator.");
    const shapes = [...svg.querySelectorAll("*"), svg];
    for (const shape of shapes) {
      const computed = getComputedStyle(shape);
      if (computed.stroke !== "none" && parseFloat(computed.strokeWidth) > 0) {
        return computed.stroke;
      }
      if (computed.fill !== "none") return computed.fill;
    }
    return getComputedStyle(svg).color;
  });
}

/** Polls a computed style until it equals the exact expected string (absorbs transitions). */
export async function expectStyle(
  locator: Locator,
  property: StyleProperty,
  expected: string,
  message?: string,
) {
  await expect
    .poll(() => style(locator, property), {
      message: message ?? `${property} of ${locator.toString()}`,
    })
    .toBe(expected);
}

export async function expectSvgPaint(locator: Locator, expected: string, message?: string) {
  await expect
    .poll(() => svgPaint(locator), { message: message ?? `icon paint of ${locator.toString()}` })
    .toBe(expected);
}

export async function expectBackground(locator: Locator, expected: string, message?: string) {
  await expectStyle(locator, "backgroundColor", expected, message);
}

export async function expectNoBackground(locator: Locator, message?: string) {
  await expectStyle(locator, "backgroundColor", COLOR.transparent, message);
}

const isClear = (value: string) =>
  value === "transparent" || /^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)$/.test(value);

/**
 * Asserts exactly one of the items carries a background highlight and that it is the hovered one.
 * `items` must match every option in the menu/listbox; `hovered` must be one of them.
 */
export async function expectSingleHighlight(
  items: Locator,
  hovered: Locator,
  expectedColor?: string,
) {
  const hoveredIndex = await items.evaluateAll(
    (nodes, target) => nodes.findIndex((node) => node === target),
    await hovered.elementHandle(),
  );
  expect(hoveredIndex, "hovered element must be one of the items").toBeGreaterThanOrEqual(0);
  await expect
    .poll(
      async () => {
        const backgrounds = await items.evaluateAll((nodes) =>
          nodes.map((node) => getComputedStyle(node).backgroundColor),
        );
        return backgrounds
          .map((background, index) => ({ background, index }))
          .filter(({ background }) => !isClear(background));
      },
      { message: "highlighted items" },
    )
    .toEqual([{ background: expectedColor ?? expect.any(String), index: hoveredIndex }]);
}

export interface HoverFixtures {
  clientName: string;
  projectName: string;
  secondProjectName: string;
  tagNames: string[];
  describedEntry: string;
  blankEntryProject: string;
  workspaceName: string;
}

/**
 * Creates the HLTEST data every hover test reads: a client with two projects, a few tags and two
 * entries (one with a description and tag, one with no description). Uses its own request context
 * so it can run in `beforeAll`.
 */
export async function seedHoverData(request: APIRequestContext): Promise<HoverFixtures> {
  const suffix = crypto.randomUUID().slice(0, 6);
  const me = (await (await request.get("/api/v1/me")).json()) as {
    csrf_token: string;
    workspace: { company_name?: string; app_name: string };
  };
  const base = process.env.HOURLARK_E2E_PORT ?? "5186";
  const headers = { Origin: `http://127.0.0.1:${base}`, "X-CSRF-Token": me.csrf_token };
  async function create<T>(path: string, data: unknown): Promise<T> {
    const response = await request.post(`/api/v1${path}`, { headers, data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return (await response.json()) as T;
  }

  const clientName = `HLTEST hover client ${suffix}`;
  const { client } = await create<{ client: { id: string } }>("/clients", {
    name: clientName,
    currency: "USD",
  });
  const projectName = `HLTEST hover alpha ${suffix}`;
  const secondProjectName = `HLTEST hover beta ${suffix}`;
  const projectIds: string[] = [];
  for (const [name, color] of [
    [projectName, "#0b83d9"],
    [secondProjectName, "#9e5bd9"],
  ] as const) {
    const { project } = await create<{ project: { id: string } }>("/projects", {
      client_id: client.id,
      name,
      color,
      billable_default: false,
      currency: "USD",
      visibility: "all",
    });
    projectIds.push(project.id);
  }
  const tagNames = [`HLTEST hover tag a ${suffix}`, `HLTEST hover tag b ${suffix}`];
  const tagIds: string[] = [];
  for (const name of tagNames) {
    const { tag } = await create<{ tag: { id: string } }>("/tags", { name, color: "#cd7fc2" });
    tagIds.push(tag.id);
  }
  const describedEntry = `HLTEST hover entry ${suffix}`;
  const hour = 3_600_000;
  await create("/time-entries", {
    description: describedEntry,
    project_id: null,
    started_at: new Date(Date.now() - hour).toISOString(),
    stopped_at: new Date(Date.now() - hour / 2).toISOString(),
    tag_ids: [tagIds[0]],
    billable: false,
  });
  await create("/time-entries", {
    description: "",
    project_id: projectIds[0],
    started_at: new Date(Date.now() - 2 * hour).toISOString(),
    stopped_at: new Date(Date.now() - 1.5 * hour).toISOString(),
    tag_ids: [],
    billable: false,
  });
  return {
    clientName,
    projectName,
    secondProjectName,
    tagNames,
    describedEntry,
    blankEntryProject: projectName,
    workspaceName: me.workspace.company_name || me.workspace.app_name,
  };
}
