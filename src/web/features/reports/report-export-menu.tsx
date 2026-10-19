import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/web/components/ui";
import { useDismissPopover, useEscapeToClose } from "@/web/features/timer/use-dismiss-popover";

/** Toggl's single "Export" header action: a text button that opens a small PDF/CSV menu. */
export function ReportExportMenu({
  exporting,
  onCsv,
  onPdf,
}: {
  exporting: boolean;
  onCsv: () => void;
  onPdf: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const focusTrigger = () => anchor.current?.querySelector("button")?.focus();
  const menu = useRef<HTMLDivElement>(null);
  const openedByKeyboard = useRef(false);
  const close = useCallback(() => setOpen(false), []);
  useDismissPopover(menu, close, anchor, open);
  useEscapeToClose(open, () => {
    setOpen(false);
    focusTrigger();
  });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (rect) setPosition({ top: rect.bottom + 5, right: window.innerWidth - rect.right });
    };
    place();
    window.addEventListener("resize", place);
    // The content area is the scroll container; a fixed menu would detach from its header
    // trigger, so dismiss it when anything scrolls (there are no text inputs in this menu).
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, close]);
  useLayoutEffect(() => {
    if (!open || !position || !openedByKeyboard.current) return;
    openedByKeyboard.current = false;
    menu.current?.querySelector<HTMLButtonElement>("button:enabled")?.focus();
  }, [open, position]);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:enabled")];
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[
      (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
    ]?.focus();
  };
  const item =
    "text-fg hover:bg-surface-hover focus-visible:bg-surface-hover flex h-7 w-full items-center gap-2 rounded-lg px-3 text-left text-sm leading-5 font-medium whitespace-nowrap";

  return (
    <>
      <span ref={anchor} className="inline-flex">
        <Button
          variant="text"
          // Toggl gives each header action a 5px right margin; the label itself does not nowrap.
          className="mr-[5px] gap-2 px-3 py-2 text-left whitespace-normal"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={exporting}
          onClick={(event) => {
            openedByKeyboard.current = event.detail === 0;
            setOpen((value) => !value);
          }}
        >
          <Download size={14} aria-hidden="true" />
          {exporting ? "Exporting…" : "Export"}
        </Button>
      </span>
      {open && position
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label="Export"
              style={{ top: position.top, right: position.right }}
              onKeyDown={moveFocus}
              className="bg-surface border-stroke shadow-popover-sm dark-surface fixed z-[70] min-w-[115px] rounded-lg border p-1"
            >
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  setOpen(false);
                  onPdf();
                }}
              >
                <FileText size={16} aria-hidden="true" />
                PDF
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  setOpen(false);
                  onCsv();
                }}
              >
                <FileSpreadsheet size={16} aria-hidden="true" />
                CSV
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
