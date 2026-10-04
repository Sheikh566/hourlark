import { useEffect, type RefObject } from "react";

export function useDismissPopover(
  root: RefObject<HTMLElement | null>,
  dismiss: () => void,
  ignore?: RefObject<HTMLElement | null>,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (root.current?.contains(target) || ignore?.current?.contains(target)) return;
      dismiss();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [dismiss, enabled, ignore, root]);
}

export function useEscapeToClose(open: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onEscape();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onEscape, open]);
}

export function useRestoreFocus(
  open: boolean,
  trigger: RefObject<HTMLElement | null>,
  restore: boolean,
  onRestored: () => void,
) {
  useEffect(() => {
    if (open || !restore) return;
    onRestored();
    trigger.current?.focus();
  }, [onRestored, open, restore, trigger]);
}
