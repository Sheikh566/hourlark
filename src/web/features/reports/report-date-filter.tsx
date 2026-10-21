import { getISOWeek } from "date-fns";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useId, useRef, useState } from "react";

import {
  addCalendarDays,
  inclusiveDayCount,
  monthCalendarDays,
  parseYearMonth,
  shiftYearMonth,
  startOfWeekDate,
  yearMonthKey,
} from "@/web/features/timer/list-date-range";
import {
  useDismissPopover,
  useEscapeToClose,
  useRestoreFocus,
} from "@/web/features/timer/use-dismiss-popover";

type Range = { start: string; end: string };
type Props = Range & {
  today: string;
  weekStartsOn: 0 | 1;
  onChange: (range: Range) => void;
};
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const SHORTCUTS = [
  "Today",
  "This week",
  "This month",
  "This quarter",
  "This year",
  "Last week",
  "Last month",
];
const ALL_SHORTCUTS = [
  ...SHORTCUTS,
  "Yesterday",
  "This semester",
  "Last quarter",
  "Last semester",
  "Last year",
  "Last 2 weeks",
  "Last 30 days",
  "Last 90 days",
  "Last 12 mths",
  "Week to today",
  "Month to today",
  "Quarter to today",
  "Semester to today",
  "Year to today",
];
const iconButton =
  "text-fg-subtle hover:text-[#d5d5d5] grid size-9 shrink-0 place-items-center rounded-lg shadow-[inset_0_0_0_1px_var(--color-stroke-tertiary)] hover:bg-surface-hover";

