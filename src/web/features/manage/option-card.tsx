import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

/**
 * Toggl dialog option card (Privacy, Client, Time estimate): 456px wide inside the 480px dialog
 * body, 1px #3a3a3a border, radius 8, a 124px label cluster (14px icon + 11/600 uppercase #a4a4a4)
 * followed by the control.
 */
export function OptionCard({
  icon,
  label,
  children,
  className,
}: {
  icon: ReactNode;
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={twMerge(
        "border-stroke mx-3 box-border flex min-h-12 items-center rounded-lg border pl-4",
        className,
      )}
    >
      <div className="flex w-auto items-center sm:w-[124px]">
        <span
          className="text-fg-muted grid size-[14px] shrink-0 place-items-center"
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="text-fg-muted px-2 text-[11px] leading-4 font-semibold tracking-[0.44px] uppercase">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

/** "ADVANCED OPTIONS" disclosure: 168x36, accent 11/600 uppercase label and a 14x9 chevron. */
export function AdvancedToggle({
  open,
  onClick,
  label = "Advanced options",
  controls,
}: {
  open: boolean;
  onClick: () => void;
  label?: string;
  controls?: string;
}) {
  return (
    <div className="flex justify-end">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controls}
        className="text-accent-fg hover:bg-surface box-border flex h-9 items-center gap-2 rounded-lg px-3 text-[11px] leading-4 font-semibold tracking-[0.44px] uppercase"
        onClick={onClick}
      >
        {label}
        <ChevronDown
          width={14}
          height={9}
          strokeWidth={1.5}
          className={twMerge(
            "text-fg-muted transition-transform duration-200",
            open && "-rotate-90",
          )}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
