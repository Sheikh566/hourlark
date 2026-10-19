import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { twMerge } from "tailwind-merge";

import type { RowMenuItem } from "@/web/components/ui";
import { useDismissPopover, useEscapeToClose } from "@/web/features/timer/use-dismiss-popover";

/** Toggl's Tags kebab menu sits 5px under the trigger and 19px past its right edge (measured). */
const MENU_OFFSET = 5;
const MENU_OVERHANG = 19;

/**
 * The Toggl Tags page's own row menu: a 36x36 kebab with a 14px dot glyph and a tighter popover
 * (4px padding, 28px items, 0 2px 8px shadow) than the 30px kebab used on the Members page, which
 * the shared `RowMenu` follows.
 */
export function TagRowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const openedByKeyboard = useRef(false);
  const close = useCallback(() => setOpen(false), []);
  useDismissPopover(root, close, menu, open);
  useEscapeToClose(open, () => {
    setOpen(false);
    trigger.current?.focus();
  });

  const place = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      top: rect.bottom + MENU_OFFSET,
      // `fixed` offsets resolve against the layout viewport (clientWidth, i.e. the content edge
      // left of the 5px scrollbar), not innerWidth. Toggl's panel overhangs the kebab by 19px and
      // ends flush with the content edge, so the offset is 0 there (clamped for narrow windows).
      right: Math.max(0, document.documentElement.clientWidth - rect.right - MENU_OVERHANG),
    });
  }, []);
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);
  useEffect(() => {
    if (!open || !position || !openedByKeyboard.current) return;
    openedByKeyboard.current = false;
    menu.current?.querySelector<HTMLButtonElement>("button:enabled")?.focus();
  }, [open, position]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [close, open]);

  if (items.length === 0) return null;

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:enabled")];
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div ref={root} className="relative inline-block">
      <button
        ref={trigger}
        type="button"
        className="text-fg hover:bg-surface aria-expanded:bg-surface grid size-9 place-items-center rounded-lg hover:text-[#d5d5d5]"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          openedByKeyboard.current = event.detail === 0;
          setOpen((value) => !value);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
          <circle cx="7" cy="2" r="1.5" />
          <circle cx="7" cy="7" r="1.5" />
          <circle cx="7" cy="12" r="1.5" />
        </svg>
      </button>
      {open && position
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              style={{ top: position.top, right: position.right }}
              onKeyDown={moveFocus}
              className="border-stroke bg-surface dark-surface fixed z-[70] min-w-[134.8px] rounded-lg border p-1 text-sm font-medium shadow-[0_2px_8px_rgb(0_0_0/50%)]"
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  className={twMerge(
                    "text-fg hover:bg-surface-hover focus-visible:bg-surface-hover disabled:text-fg-disabled flex h-7 w-full items-center gap-2 rounded-lg px-3 text-left whitespace-nowrap disabled:cursor-not-allowed disabled:hover:bg-transparent",
                    item.danger && "text-[#e32817]",
                  )}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
