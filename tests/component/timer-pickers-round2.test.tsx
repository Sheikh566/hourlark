import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { projectPickerTextColor, projectTextColor } from "@/web/features/timer/project-tint";
import { ProjectPicker, TagPicker } from "@/web/features/timer/timer-pickers";
import type { Tag } from "@/web/types";

afterEach(cleanup);

it("moves the sole active project row with the pointer and continues keyboard navigation", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <ProjectPicker
      projects={["Alpha", "Beta", "Gamma"].map((name) => ({
        id: name,
        name,
        client_name: "",
        color: "#0b83d9",
        billable_default: false,
      }))}
      value="Alpha"
      disabled={false}
      canCreate={false}
      onChange={onChange}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Project: Alpha" }));
  const alpha = screen.getByRole("button", { name: "Alpha" });
  const beta = screen.getByRole("button", { name: "Beta" });
  const gamma = screen.getByRole("button", { name: "Gamma" });
  expect(alpha).toHaveClass("bg-surface-hover");
  fireEvent.pointerEnter(beta);
  expect(beta).toHaveFocus();
  expect(beta).toHaveClass("bg-surface-hover");
  expect(alpha).not.toHaveClass("bg-surface-hover");
  expect(alpha).toHaveAttribute("aria-current", "true");
  await user.keyboard("{ArrowDown}");
  expect(gamma).toHaveFocus();
  expect(gamma).toHaveClass("bg-surface-hover");
  expect(beta).not.toHaveClass("bg-surface-hover");
  fireEvent.pointerMove(beta);
  expect(beta).toHaveFocus();
  expect(gamma).not.toHaveClass("bg-surface-hover");
  await user.keyboard("{ArrowUp}");
  expect(alpha).toHaveFocus();
  expect(beta).not.toHaveClass("bg-surface-hover");
  await user.keyboard("{ArrowDown}{Enter}");
  expect(onChange).toHaveBeenCalledExactlyOnceWith("Beta");
  expect(screen.queryByRole("textbox", { name: "Search projects or clients" })).toBeNull();
});

it("uses the captured chip and picker palette rather than a shared lightness formula", () => {
  const palette = [
    ["#0b83d9", "#31a9ff", null],
    ["#9e5bd9", "#c481ff", "#c48bf6"],
    ["#d94182", "#ff67a8", "#f675ac"],
    ["#e36a00", "#ff861c", "#f99136"],
    ["#bf7000", "#f6aa3e", null],
    ["#2da608", "#7dee5b", "#87e769"],
    ["#06a893", "#57efdb", null],
    ["#c9806b", "#fab29e", "#f2b5a3"],
    ["#465bb3", "#8b9ff2", "#93a3eb"],
    ["#990099", "#ea5dea", "#e46be4"],
    ["#c7af14", "#f9e24a", null],
    ["#566614", "#cbd993", null],
    ["#d92b2b", "#ff5151", "#f66363"],
    ["#525266", "#c8c8d9", "#c6c6d5"],
    ["#991102", "#ea6d5f", "#e4796d"],
  ] as const;
  for (const [stored, chip, picker] of palette) {
    expect(projectTextColor(stored.toUpperCase())).toBe(chip);
    expect(projectPickerTextColor(stored)).toBe(picker ?? chip);
  }
});

const tags: Tag[] = [
  { id: "a", name: "Alpha", color: "#f00", status: "active" },
  { id: "z", name: "Zebra", color: "#0f0", status: "active" },
  { id: "b", name: "Beta", color: "#00f", status: "active" },
];

function Picker({
  canCreate = true,
  onCreate = vi.fn(),
}: {
  canCreate?: boolean;
  onCreate?: (name: string) => Promise<Tag>;
}) {
  const [selected, setSelected] = useState(["z"]);
  return (
    <TagPicker
      tags={tags}
      value={selected}
      onChange={setSelected}
      disabled={false}
      canCreate={canCreate}
      onCreate={onCreate}
    />
  );
}

it("puts checked tags first and uses the selected trigger without a count badge", async () => {
  const user = userEvent.setup();
  render(<Picker />);
  const trigger = screen.getByRole("button", { name: "1 timer tags selected" });
  expect(trigger).toHaveClass("timer-tool-active");
  expect(trigger).not.toHaveTextContent("1");
  await user.click(trigger);
  expect(screen.getAllByRole("checkbox").map((box) => box.closest("label")?.textContent)).toEqual([
    "Zebra",
    "Alpha",
    "Beta",
  ]);
  await user.click(screen.getByRole("checkbox", { name: "Beta" }));
  expect(screen.getAllByRole("checkbox").map((box) => box.closest("label")?.textContent)).toEqual([
    "Beta",
    "Zebra",
    "Alpha",
  ]);
});

it("shows the captured no-match copy and creates the quoted tag with Ctrl+Enter", async () => {
  const user = userEvent.setup();
  const onCreate = vi
    .fn()
    .mockResolvedValue({ id: "new", name: "HLTEST new", color: "#999", status: "active" });
  render(<Picker onCreate={onCreate} />);
  await user.click(screen.getByRole("button", { name: "1 timer tags selected" }));
  expect(screen.getByRole("button", { name: "Create tag" })).toBeDisabled();
  await user.type(screen.getByRole("textbox", { name: "Search timer tags" }), "HLTEST new");
  expect(screen.getByText("No matching tags")).toBeVisible();
  expect(screen.getByText(/Try a different keyword or press/)).toHaveTextContent(
    "Try a different keyword or press Ctrl+Enter to create a new tag.",
  );
  expect(screen.getByRole("button", { name: 'Create "HLTEST new" tag' })).toBeEnabled();
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(onCreate).toHaveBeenCalledExactlyOnceWith("HLTEST new");
});

it("does not create a tag through the shortcut when the member cannot manage tags", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn();
  render(<Picker canCreate={false} onCreate={onCreate} />);
  await user.click(screen.getByRole("button", { name: "1 timer tags selected" }));
  await user.type(screen.getByRole("textbox", { name: "Search timer tags" }), "HLTEST new");
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(onCreate).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /Create/ })).not.toBeInTheDocument();
});

it("groups projects by client without repeating the client on selectable rows", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <ProjectPicker
      projects={[
        {
          id: "project-a",
          name: "Delivery",
          client_name: "HLTEST client",
          color: "#0b83d9",
          billable_default: false,
        },
        {
          id: "project-b",
          name: "Operations",
          client_name: "Another client",
          color: "#0b83d9",
          billable_default: false,
        },
      ]}
      value=""
      disabled={false}
      canCreate={false}
      onChange={onChange}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Choose project" }));
  await user.type(
    screen.getByRole("textbox", { name: "Search projects or clients" }),
    "HLTEST client",
  );
  expect(screen.getByRole("heading", { name: "HLTEST client" })).toBeVisible();
  const row = screen.getByRole("button", { name: "Delivery" });
  expect(within(row).queryByText("HLTEST client")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Operations" })).not.toBeInTheDocument();
  await user.click(row);
  expect(onChange).toHaveBeenCalledExactlyOnceWith("project-a");
  expect(screen.getByRole("button", { name: "Choose project" })).toHaveFocus();
});
