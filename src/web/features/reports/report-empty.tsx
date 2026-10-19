/** Toggl's "Nothing to see here..." state: binoculars between two clouds, in the amber accent. */
function Binoculars() {
  return (
    <svg
      width="295"
      height="160"
      viewBox="0 0 295 160"
      fill="none"
      aria-hidden="true"
      className="h-auto max-w-full shrink-0"
    >
      <g fill="#fcd7ad">
        <path d="M150 62a30 30 0 0 1 56-8 38 38 0 0 1 71 18 22 22 0 0 1-4 44H156a26 26 0 0 1-6-54Z" />
        <path
          d="M18 50a18 18 0 0 1 34-6 22 22 0 0 1 40 12 16 16 0 0 1-2 32H26a18 18 0 0 1-8-38Z"
          fill="#efb878"
        />
      </g>
      <g>
        <rect x="52" y="44" width="40" height="30" rx="8" fill="#d88b10" />
        <rect x="103" y="44" width="40" height="30" rx="8" fill="#d88b10" />
        <rect x="88" y="62" width="22" height="26" rx="6" fill="#f59e0b" />
        <circle cx="64" cy="102" r="40" fill="#f59e0b" />
        <circle cx="131" cy="102" r="40" fill="#f59e0b" />
        <circle cx="64" cy="102" r="29" fill="#653e00" />
        <circle cx="131" cy="102" r="29" fill="#653e00" />
        <circle cx="64" cy="102" r="23" fill="#3b2301" />
        <circle cx="131" cy="102" r="23" fill="#3b2301" />
        <path d="M50 94a16 16 0 0 1 12-10" stroke="#fcd7ad" strokeWidth="3" strokeLinecap="round" />
        <path
          d="M117 94a16 16 0 0 1 12-10"
          stroke="#fcd7ad"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <rect x="76" y="38" width="43" height="10" rx="5" fill="#fbbf24" />
      </g>
    </svg>
  );
}

/** Empty card body; `height` keeps it vertically centred in the 344px chart area. */
export function ReportEmpty({ className = "min-h-[344px]" }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-4 text-center ${className}`}>
      <Binoculars />
      <h3 className="text-fg text-2xl leading-9 font-bold">Nothing to see here...</h3>
      <h4 className="text-fg-subtle max-w-[480px] text-sm leading-5 font-medium">
        We couldn&apos;t find any time entries. Try adjusting the date range or applying new
        filters.
      </h4>
    </div>
  );
}
