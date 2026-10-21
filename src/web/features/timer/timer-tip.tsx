/**
 * Toggl's timer-bar tooltip: shown ~250ms after the pointer enters its `.timer-tip` trigger and
 * faded in over 0.3s (styles.css). Rendered inside the trigger so it needs no portal; the trigger's
 * aria-label stays its accessible name and the tip is linked as its description.
 */
export function TimerTip({
  id,
  label,
  shortcut,
  placement = "bottom",
}: {
  id: string;
  label: string;
  /** Keyboard shortcut drawn as Toggl's bordered key cap after the label. */
  shortcut?: string;
  /** `bottom` centres the tip 8px below the trigger; `left` centres it 8px to its left. */
  placement?: "bottom" | "left";
}) {
  return (
    <span id={id} role="tooltip" className="timer-tip-box" data-placement={placement}>
      <span>{label}</span>
      {shortcut ? <kbd className="timer-tip-kbd">{shortcut}</kbd> : null}
    </span>
  );
}
