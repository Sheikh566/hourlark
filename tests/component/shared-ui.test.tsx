import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Checkbox } from "@/web/components/checkbox";
import { Select } from "@/web/components/select";
import { Switch } from "@/web/components/switch";
import { ToastProvider, useToast } from "@/web/components/toast";
import { Button, Field, Input, Modal, RowMenu, SearchInput, SortHeader } from "@/web/components/ui";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Modal", () => {
  it("focuses the first field instead of the close button and keeps Close reachable", async () => {
    render(
      <Modal open onOpenChange={() => undefined} title="New client" size="sm">
        <Field label="Client name">
          <Input />
        </Field>
      </Modal>,
    );
    const input = await screen.findByLabelText("Client name");
    expect(input).toHaveFocus();
    expect(screen.getByRole("dialog")).toHaveClass("w-[min(94vw,360px)]");
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeInTheDocument();
  });

  it("honours data-autofocus on a later field", async () => {
    render(
      <Modal open onOpenChange={() => undefined} title="New project">
        <Input aria-label="Client" />
        <Input aria-label="Project name" data-autofocus />
      </Modal>,
    );
    expect(await screen.findByLabelText("Project name")).toHaveFocus();
  });

  it("closes from the close button", async () => {
    const onOpenChange = vi.fn();
    render(
      <Modal open onOpenChange={onOpenChange} title="Edit">
        <p>Body</p>
      </Modal>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("RowMenu", () => {
  it("renders the menu in a portal so scroll containers cannot clip it", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <div data-testid="scroller" className="overflow-x-auto">
        <RowMenu label="Row actions" items={[{ label: "Archive", onSelect }]} />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Row actions" }));
    const menu = screen.getByRole("menu");
    expect(screen.getByTestId("scroller")).not.toContainElement(menu);
    expect(menu.parentElement).toBe(document.body);
    expect(menu).toHaveClass("fixed");
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger; disabled items stay inert", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<RowMenu label="Row actions" items={[{ label: "Delete", onSelect, disabled: true }]} />);
    const trigger = screen.getByRole("button", { name: "Row actions" });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onSelect).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("moves between enabled items with the arrow keys", async () => {
    const user = userEvent.setup();
    render(
      <RowMenu
        label="Row actions"
        items={[
          { label: "Edit", onSelect: () => undefined },
          { label: "Skip", onSelect: () => undefined, disabled: true },
          { label: "Delete", onSelect: () => undefined, danger: true },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Row actions" }));
    screen.getByRole("menuitem", { name: "Edit" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveClass("text-error-fg");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  });
});

describe("RowMenu keyboard", () => {
  it("focuses the first enabled item when opened with the keyboard", async () => {
    const user = userEvent.setup();
    render(<RowMenu label="Row actions" items={[{ label: "Edit", onSelect: () => undefined }]} />);
    screen.getByRole("button", { name: "Row actions" }).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menuitem", { name: "Edit" })).toHaveFocus();
  });
});

describe("Checkbox", () => {
  it("is a styled native checkbox that toggles and supports indeterminate", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Checkbox aria-label="Select all" indeterminate />);
    const box = screen.getByRole("checkbox", { name: "Select all" });
    expect(box).toHaveClass("hl-checkbox");
    expect((box as HTMLInputElement).indeterminate).toBe(true);
    rerender(<Checkbox aria-label="Select all" />);
    expect((box as HTMLInputElement).indeterminate).toBe(false);
    await user.click(box);
    expect(box).toBeChecked();
  });
});

describe("Switch", () => {
  it("reports its state through aria-checked and onCheckedChange", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [on, setOn] = useState(false);
      return <Switch checked={on} onCheckedChange={setOn} aria-label="Autosave" />;
    }
    render(<Harness />);
    const toggle = screen.getByRole("switch", { name: "Autosave" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});

describe("Toast", () => {
  function Trigger({ onUndo }: { onUndo?: () => void }) {
    const toast = useToast();
    return (
      <button
        type="button"
        onClick={() =>
          toast({
            title: "Success",
            message: "Tag created successfully",
            action: onUndo ? { label: "Undo", onSelect: onUndo } : undefined,
          })
        }
      >
        Fire
      </button>
    );
  }

  it("auto-dismisses after five seconds", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("Fire"));
    expect(screen.getByText("Tag created successfully")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(4900));
    expect(screen.getByText("Tag created successfully")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByText("Tag created successfully")).not.toBeInTheDocument();
  });

  it("stays while hovered and runs its action once", () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("Fire"));
    const card = screen.getByText("Tag created successfully").closest("div[class*='w-80']");
    expect(card).not.toBeNull();
    fireEvent.mouseEnter(card as Element);
    act(() => void vi.advanceTimersByTime(20_000));
    expect(screen.getByText("Tag created successfully")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(screen.queryByText("Tag created successfully")).not.toBeInTheDocument();
  });

  it("is a no-op without a provider", () => {
    render(<Trigger />);
    fireEvent.click(screen.getByText("Fire"));
    expect(screen.queryByText("Tag created successfully")).not.toBeInTheDocument();
  });
});

describe("Select", () => {
  it("shows a muted label prefix before the value", () => {
    render(
      <Select
        value="projects"
        onValueChange={() => undefined}
        labelPrefix="Breakdown by:"
        options={[{ value: "projects", label: "Projects" }]}
        aria-label="Breakdown"
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Breakdown" });
    expect(trigger).toHaveTextContent("Breakdown by:Projects");
    expect(trigger).toHaveClass("h-[38px]");
  });

  it("uses the neutral selected tone unless accent is requested", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <Select
        value="a"
        onValueChange={() => undefined}
        options={[{ value: "a", label: "Alpha" }]}
        aria-label="Pick"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Pick" }));
    expect(await screen.findByRole("option", { name: "Alpha" })).toHaveClass(
      "data-[state=checked]:bg-surface-hover",
    );
    unmount();
    render(
      <Select
        value="a"
        tone="accent"
        onValueChange={() => undefined}
        options={[{ value: "a", label: "Alpha" }]}
        aria-label="Pick"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Pick" }));
    expect(await screen.findByRole("option", { name: "Alpha" })).toHaveClass(
      "data-[state=checked]:bg-accent-muted",
    );
  });
});

describe("Button, SearchInput and SortHeader", () => {
  it("keeps every variant at 36px and pads icon buttons Toggl-style", () => {
    render(
      <>
        <Button variant="secondary">Cancel</Button>
        <Button variant="outline">New tag</Button>
        <Button icon={<svg data-testid="plus" />}>New project</Button>
      </>,
    );
    for (const name of ["Cancel", "New tag", "New project"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("h-9", "box-border");
    }
    expect(screen.getByRole("button", { name: "New project" })).toHaveClass("pr-4");
    expect(screen.getByTestId("plus").parentElement).toHaveClass("size-5");
  });

  it("clears the search with the inline clear button", async () => {
    const onChange = vi.fn();
    render(<SearchInput label="Search clients" value="acme" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Clear search clients" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("renders sort chevrons and fires onToggle", async () => {
    const onToggle = vi.fn();
    render(<SortHeader label="Project" direction="asc" onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: "Sort by project" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