function monthRange(today: string, months: number, previous = false): Range {
  const { year, month } = parseYearMonth(today);
  const first = Math.floor((month - 1) / months) * months + 1;
  const from = shiftYearMonth(year, first, previous ? -months : 0);
  const after = shiftYearMonth(from.year, from.month, months);
  return {
    start: `${yearMonthKey(from.year, from.month)}-01`,
    end: addCalendarDays(`${yearMonthKey(after.year, after.month)}-01`, -1),
  };
}
function presetRange(label: string, today: string, weekStartsOn: 0 | 1): Range {
  if (label === "Today" || label === "Yesterday") {
    const date = addCalendarDays(today, label === "Yesterday" ? -1 : 0);
    return { start: date, end: date };
  }
  if (label.includes("week") || label === "Week to today") {
    if (label === "Last 2 weeks") return { start: addCalendarDays(today, -13), end: today };
    const start = addCalendarDays(
      startOfWeekDate(today, weekStartsOn),
      label === "Last week" ? -7 : 0,
    );
    return { start, end: label === "Week to today" ? today : addCalendarDays(start, 6) };
  }
  if (label === "Last 30 days" || label === "Last 90 days")
    return { start: addCalendarDays(today, label === "Last 30 days" ? -29 : -89), end: today };
  if (label === "Last 12 mths") {
    const { year, month } = parseYearMonth(today);
    const previous = shiftYearMonth(year, month, -12);
    return { start: addCalendarDays(clampYear(today, previous.year), 1), end: today };
  }
  const months = /quarter/i.test(label)
    ? 3
    : /semester/i.test(label)
      ? 6
      : /year/i.test(label)
        ? 12
        : 1;
  const range = monthRange(today, months, label.startsWith("Last"));
  return label.endsWith("to today") ? { ...range, end: today } : range;
}
function clampYear(date: string, year: number): string {
  const month = Number(date.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${date.slice(5, 7)}-${String(Math.min(Number(date.slice(8)), lastDay)).padStart(2, "0")}`;
}
function inputDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}
function parseInput(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match || Number(match[3]) < 1000) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}
function week(date: string): number {
  return getISOWeek(new Date(`${date}T12:00:00`));
}
function rangeLabel(start: string, end: string): string {
  const a = `${Number(start.slice(8))}`;
  const b = `${Number(end.slice(8))} ${MONTHS[Number(end.slice(5, 7)) - 1]?.slice(0, 3)} ${end.slice(0, 4)}`;
  if (start === end) return b;
  return start.slice(0, 7) === end.slice(0, 7)
    ? `${a} - ${b}`
    : `${a} ${MONTHS[Number(start.slice(5, 7)) - 1]?.slice(0, 3)}${start.slice(0, 4) !== end.slice(0, 4) ? ` ${start.slice(0, 4)}` : ""} - ${b}`;
}

/** Lower-case period name for card titles: "this month", or "01/10/2026 - 31/10/2026". */
export function describeRange(
  start: string,
  end: string,
  today: string,
  weekStartsOn: 0 | 1,
): string {
  const preset = ALL_SHORTCUTS.find((label) => {
    const range = presetRange(label, today, weekStartsOn);
    return range.start === start && range.end === end;
  });
  return preset ? preset.toLowerCase() : `${inputDate(start)} - ${inputDate(end)}`;
}

export function ReportDateFilter({ start, end, today, weekStartsOn, onChange }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const startInput = useRef<HTMLInputElement>(null);
  const endInput = useRef<HTMLInputElement>(null);
  const shortcutTrigger = useRef<HTMLButtonElement>(null);
  const yearTrigger = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState("");
  const [popupLeft, setPopupLeft] = useState(0);
  const [restore, setRestore] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [yearOpen, setYearOpen] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(() => parseYearMonth(start));
  const [field, setField] = useState<"start" | "end">("start");
  const [draft, setDraft] = useState({ start: inputDate(start), end: inputDate(end) });
  const [error, setError] = useState<string | null>(null);
  const close = (focus: boolean) => {
    setOpen(false);
    setAllOpen(false);
    setYearOpen(null);
    setRestore(focus);
  };
  useDismissPopover(root, () => close(false), undefined, open);
  useEscapeToClose(open, () => {
    if (yearOpen !== null) {
      setYearOpen(null);
      yearTrigger.current?.focus();
    } else if (allOpen) {
      setAllOpen(false);
      shortcutTrigger.current?.focus();
    } else close(true);
  });
  useRestoreFocus(open, trigger, restore, () => setRestore(false));
  const apply = (next: Range) => {
    setSelectedWeek("");
    const sorted = next.start <= next.end ? next : { start: next.end, end: next.start };
    setDraft({ start: inputDate(sorted.start), end: inputDate(sorted.end) });
    setError(null);
    onChange(sorted);
  };
  const commitInput = (key: "start" | "end") => {
    if (draft[key] === inputDate(key === "start" ? start : end)) return;
    const from = parseInput(draft.start);
    const to = parseInput(draft.end);
    if (!from || !to) {
      setError("Enter a valid date in dd/MM/yyyy format.");
      return;
    }
    const next = { start: from, end: to };
    if (next.start > next.end) {
      setError("Start date must be on or before end date.");
      return;
    }
    apply(next);
    setVisible(parseYearMonth(next[key]));
  };
  const selectDay = (date: string) => {
    if (field === "start") {
      apply({ start: date, end: date > end ? date : end });
      setField("end");
      endInput.current?.focus();
    } else {
      apply({ start, end: date });
      setField("start");
      startInput.current?.focus();
    }
  };
  const active = ALL_SHORTCUTS.find((label) => {
    const range = presetRange(label, today, weekStartsOn);
    return range.start === start && range.end === end;
  });
  const isSelectedWeek = selectedWeek === start && end === addCalendarDays(start, 6);
  const label = isSelectedWeek ? rangeLabel(start, end) : (active ?? rangeLabel(start, end));
  const selectWeek = (rowStart: string) => {
    const monday = startOfWeekDate(addCalendarDays(rowStart, weekStartsOn === 0 ? 1 : 0), 1);
    apply({ start: monday, end: addCalendarDays(monday, 6) });
    setSelectedWeek(monday);
    close(true);
  };
  const choosePreset = (shortcut: string) => {
    apply(presetRange(shortcut, today, weekStartsOn));
    close(true);
  };

  return (
    <div ref={root} className="text-fg relative w-[322px] max-w-full shrink-0">
      <div className="flex h-9 items-center">
        <button
          type="button"
          aria-label="Previous report period"
          className="border-stroke-tertiary text-fg-subtle hover:bg-surface-hover bg-surface grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-l-lg border-y border-l"
          onClick={() => {
            const days = inclusiveDayCount(start, end);
            apply({ start: addCalendarDays(start, -days), end: addCalendarDays(end, -days) });
          }}
        >
          <ChevronLeft size={14} />
        </button>
        {open ? (
          <div className="bg-surface-hover border-stroke-tertiary flex h-9 min-w-0 flex-1 items-center justify-center gap-1 border-y text-xs">
            <CalendarDays size={14} className="shrink-0" />
            {(["start", "end"] as const).map((key, index) => (
              <span key={key} className="flex items-center gap-1">
                {index === 1 && <span>-</span>}
                <input
                  ref={key === "start" ? startInput : endInput}
                  aria-label={`Range ${key} date`}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${id}-error` : undefined}
                  className={`w-[88px] rounded border bg-transparent px-1 py-1 outline-none ${field === key ? "border-accent-fg" : "border-transparent"}`}
                  value={draft[key]}
                  onFocus={() => setField(key)}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                  onBlur={() => commitInput(key)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitInput(key);
                    }
                  }}
                />
              </span>
            ))}
          </div>
        ) : (
          <button
            ref={trigger}
            aria-label="Report date range"
            type="button"
            className="bg-surface hover:bg-surface-hover border-stroke-tertiary flex h-9 min-w-0 flex-1 items-center justify-center gap-2 border-y text-sm leading-[normal] font-medium"
            aria-expanded={open}
            aria-controls={`${id}-popup`}
            onClick={(event) => {
              setDraft({ start: inputDate(start), end: inputDate(end) });
              setVisible(parseYearMonth(start));
              setField("start");
              setError(null);
              const left = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
              const width = Math.min(917, window.innerWidth - 32);
              setPopupLeft(Math.max(16, Math.min(left, window.innerWidth - width - 16)) - left);
              setOpen(true);
            }}
          >
            <CalendarDays size={14} className="shrink-0" />
            <span className="min-w-0">{label}</span>
            {isSelectedWeek || active === "This week" || active === "Last week" ? (
              // Toggl renders the week number as its own text run beside the label; a custom week
              // selection is separated with a middot (capture answer).
              <span className="text-fg-subtle">
                {isSelectedWeek ? " · " : " "}
                {`W${week(start)}`}
              </span>
            ) : null}
          </button>
        )}
        <button
          type="button"
          aria-label="Next report period"
          className="border-stroke-tertiary text-fg-subtle hover:bg-surface-hover bg-surface grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-r-lg border-y border-r"
          onClick={() => {
            const days = inclusiveDayCount(start, end);
            apply({ start: addCalendarDays(start, days), end: addCalendarDays(end, days) });
          }}
        >
          <ChevronRight size={14} />
        </button>
      </div>
      {open && (
        <div
          id={`${id}-popup`}
          role="dialog"
          aria-label="Choose report dates"
          style={{ left: popupLeft }}
          className="bg-surface border-stroke shadow-popover-sm absolute top-11 z-50 flex max-h-[75vh] w-[min(917px,calc(100vw-32px))] flex-col overflow-auto rounded-lg border md:min-h-[342px] md:flex-row"
        >
          <div className="border-stroke relative shrink-0 border-b p-3 md:w-[250px] md:border-r md:border-b-0">
            <div className="grid justify-items-start gap-0.5 pr-1">
              {SHORTCUTS.map((shortcut) => (
                <div key={shortcut} className="flex h-8 w-full items-center justify-between">
                  <button
                    aria-label={shortcut}
                    type="button"
                    aria-pressed={active === shortcut}
                    className={`hover:bg-surface-hover flex h-8 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-start text-sm leading-5 font-semibold ${active === shortcut ? "bg-accent-muted text-accent-fg" : ""}`}
                    onClick={() => choosePreset(shortcut)}
                  >
                    <span>{shortcut}</span>
                  </button>
                  {shortcut === "This week" ? (
                    <span className="bg-surface-hover text-fg-subtle flex h-5 items-center justify-center rounded-lg px-[5px] py-px text-xs leading-3 font-medium">
                      Default
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="bg-stroke mt-4 mb-2 h-px" />
            <button
              ref={shortcutTrigger}
              type="button"
              aria-expanded={allOpen}
              className="hover:bg-surface-hover inline-flex h-8 w-fit items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-start text-sm leading-5 font-semibold"
              onClick={() => {
                setAllOpen(!allOpen);
                setYearOpen(null);
                setSearch("");
              }}
            >
              <span>All shortcuts</span> <ChevronRight width={6.3} height={10} />
            </button>
            {allOpen && (
              <div
                role="dialog"
                aria-label="All date shortcuts"
                className="border-stroke bg-surface shadow-popover-sm absolute top-0 left-0 z-20 w-[272px] max-w-full rounded-lg border md:left-full"
              >
                <label className="border-stroke flex items-center gap-2 border-b p-3">
                  <Search size={15} />
                  <input
                    autoFocus
                    aria-label="Search date shortcuts"
                    placeholder="Search shortcuts"
                    className="min-w-0 bg-transparent text-sm outline-none"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <div className="max-h-64 overflow-auto p-2">
                  {ALL_SHORTCUTS.filter((shortcut) =>
                    shortcut.toLowerCase().includes(search.toLowerCase()),
                  ).map((shortcut) => (
                    <button
                      type="button"
                      key={shortcut}
                      className="hover:bg-surface-hover block h-8 w-full rounded-lg px-3 text-left text-sm font-semibold"
                      onClick={() => choosePreset(shortcut)}
                    >
                      {shortcut}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col sm:flex-row md:pl-[9px]">
            {[0, 1].map((index) => {
              const month = shiftYearMonth(visible.year, visible.month, index);
              const days = monthCalendarDays(month.year, month.month, weekStartsOn);
              const prefix = yearMonthKey(month.year, month.month);
              const lastDay = `${prefix}-${new Date(Date.UTC(month.year, month.month, 0)).getUTCDate()}`;
              const rows = Math.ceil((days.indexOf(lastDay) + 1) / 7);
              return (
                <div
                  key={index}
                  className="min-w-0 shrink-0 px-[3px] pt-4 pb-[18px] sm:w-1/2 md:w-[328px]"
                >
                  <div className="relative mb-[19px] flex h-8 items-center justify-center">
                    {index === 0 ? (
                      <button
                        type="button"
                        className={`${iconButton} absolute -top-px left-2`}
                        aria-label="Previous month"
                        onClick={() => setVisible(shiftYearMonth(visible.year, visible.month, -1))}
                      >
                        <ChevronLeft size={14} className="h-3.5 w-3" />
                      </button>
                    ) : null}
                    <div className="flex items-center text-center text-xl leading-8 font-semibold">
                      <span>
                        <span>{MONTHS[month.month - 1]}</span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Choose ${index === 0 ? "start" : "end"} calendar year`}
                        aria-expanded={yearOpen === index}
                        className="bg-surface hover:bg-surface-hover ml-2 inline-flex h-8 w-[100px] items-center justify-between rounded-lg px-3 text-center text-sm leading-5 font-medium"
                        onClick={(event) => {
                          yearTrigger.current = event.currentTarget;
                          setYearOpen(yearOpen === index ? null : index);
                          setAllOpen(false);
                        }}
                      >
                        <span className="text-xl leading-8 font-semibold whitespace-nowrap">
                          {month.year}
                        </span>
                        <ChevronDown className="h-[9px] w-3.5" />
                      </button>
                    </div>
                    {index === 1 ? (
                      <button
                        type="button"
                        className={`${iconButton} absolute -top-px right-[18px]`}
                        aria-label="Next month"
                        onClick={() => setVisible(shiftYearMonth(visible.year, visible.month, 1))}
                      >
                        <ChevronRight size={14} className="h-3.5 w-3" />
                      </button>
                    ) : null}
                    {yearOpen === index && (
                      <div
                        role="dialog"
                        aria-label="Calendar year"
                        className="border-stroke bg-surface shadow-popover-sm absolute top-9 right-8 z-10 max-h-60 w-24 overflow-auto rounded border p-1"
                      >
                        {Array.from(
                          { length: 23 },
                          (_, i) => Number(today.slice(0, 4)) + 2 - i,
                        ).map((year) => (
                          <button
                            type="button"
                            key={year}
                            className="hover:bg-surface-hover block w-full rounded px-2 py-1.5 text-sm"
                            onClick={() => {
                              const target = shiftYearMonth(year, month.month, -index);
                              setVisible(target);
                              const next = {
                                start: clampYear(start, year),
                                end: clampYear(end, year),
                              };
                              apply(next);
                              setYearOpen(null);
                              yearTrigger.current?.focus();
                            }}
                          >
                            {year}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-control grid h-[15px] grid-cols-[46px_repeat(7,38px)] items-center text-center text-xs leading-3 font-medium">
                    <span />
                    {Array.from({ length: 7 }, (_, i) => (
                      <span key={i}>
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][(i + weekStartsOn) % 7]}
                      </span>
                    ))}
                  </div>
                  <div className="relative mt-3 grid auto-rows-[38px] grid-cols-[46px_repeat(7,38px)] content-start items-center text-center">
                    {Array.from({ length: rows }, (_, row) => (
                      <div key={row} className="contents">
                        {row > 0 ? (
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute right-2.5 left-[46px] h-px bg-[#4d4d4d]"
                            style={{ top: row * 38 + 0.5 }}
                          />
                        ) : null}
                        {days[row * 7]?.startsWith(prefix) ? (
                          <button
                            type="button"
                            aria-label={`Select week W${week(addCalendarDays(days[row * 7] ?? today, weekStartsOn === 0 ? 1 : 0))}`}
                            className="text-fg-subtle bg-surface-secondary border-control hover:bg-surface-hover grid h-[38px] w-[38px] place-items-center border-r text-xs leading-3 font-medium"
                            onClick={() => selectWeek(days[row * 7] ?? today)}
                          >
                            W
                            {week(
                              addCalendarDays(days[row * 7] ?? today, weekStartsOn === 0 ? 1 : 0),
                            )}
                          </button>
                        ) : (
                          <span />
                        )}
                        {days.slice(row * 7, row * 7 + 7).map((date) => {
                          if (!date.startsWith(prefix))
                            return <span key={date} className="h-[38px]" />;
                          const selected = date >= start && date <= end;
                          const endpoint = date === start || date === end;
                          return (
                            <button
                              type="button"
                              key={date}
                              aria-label={new Date(`${date}T12:00:00Z`).toLocaleDateString(
                                "en-GB",
                                { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" },
                              )}
                              aria-pressed={selected}
                              className={`grid h-[29px] w-[38px] place-items-center text-sm leading-[14px] focus-visible:z-10 ${date === start ? "font-semibold" : "font-medium"} ${endpoint ? `bg-accent-fg text-fg-inverted ${date === start ? "rounded-l-lg" : ""} ${date === end ? "rounded-r-lg" : ""}` : selected ? "bg-accent-muted-hover text-fg" : "hover:bg-surface-hover"}`}
                              onClick={() => selectDay(date)}
                            >
                              <span
                                className={`grid size-7 place-items-center rounded-full ${date === today && !selected ? "border-stroke-tertiary border" : ""}`}
                              >
                                {Number(date.slice(8))}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {error && (
            <p
              id={`${id}-error`}
              role="alert"
              className="text-error-fg absolute right-3 bottom-1 text-xs"
            >
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
