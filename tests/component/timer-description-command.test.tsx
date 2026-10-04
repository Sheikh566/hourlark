import { describe, expect, it } from "vitest";

import {
  findDescriptionCommand,
  matchesDescriptionCommand,
  removeDescriptionCommand,
} from "@/web/features/timer/description-command";

describe("timer description commands", () => {
  it("finds project and tag commands at the cursor", () => {
    expect(findDescriptionCommand("Review @in")).toEqual({
      kind: "project",
      marker: "@",
      query: "in",
      start: 7,
      end: 10,
    });
    expect(findDescriptionCommand("Review #r")).toEqual({
      kind: "tag",
      marker: "#",
      query: "r",
      start: 7,
      end: 9,
    });
    expect(findDescriptionCommand("Email dev@iomechs.com")).toBeNull();
  });

  it("removes a selected command without joining surrounding words", () => {
    const command = findDescriptionCommand("Review @internal");
    expect(command).not.toBeNull();
    if (!command) throw new Error("Expected a project command");
    expect(removeDescriptionCommand("Review @internal", command)).toEqual({
      description: "Review ",
      cursor: 7,
    });

    const middleCommand = findDescriptionCommand("Review @internal tomorrow", 16);
    expect(middleCommand).not.toBeNull();
    if (!middleCommand) throw new Error("Expected a project command before the cursor");
    expect(removeDescriptionCommand("Review @internal tomorrow", middleCommand)).toEqual({
      description: "Review tomorrow",
      cursor: 7,
    });
  });

  it("matches suggestions from the beginning of a name without case sensitivity", () => {
    expect(matchesDescriptionCommand("Internal Operations", "in")).toBe(true);
    expect(matchesDescriptionCommand("R&D", "r")).toBe(true);
    expect(matchesDescriptionCommand("Client Internal", "in")).toBe(false);
  });
});
