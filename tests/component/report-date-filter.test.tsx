import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReportDateFilter } from "@/web/features/reports/report-date-filter";

function Harness({
  today = "2024-10-10",
  weekStartsOn = 1,
  initial = { start: "2024-10-07", end: "2024-10-13" },
  changed = vi.fn(),
}: {
  today?: string;
  weekStartsOn?: 0 | 1;
  initial?: { start: string; end: string };
  changed?: (range: { start: string; end: string }) => void;
}) {
  const [range, setRange] = useState(initial);
  return (
    <ReportDateFilter
      {...range}
      today={today}
      weekStartsOn={weekStartsOn}
      onChange={(next) => {
        changed(next);
        setRange(next);
      }}
    />
  );
}
async function open() {
  await userEvent.click(screen.getByRole("button", { name: "Report date range" }));
}

describe("ReportDateFilter", () => {
  afterEach(cleanup);
  it("uses workspace week boundaries and shifts inclusive periods across DST", async () => {
    const changed = vi.fn();
    render(
      <Harness
        today="2024-03-10"
        initial={{ start: "2024-03-04", end: "2024-03-10" }}
        changed={changed}
      />,
    );
    expect(screen.getByRole("button", { name: "Report date range" })).toHaveTextContent(
      "This week W10",
    );
    await userEvent.click(screen.getByRole("button", { name: "Next report period" }));
    expect(changed).toHaveBeenLastCalledWith({ start: "2024-03-11", end: "2024-03-17" });
    await open();
    await userEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(changed).toHaveBeenLastCalledWith({ start: "2024-03-04", end: "2024-03-10" });
  });

  it.each([0, 1] as const)(
    "selects an ISO week from a calendar starting on %s and closes the popup",
    async (weekStartsOn) => {
      const changed = vi.fn();
      render(
        <Harness
          today="2026-10-18"
          weekStartsOn={weekStartsOn}
          initial={{ start: "2026-10-01", end: "2026-10-31" }}
          changed={changed}
        />,
      );
      const user = userEvent.setup();
      await open();
      await user.click(screen.getByRole("button", { name: "Select week W42" }));
      expect(changed).toHaveBeenLastCalledWith({ start: "2026-10-12", end: "2026-10-18" });
      expect(screen.queryByRole("dialog", { name: "Choose report dates" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Report date range" })).toHaveTextContent(
        "12 - 18 Oct 2026 · W42",
      );
      expect(screen.getByRole("button", { name: "Report date range" })).toHaveFocus();
      await open();
      await user.click(screen.getByRole("button", { name: "This week" }));
      expect(screen.getByRole("button", { name: "Report date range" })).toHaveTextContent(
        "This week",
      );
    },
  );

  it("searches extended shortcuts, applies calendar quarter and rolling bounds", async () => {
    const changed = vi.fn();
    render(<Harness changed={changed} />);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "This quarter" }));
    expect(changed).toHaveBeenLastCalledWith({ start: "2024-10-01", end: "2024-12-31" });
    await open();
    await userEvent.click(screen.getByRole("button", { name: "All shortcuts" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search date shortcuts" }), "90");
    await userEvent.click(screen.getByRole("button", { name: "Last 90 days" }));
    expect(changed).toHaveBeenLastCalledWith({ start: "2024-07-13", end: "2024-10-10" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("selects two custom dates immediately, preserves the popup, and restores focus on Escape", async () => {
    const changed = vi.fn();
    render(<Harness changed={changed} />);
    await open();
    await userEvent.click(screen.getByRole("button", { name: "10 October 2024" }));
    expect(screen.getByRole("textbox", { name: "Range end date" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "15 October 2024" }));
    expect(changed).toHaveBeenLastCalledWith({ start: "2024-10-10", end: "2024-10-15" });
    expect(screen.getByRole("dialog", { name: "Choose report dates" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Report date range" })).toHaveFocus();
  });

  it("rejects invalid/reversed typed dates and commits valid drafts together", async () => {
    const changed = vi.fn();
    render(<Harness changed={changed} />);
    await open();
    const start = screen.getByRole("textbox", { name: "Range start date" });
    const end = screen.getByRole("textbox", { name: "Range end date" });
    fireEvent.change(start, { target: { value: "31/02/2024" } });
    fireEvent.keyDown(start, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("valid date");
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(start, { target: { value: "01/11/2024" } });
    fireEvent.keyDown(start, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("on or before");
    fireEvent.change(end, { target: { value: "03/11/2024" } });
    fireEvent.keyDown(end, { key: "Enter" });
    expect(changed).toHaveBeenLastCalledWith({ start: "2024-11-01", end: "2024-11-03" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clamps leap dates on year change and closes nested menus before the popup", async () => {
    const changed = vi.fn();
    render(
      <Harness
        today="2024-02-29"
        initial={{ start: "2024-02-29", end: "2024-03-01" }}
        changed={changed}
      />,
    );
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Choose start calendar year" }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Calendar year" })).getByRole("button", {
        name: "2023",
      }),
    );
    expect(changed).toHaveBeenLastCalledWith({ start: "2023-02-28", end: "2023-03-01" });
    await userEvent.click(screen.getByRole("button", { name: "All shortcuts" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "All date shortcuts" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All shortcuts" })).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Choose report dates" })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Choose report dates" })).not.toBeInTheDocument();
  });

  it("shows three-letter weekdays and omits the first week number when it starts outside the month", async () => {
    render(<Harness />);
    await open();
    expect(screen.getAllByText("Mon")).toHaveLength(2);
    expect(screen.queryByText("W40")).not.toBeInTheDocument();
    expect(screen.getByText("W41")).toBeVisible();
  });

  it("uses Sunday as the start when configured and spans leap month correctly", async () => {
    const changed = vi.fn();
    render(
      <Harness
        today="2024-02-29"
        weekStartsOn={0}
        initial={{ start: "2024-02-01", end: "2024-02-29" }}
        changed={changed}
      />,
    );
    await open();
    await userEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(changed).toHaveBeenLastCalledWith({ start: "2024-02-25", end: "2024-03-02" });
  });
});
