import { X } from "lucide-react";
import type { ReactNode } from "react";

export type BulkAction = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
};

const actionClassName =
  "text-fg hover:bg-surface-hover box-border flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Toggl's selection bar: a 50px row above the table header with "N items selected", a divider,
 * the bulk actions (36px text buttons with 14px icons, 4px apart) and a 38x36 clear button.
 * It is a table row so it lines up with the page gutters of `.data-table`.
 */
export function BulkBar({
  count,
  noun = "item",
  columns,
  actions,
  onClear,
}: {
  count: number;
  noun?: string;
  columns: number;
  actions: BulkAction[];
  onClear: () => void;
}) {
  return (
    <tr className="bg-surface">
      <th
        colSpan={columns}
        scope="colgroup"
        className="text-fg h-[50px] border-b-0 p-0 text-sm leading-5 font-medium normal-case"
      >
        <div
          className="flex h-[50px] items-center px-4"
          role="toolbar"
          aria-label="Selection actions"
        >
          <div className="border-stroke flex h-[30px] items-center border-r py-2 pr-7">
            <span aria-live="polite">
              <strong className="font-semibold tabular-nums">
                {count} {count === 1 ? noun : `${noun}s`}
              </strong>{" "}
              selected
            </span>
          </div>
          <div className="ml-4 flex gap-1">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={actionClassName}
                disabled={action.disabled}
                onClick={action.onSelect}
              >
                <span className="grid size-[14px] place-items-center" aria-hidden="true">
                  {action.icon}
                </span>
                {action.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Clear selection"
            className="text-fg hover:bg-surface-hover ml-1 grid h-9 w-[38px] place-items-center rounded-lg"
            onClick={onClear}
          >
            <X size={9} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      </th>
    </tr>
  );
}
