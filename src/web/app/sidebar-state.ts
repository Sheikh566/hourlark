import { useCallback, useEffect, useState } from "react";

export const SIDEBAR_COLLAPSED_KEY = "hourlark:sidebar-collapsed";

/** Toggl's `H` shortcut toggles the sidebar unless the person is typing somewhere. */
const TYPING_TARGET =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox'], [role='combobox'], [role='searchbox']";

export function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // Storage can be unavailable (private windows); the state then lasts for this page load.
  }
}

export function isSidebarShortcut(event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== "h") return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat)
    return false;
  if (event.defaultPrevented) return false;
  const target = event.target;
  if (target instanceof Element && target.closest(TYPING_TARGET)) return false;
  return true;
}

/** Per-browser collapsed state of the desktop sidebar plus its `H` keyboard shortcut. */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);

  const toggle = useCallback(() => setCollapsed((current) => !current), []);

  useEffect(() => writeSidebarCollapsed(collapsed), [collapsed]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isSidebarShortcut(event)) return;
      // The sidebar is a drawer below the md breakpoint; there is nothing to collapse.
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      event.preventDefault();
      toggle();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  return [collapsed, toggle];
}
