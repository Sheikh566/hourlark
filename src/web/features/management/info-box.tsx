import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { twMerge } from "tailwind-merge";

/**
 * Toggl's info box: #121212 fill, 1px #555 border, radius 8, 12px padding, 14px/600 #b1b1b1 text
 * and a 16px leading icon. Replaces light "amber-50" callouts that clash with the dark surfaces.
 */
export function InfoBox({
  icon: Icon,
  className,
  children,
}: {
  icon: LucideIcon;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={twMerge(
        "border-stroke-secondary bg-surface-secondary text-fg-secondary flex gap-2 rounded-lg border p-3 text-sm leading-5 font-semibold",
        className,
      )}
    >
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
