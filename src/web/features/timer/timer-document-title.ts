import { useEffect, useRef } from "react";

/** Toggl's tab-title clock: "12 sec", "01:44 min", "1:02:03 h". */
export function formatTitleElapsed(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  if (total < 60) return `${total} sec`;
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const two = (value: number) => String(value).padStart(2, "0");
  if (hours === 0) return `${two(minutes)}:${two(seconds)} min`;
  return `${hours}:${two(minutes)}:${two(seconds)} h`;
}

/** "<elapsed> - <description> - <project> • <app>" with empty parts dropped. */
export function timerDocumentTitle(
  elapsedMs: number,
  description: string,
  projectName: string | null | undefined,
  appName: string,
): string {
  const parts = [formatTitleElapsed(elapsedMs), description.trim(), projectName?.trim() ?? ""];
  return `${parts.filter(Boolean).join(" - ")} • ${appName}`;
}

/**
 * While a timer runs the tab title shows the elapsed time (refreshed with `now`), the description
 * and the project; the title seen before it started is restored when it stops or unmounts.
 */
export function useTimerDocumentTitle(
  running: { startedAt: number; description: string; projectName: string | null } | null,
  now: number,
) {
  const baseTitle = useRef<string | null>(null);
  const active = running !== null;
  useEffect(() => {
    if (!active) return;
    baseTitle.current ??= document.title;
    return () => {
      if (baseTitle.current !== null) document.title = baseTitle.current;
      baseTitle.current = null;
    };
  }, [active]);
  useEffect(() => {
    if (!running) return;
    document.title = timerDocumentTitle(
      now - running.startedAt,
      running.description,
      running.projectName,
      "Hourlark",
    );
  }, [now, running]);
}
