import { Check } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useDismissPopover, useEscapeToClose } from "@/web/features/timer/use-dismiss-popover";

/** Toggl's project colour swatches (measured from the Create new project popover). */
export const PROJECT_COLORS = [
  "#0b83d9",
  "#9e5bd9",
  "#d94182",
  "#e36a00",
  "#bf7000",
  "#2da608",
  "#06a893",
  "#c9806b",
  "#465bb3",
  "#990099",
  "#c7af14",
  "#566614",
  "#d92b2b",
  "#525266",
] as const;

const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/**
 * Toggl colour dot: a 24px dot in a 36px hit area that opens a 176x114 popover with 5x3 swatches
 * (24px circles, 6px / 5px apart). The fifteenth slot is Hourlark's custom colour input, since
 * projects accept any #rrggbb value.
 */
export function ColorDotPicker({
  value,
  onChange,
  label = "Project color",
}: {
  value: string;
  onChange: (color: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<{
    host: HTMLElement;
    top: number;
    left: number;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissPopover(popover, close, trigger, open);
  useEscapeToClose(open, () => {
    setOpen(false);
    trigger.current?.focus();
  });
  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    // Rendered inside the dialog: Radix treats body-level portals as "outside" the modal. The
    // dialog is transformed, so absolute offsets are relative to its padding box.
    const host = trigger.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body;
    const origin = host === document.body ? { left: 0, top: 0 } : host.getBoundingClientRect();
    const inset = host === document.body ? 0 : 1;
    setPlacement({
      host,
      top: rect.bottom + 6 - origin.top - inset,
      left: rect.left - 88 - origin.left - inset,
    });
  }, [open]);
  const custom = !PROJECT_COLORS.some((color) => same(color, value));
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="grid size-9 shrink-0 place-items-center rounded-full"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="size-6 rounded-full" style={{ backgroundColor: value }} />
      </button>
      {open && placement
        ? createPortal(
            <div
              ref={popover}
              role="dialog"
              aria-label={label}
              style={{ top: placement.top, left: placement.left }}
              className="timer-popover dark-surface absolute z-10 box-border grid h-[114px] w-[176px] grid-cols-5 content-start gap-x-1.5 gap-y-[5px] p-[15px]"
            >
              {PROJECT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={color}
                  aria-pressed={same(color, value)}
                  className="grid size-6 place-items-center rounded-full"
                  style={{ backgroundColor: color }}
                  onClick={() => {
                    onChange(color);
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                >
                  {same(color, value) ? (
                    <Check size={14} strokeWidth={2} className="text-white" aria-hidden="true" />
                  ) : null}
                </button>
              ))}
              <label
                className="relative grid size-6 cursor-pointer place-items-center overflow-hidden rounded-full"
                style={{
                  background: custom
                    ? value
                    : "conic-gradient(#d92b2b, #c7af14, #2da608, #06a893, #0b83d9, #9e5bd9, #d92b2b)",
                }}
                title="Custom colour"
              >
                <span className="sr-only">Custom colour</span>
                {custom ? (
                  <Check size={14} strokeWidth={2} className="text-white" aria-hidden="true" />
                ) : null}
                <input
                  type="color"
                  value={value}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                  onChange={(event) => onChange(event.target.value)}
                />
              </label>
            </div>,
            placement.host,
          )
        : null}
    </>
  );
}
