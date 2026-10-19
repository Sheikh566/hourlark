import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DateRangePopover, TimeEntryListCapWarning } from "@/web/features/timer/date-range-popover";
import { ALL_DATES_SELECTION, TIME_ENTRY_LIST_LIMIT } from "@/web/features/timer/list-date-range";

const now = new Date("2026-10-04T12:00:00.000Z");

describe("date range popover", () => {
  afterEach(() => {
    cleanup();
  });

  it("applies a custom inclusive calendar range and restores focus on Escape", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClose = vi.fn();
    const triggerRef = createRef<HTMLButtonElement>();

    render(
      <div>
        <button ref={triggerRef} type="button">
          All dates
        </button>
        <DateRangePopover
          open
          timezone="America/New_York"
          weekStartsOn={0}
          value={ALL_DATES_SELECTION}
          now={now}
          onChange={onChange}
          onClose={onClose}
          triggerRef={triggerRef}
        />
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "2026-10-01" }));
    await user.click(screen.getByRole("button", { name: "2026-10-04" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith({
      preset: "custom",
      startDate: "2026-10-01",
      endDate: "2026-10-04",
    });

    onClose.mockClear();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("applies an inclusive range on the second day click in instant mode", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClose = vi.fn();
    const triggerRef = createRef<HTMLButtonElement>();

    render(
      <div>
        <button ref={triggerRef} type="button">
          All dates
        </button>
        <DateRangePopover
          open
          mode="instant"
          timezone="America/New_York"
          weekStartsOn={1}
          value={ALL_DATES_SELECTION}
          now={now}
          onChange={onChange}
          onClose={onClose}
          triggerRef={triggerRef}
        />
      </div>,
    );

    // Instant mode drops the typed Start/End fields and the Apply button.
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Range start date")).not.toBeInTheDocument();
    // Toggl's week-number column and Monday-first weekday header.
    expect(screen.getByText("W40")).toBeVisible();
    expect(screen.getByText("W44")).toBeVisible();
    expect(screen.getByText("Mon")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "2026-10-08" }));
    expect(onChange).not.toHaveBeenCalled();
    // Clicking an earlier day second still yields an ordered inclusive range.
    await user.click(screen.getByRole("button", { name: "2026-10-06" }));
    expect(onChange).toHaveBeenCalledWith({
      preset: "custom",
      startDate: "2026-10-06",
      endDate: "2026-10-08",
    });
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("applies a preset from the left column and moves between months and years", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const triggerRef = createRef<HTMLButtonElement>();

    render(
      <div>
        <button ref={triggerRef} type="button">
          All dates
        </button>
        <DateRangePopover
          open
          mode="instant"
          timezone="America/New_York"
          weekStartsOn={0}
          value={ALL_DATES_SELECTION}
          now={now}
          onChange={onChange}
          onClose={vi.fn()}
          triggerRef={triggerRef}
        />
      </div>,
    );

    expect(screen.getByRole("button", { name: "All dates", pressed: true })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("November")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Year 2026" }));
    await user.click(screen.getByRole("option", { name: "2025" }));
    expect(screen.getByRole("button", { name: "Year 2025" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Last week" }));
    expect(onChange).toHaveBeenCalledWith({
      preset: "last_week",
      startDate: "2026-09-27",
      endDate: "2026-10-03",
    });
  });

  it("applies the whole inclusive week when its week number is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(
      <DateRangePopover
        open
        mode="instant"
        timezone="America/New_York"
        weekStartsOn={1}
        value={ALL_DATES_SELECTION}
        now={now}
        onChange={onChange}
        onClose={onClose}
        triggerRef={createRef<HTMLButtonElement>()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Select week W40" }));
    expect(onChange).toHaveBeenCalledWith({
      preset: "this_week",
      startDate: "2026-09-28",
      endDate: "2026-10-04",
    });
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("shows a cutoff warning instead of presenting capped results as complete", () => {
    const { rerender } = render(<TimeEntryListCapWarning entryCount={12} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(<TimeEntryListCapWarning entryCount={TIME_ENTRY_LIST_LIMIT} />);
    expect(screen.getByRole("status")).toHaveTextContent("incomplete");
    expect(screen.getByRole("status")).toHaveTextContent("5,000");
  });
});
