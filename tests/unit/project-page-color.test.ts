import { describe, expect, it } from "vitest";

import { projectPageNameColor } from "@/web/features/manage/project-page-color";

describe("project page name colour", () => {
  it("uses Toggl's measured light variant for palette presets", () => {
    expect(projectPageNameColor("#0b83d9")).toBe("#31a9ff");
    expect(projectPageNameColor("#2da608")).toBe("#7dee5b");
    expect(projectPageNameColor("#991102")).toBe("#ea6d5f");
  });

  it("matches presets case-insensitively and trims input", () => {
    expect(projectPageNameColor("#0B83D9")).toBe("#31a9ff");
    expect(projectPageNameColor("  #990099 ")).toBe("#ea5dea");
  });

  it("falls back to an HSL lift for custom colours", () => {
    expect(projectPageNameColor("#ff6c6c")).toContain("hsl(from #ff6c6c");
  });

  it("falls back to a neutral when no colour is set", () => {
    expect(projectPageNameColor(null)).toBe("#b7b7b7");
    expect(projectPageNameColor(undefined)).toBe("#b7b7b7");
    expect(projectPageNameColor("")).toBe("#b7b7b7");
  });
});
