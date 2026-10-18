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
  "grid h-7 w-7 shrink-0 place-items-center rounded border border-[#555] text-[#bdbdbd] hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-amber-400";

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

export function ReportDateFilter({ start, end, today, weekStartsOn, onChange }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const startInput = useRef<HTMLInputElement>(null);
  const endInput = useRef<HTMLInputElement>(null);
  const shortcutTrigger = useRef<HTMLButtonElement>(null);
  const yearTrigger = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
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
  const label =
    active === "This week" || active === "Last week"
      ? `${active} · W${week(start)}`
      : (active ?? rangeLabel(start, end));
  const choosePreset = (shortcut: string) => {
    apply(presetRange(shortcut, today, weekStartsOn));
    close(true);
  };

  return (
    <div ref={root} className="relative w-[322px] max-w-full shrink-0 text-[#fafafa]">
      <div className="flex h-9 items-center rounded-lg border border-[#808080]">
        <button
          type="button"
          aria-label="Previous report period"
          className="grid h-full w-8 shrink-0 place-items-center hover:bg-white/8"
          onClick={() => {
            const days = inclusiveDayCount(start, end);
            apply({ start: addCalendarDays(start, -days), end: addCalendarDays(end, -days) });
          }}
        >
          <ChevronLeft size={16} />
        </button>
        {open ? (
          <div className="flex min-w-0 flex-1 items-center justify-center gap-1 text-xs">
            <CalendarDays size={15} className="shrink-0 text-[#a4a4a4]" />
            {(["start", "end"] as const).map((key, index) => (
              <span key={key} className="flex items-center gap-1">
                {index === 1 && <span>-</span>}
                <input
                  ref={key === "start" ? startInput : endInput}
                  aria-label={`Range ${key} date`}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${id}-error` : undefined}
                  className={`w-[88px] rounded border bg-transparent px-1 py-1 outline-none ${field === key ? "border-amber-400" : "border-transparent"}`}
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
            className="flex h-full min-w-0 flex-1 items-center justify-center gap-2 text-sm hover:bg-white/5"
            aria-expanded={open}
            aria-controls={`${id}-popup`}
            onClick={(event) => {
              setDraft({ start: inputDate(start), end: inputDate(end) });
              setVisible(parseYearMonth(start));
              setField("start");
              setError(null);
              const left = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
              const width = Math.min(915, window.innerWidth - 32);
              setPopupLeft(Math.max(16, Math.min(left, window.innerWidth - width - 16)) - left);
              setOpen(true);
            }}
          >
            <CalendarDays size={16} className="text-[#a4a4a4]" />
            <span className="truncate">{label}</span>
          </button>
        )}
        <button
          type="button"
          aria-label="Next report period"
          className="grid h-full w-8 shrink-0 place-items-center hover:bg-white/8"
          onClick={() => {
            const days = inclusiveDayCount(start, end);
            apply({ start: addCalendarDays(start, days), end: addCalendarDays(end, days) });
          }}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      {open && (
        <div
          id={`${id}-popup`}
          role="dialog"
          aria-label="Choose report dates"
          style={{ left: popupLeft }}
          className="absolute top-11 z-50 flex max-h-[75vh] w-[min(915px,calc(100vw-32px))] flex-col overflow-auto rounded-lg border border-[#3a3a3a] bg-[#1b1b1b] shadow-2xl md:flex-row"
        >
          <div className="relative shrink-0 border-b border-[#3a3a3a] p-3 md:w-[250px] md:border-r md:border-b-0">
            {SHORTCUTS.map((shortcut) => (
              <button
                key={shortcut}
                aria-label={shortcut}
                type="button"
                aria-pressed={active === shortcut}
                className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-white/8 ${active === shortcut ? "text-amber-400" : ""}`}
                onClick={() => choosePreset(shortcut)}
              >
                {shortcut}
                {shortcut === "This week" && (
                  <span className="rounded bg-[#353535] px-2 text-[10px] text-[#aaa]">Default</span>
                )}
              </button>
            ))}
            <button
              ref={shortcutTrigger}
              type="button"
              aria-expanded={allOpen}
              className="mt-2 flex w-full items-center justify-between border-t border-[#3a3a3a] px-3 py-2 text-left text-sm"
              onClick={() => {
                setAllOpen(!allOpen);
                setYearOpen(null);
                setSearch("");
              }}
            >
              All shortcuts <ChevronRight size={14} />
            </button>
            {allOpen && (
              <div
                role="dialog"
                aria-label="All date shortcuts"
                className="absolute top-0 left-0 z-20 w-[272px] max-w-full rounded-lg border border-[#555] bg-[#292929] shadow-2xl md:left-full"
              >
                <label className="flex items-center gap-2 border-b border-[#555] p-3">
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
                      className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-white/8"
                      onClick={() => choosePreset(shortcut)}
                    >
                      {shortcut}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col sm:flex-row">
            {[0, 1].map((index) => {
              const month = shiftYearMonth(visible.year, visible.month, index);
              const days = monthCalendarDays(month.year, month.month, weekStartsOn);
              const prefix = yearMonthKey(month.year, month.month);
              const lastDay = `${prefix}-${new Date(Date.UTC(month.year, month.month, 0)).getUTCDate()}`;
              const rows = Math.ceil((days.indexOf(lastDay) + 1) / 7);
              return (
                <div key={index} className="min-w-0 flex-1 px-3 py-4">
                  <div className="relative mb-4 flex items-center justify-between gap-1">
                    {index === 0 ? (
                      <button
                        type="button"
                        className={iconButton}
                        aria-label="Previous month"
                        onClick={() => setVisible(shiftYearMonth(visible.year, visible.month, -1))}
                      >
                        <ChevronLeft size={16} />
                      </button>
                    ) : (
                      <span className="h-7 w-7" />
                    )}
                    <div className="flex items-center gap-1 text-xl">
                      <span>{MONTHS[month.month - 1]}</span>
                      <button
                        type="button"
                        aria-label={`Choose ${index === 0 ? "start" : "end"} calendar year`}
                        aria-expanded={yearOpen === index}
                        className="flex items-center gap-1 rounded px-1 hover:bg-white/8"
                        onClick={(event) => {
                          yearTrigger.current = event.currentTarget;
                          setYearOpen(yearOpen === index ? null : index);
                          setAllOpen(false);
                        }}
                      >
                        {month.year}
                        <ChevronDown size={13} />
                      </button>
                    </div>
                    {index === 1 ? (
                      <button
                        type="button"
                        className={iconButton}
                        aria-label="Next month"
                        onClick={() => setVisible(shiftYearMonth(visible.year, visible.month, 1))}
                      >
                        <ChevronRight size={16} />
                      </button>
                    ) : (
                      <span className="h-7 w-7" />
                    )}
                    {yearOpen === index && (
                      <div
                        role="dialog"
                        aria-label="Calendar year"
                        className="absolute top-9 right-8 z-10 max-h-60 w-24 overflow-auto rounded border border-[#555] bg-[#292929] p-1 shadow-xl"
                      >
                        {Array.from(
                          { length: 23 },
                          (_, i) => Number(today.slice(0, 4)) + 2 - i,
                        ).map((year) => (
                          <button
                            type="button"
                            key={year}
                            className="block w-full rounded px-2 py-1.5 text-sm hover:bg-white/8"
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
                  <div className="grid grid-cols-[28px_repeat(7,minmax(0,1fr))] text-center text-xs text-[#888]">
                    <span />
                    {Array.from({ length: 7 }, (_, i) => (
                      <span key={i}>
                        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][(i + weekStartsOn) % 7]}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 grid min-h-[212px] grid-cols-[28px_repeat(7,minmax(0,1fr))] content-start gap-y-1 text-center">
                    {Array.from({ length: rows }, (_, row) => (
                      <div key={row} className="contents">
                        <span className="self-center text-[10px] text-[#777]">
                          W
                          {week(
                            addCalendarDays(days[row * 7] ?? today, weekStartsOn === 0 ? 1 : 0),
                          )}
                        </span>
                        {days.slice(row * 7, row * 7 + 7).map((date) => {
                          if (!date.startsWith(prefix)) return <span key={date} className="h-8" />;
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
                              className={`h-8 text-sm focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-amber-400 ${endpoint ? "rounded bg-amber-400 text-[#1b1b1b]" : selected ? "bg-amber-400/20 text-amber-300" : "hover:bg-white/8"} ${!date.startsWith(prefix) && !selected ? "text-[#666]" : ""} ${date === today && !selected ? "rounded border border-[#777]" : ""}`}
                              onClick={() => selectDay(date)}
                            >
                              {Number(date.slice(8))}
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
              className="absolute right-3 bottom-1 text-xs text-red-300"
            >
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
