import type { ButtonHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

/**
 * Toggl settings switch: a 28x8 pill track with a 16x16 knob that slides over it (0.2s). On uses
 * the accent (dark accent track, accent knob); off is neutral (#555 track, #a4a4a4 knob, not
 * measured because Toggl's off switches were plan-locked).
 */
export function Switch({
  checked,
  onCheckedChange,
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={twMerge(
        "relative inline-block h-4 w-7 shrink-0 rounded-full disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    >
      <span
        aria-hidden="true"
        className={twMerge(
          "absolute inset-x-0 top-1 h-2 rounded-full transition-colors duration-200",
          checked ? "bg-accent-muted-active" : "bg-fg-disabled",
        )}
      />
      <span
        aria-hidden="true"
        className={twMerge(
          "absolute top-0 left-0 size-4 rounded-full transition-[transform,background-color] duration-200",
          checked ? "bg-accent translate-x-3" : "bg-fg-muted translate-x-0",
        )}
      />
    </button>
  );
}
