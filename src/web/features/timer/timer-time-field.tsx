import { useState, type InputHTMLAttributes } from "react";

import { addCalendarDays } from "@/domain/dates/calendar";
import { formatClock12, parseClockInput } from "@/web/features/timer/timer-time-fields";

/** "Today", "Yesterday" or "Oct 12" for a calendar date. */
export function dateLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addCalendarDays(today, -1)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(Date.parse(`${date}T00:00:00Z`));
}

/**
 * A text field for a clock time. It shows the 12-hour clock ("5:03 PM") and accepts what people
 * type ("17:03", "5pm", "503p"). With `commitOn="change"` every complete time is reported as it is
 * typed; with `"blur"` the time is reported when the field loses focus or Enter is pressed. An
 * unreadable entry snaps back to the last good time.
 */
export function TimeField({
  value,
  onCommit,
  commitOn,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string;
  onCommit: (time: string) => void;
  commitOn: "change" | "blur";
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = () => {
    if (draft !== null && commitOn === "blur") {
      const parsed = parseClockInput(draft);
      if (parsed && parsed !== value) onCommit(parsed);
    }
    setDraft(null);
  };
  return (
    <input
      {...props}
      type="text"
      inputMode="text"
      autoComplete="off"
      spellCheck={false}
      className={className}
      value={draft ?? formatClock12(value)}
      onFocus={(event) => {
        setDraft(formatClock12(value));
        event.currentTarget.select();
      }}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        if (commitOn === "change") {
          const parsed = parseClockInput(text);
          if (parsed && parsed !== value) onCommit(parsed);
        }
      }}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape" && draft !== null) {
          setDraft(null);
        }
      }}
    />
  );
}
