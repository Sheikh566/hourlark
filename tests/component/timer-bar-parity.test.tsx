import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunningDuration } from "@/web/features/timer/running-time-popover";
import { TimerCalendar } from "@/web/features/timer/timer-calendar";
import {
  formatTitleElapsed,
  timerDocumentTitle,
  useTimerDocumentTitle,
} from "@/web/features/timer/timer-document-title";
import {
  formatClock12,
  localFields,
  localInstant,
  parseClockInput,
} from "@/web/features/timer/timer-time-fields";
import type { TimeEntry } from "@/web/types";

afterEach(cleanup);

describe("timer bar clock fields", () => {
  it.each([
    ["9", "09:00"],
    ["930", "09:30"],
    ["503p", "17:03"],
    ["12:00 am", "00:00"],
    ["12pm", "12:00"],
    ["17:05", "17:05"],
    ["9:60", null],
    ["24:00", null],
    ["13pm", null],
    ["9m", null],
    ["", null],
  ])("parses %s as %s", (input, expected) => {
    expect(parseClockInput(input)).toBe(expected);
  });

  it("formats noon and midnight and preserves member-local dates", () => {
    expect(formatClock12("00:05")).toBe("12:05 AM");
    expect(formatClock12("12:05")).toBe("12:05 PM");
    const instant = localInstant("2026-10-18", "00:30", "Asia/Karachi");
    expect(new Date(instant).toISOString()).toBe("2026-10-17T19:30:00.000Z");
    expect(localFields(instant, "Asia/Karachi")).toEqual({ date: "2026-10-18", time: "00:30" });
  });
});

describe("timer document title", () => {
  it("formats elapsed boundaries and drops empty metadata", () => {
    expect(formatTitleElapsed(-1000)).toBe("0 sec");
    expect(formatTitleElapsed(59_000)).toBe("59 sec");
    expect(formatTitleElapsed(60_000)).toBe("01:00 min");
    expect(formatTitleElapsed(3_723_000)).toBe("1:02:03 h");
    expect(timerDocumentTitle(12_000, " Review ", "Project", "Hourlark")).toBe(
      "12 sec - Review - Project • Hourlark",
    );
    expect(timerDocumentTitle(12_000, " ", null, "Hourlark")).toBe("12 sec • Hourlark");
  });

  it("updates on ticks and restores the original title after stop and unmount", () => {
    document.title = "Hourlark";
    const running = { startedAt: 0, description: "Review", projectName: null };
    const view = renderHook(({ timer, now }) => useTimerDocumentTitle(timer, now), {
      initialProps: { timer: running as typeof running | null, now: 12_000 },
    });
    expect(document.title).toBe("12 sec - Review • Hourlark");
    view.rerender({ timer: running, now: 13_000 });
    expect(document.title).toBe("13 sec - Review • Hourlark");
    view.rerender({ timer: null, now: 13_000 });
    expect(document.title).toBe("Hourlark");
    view.rerender({ timer: running, now: 14_000 });
    view.unmount();
    expect(document.title).toBe("Hourlark");
  });
});

it("navigates year boundaries and disables future calendar dates", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(
    <TimerCalendar
      value="2026-01-01"
      today="2026-01-10"
      weekStartsOn={1}
      disableFuture
      onSelect={onSelect}
    />,
  );
  expect(screen.getByRole("button", { name: "Choose Sunday, January 11, 2026" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Previous month" }));
  expect(screen.getByText("December 2025")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Choose Wednesday, December 31, 2025" }));
  expect(onSelect).toHaveBeenCalledWith("2025-12-31");
  await user.click(screen.getByRole("button", { name: "Next month" }));
  expect(screen.getByText("January 2026")).toBeVisible();
});

it("prevents a calendar click from reverting a pending running-time edit", async () => {
  const user = userEvent.setup();
  let complete!: () => void;
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const entry = { started_at: "2026-01-10T09:00:00.000Z" } as TimeEntry;
  render(
    <RunningDuration
      entry={entry}
      duration="1:00:00"
      now={Date.parse("2026-01-10T10:00:00Z")}
      timezone="UTC"
      weekStartsOn={1}
      onChangeStart={save}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Running time/ }));
  const start = screen.getByLabelText("Start time");
  await user.click(start);
  fireEvent.change(start, { target: { value: "08:30" } });
  await user.click(screen.getByRole("button", { name: "Choose Friday, January 9, 2026" }));
  expect(save).toHaveBeenCalledExactlyOnceWith("2026-01-10T08:30:00.000Z");
  expect(screen.getByRole("button", { name: "Choose Friday, January 9, 2026" })).toBeDisabled();
  await act(async () => {
    complete();
    await Promise.resolve();
  });
  expect(screen.getByRole("button", { name: "Choose Friday, January 9, 2026" })).toBeEnabled();
});
