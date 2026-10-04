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

  it("applies presets and a custom inclusive range", async () => {
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
          timezone="Asia/Karachi"
          weekStartsOn={0}
          value={ALL_DATES_SELECTION}
          now={now}
          onChange={onChange}
          onClose={onClose}
          triggerRef={triggerRef}
        />
      </div>,
    );

    expect(screen.getByRole("dialog", { name: "Choose date range" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(onChange).toHaveBeenCalledWith({
      preset: "today",
      startDate: "2026-10-04",
      endDate: "2026-10-04",
    });
    expect(onClose).toHaveBeenCalledWith(true);
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

  it("shows a cutoff warning instead of presenting capped results as complete", () => {
    const { rerender } = render(<TimeEntryListCapWarning entryCount={12} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(<TimeEntryListCapWarning entryCount={TIME_ENTRY_LIST_LIMIT} />);
    expect(screen.getByRole("status")).toHaveTextContent("incomplete");
    expect(screen.getByRole("status")).toHaveTextContent("5,000");
  });
});
