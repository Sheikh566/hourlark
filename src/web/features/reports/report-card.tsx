import type { AriaAttributes, ReactNode } from "react";

/**
 * Toggl report card: surface fill, 1px #3a3a3a ring (no drop shadow), radius 8, 12px padding and a
 * 12px gap between the header row and the body. `.report-surface` keeps the ring as a single
 * box-shadow (Toggl's computed value).
 */
export function ReportCard({
  children,
  className = "",
  ...props
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <section
      className={`report-surface bg-surface box-border flex min-w-0 flex-col gap-3 rounded-lg border border-transparent p-3 leading-[14px] ${className}`}
      {...props}
    >
      {children}
    </section>
  );
}

/** Toggl card header: a 37px row whose title sits 12px in from the body text edge (x+24). */
export function ReportCardHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-[37px] flex-wrap items-center justify-between gap-x-4 gap-y-2 pl-3">
      <h2 className="text-fg truncate text-sm leading-5 font-semibold whitespace-nowrap">
        {title}
      </h2>
      {children}
    </div>
  );
}

/**
 * Table header cell like Toggl's: the 2px underline lives on an inner box, so it breaks into
 * segments with 20px gaps between columns (`lead` = name column, `edge` = chevron column).
 */
export function ReportTh({
  kind = "cell",
  children,
  ...aria
}: {
  kind?: "edge" | "lead" | "cell";
  children?: ReactNode;
} & Pick<AriaAttributes, "aria-sort" | "aria-hidden">) {
  const padding = kind === "edge" ? "p-0" : kind === "lead" ? "pr-2.5 pl-0" : "px-2.5";
  return (
    <th className={`${padding} h-[54px] align-top font-normal`} {...aria}>
      <div
        className={`border-stroke text-fg-subtle box-border flex h-[54px] items-center border-b-2 text-[11px] leading-4 font-semibold [&_button]:text-left ${kind === "edge" ? "justify-center" : "pl-[9px]"}`}
      >
        {children}
      </div>
    </th>
  );
}
