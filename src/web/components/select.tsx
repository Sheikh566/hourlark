import * as SelectPrimitive from "@radix-ui/react-select";
import { Check } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { twMerge } from "tailwind-merge";

export type SelectOption = {
  value: string;
  label: ReactNode;
  /** Plain text used for typeahead when `label` is not a string. */
  textValue?: string;
  /** Optional swatch, e.g. a project color. */
  color?: string | null;
  disabled?: boolean;
};

// Radix reserves "" for "no selection", but our forms use "" for options like "No project".
const EMPTY_VALUE = "__hourlark_empty__";
const toRadix = (value: string) => (value === "" ? EMPTY_VALUE : value);
const fromRadix = (value: string) => (value === EMPTY_VALUE ? "" : value);

export type SelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  name?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  /** Leading icon rendered inside the trigger. */
  icon?: ReactNode;
  /** Muted lead-in text before the value, e.g. "Breakdown by:" (Toggl's two-tone trigger). */
  labelPrefix?: ReactNode;
  /**
   * Selected-item colouring: `neutral` (default, #3a3a3a like Toggl menus) or `accent`
   * (accent-muted fill and accent text, used by Toggl's calendar mode menu).
   */
  tone?: "neutral" | "accent";
  className?: string;
  contentClassName?: string;
  onBlur?: () => void;
  ref?: Ref<HTMLButtonElement>;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
};

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  name,
  id,
  disabled,
  required,
  icon,
  labelPrefix,
  tone = "neutral",
  className,
  contentClassName,
  onBlur,
  ref,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
}: SelectProps) {
  const hasEmptyOption = options.some((option) => option.value === "");
  const selected = options.find((option) => option.value === value);
  return (
    <SelectPrimitive.Root
      value={value === "" && !hasEmptyOption ? "" : toRadix(value)}
      onValueChange={(next) => onValueChange(fromRadix(next))}
      name={name}
      disabled={disabled}
      required={required}
    >
      <SelectPrimitive.Trigger
        ref={ref}
        id={id}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        onBlur={onBlur}
        className={twMerge(
          // Toggl selects: 38px, 1px #666, radius 8, padding 10/12, 14px/500, #999 chevron.
          "group border-control bg-surface text-fg aria-invalid:border-error data-[placeholder]:text-fg-subtle box-border flex h-[38px] w-full max-w-full min-w-0 items-center gap-2 rounded-lg border px-3 text-left text-sm leading-5 font-medium outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        {icon ? (
          <span className="text-fg-subtle flex shrink-0" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {selected?.color ? <Swatch color={selected.color} /> : null}
        <span className="min-w-0 flex-1 truncate">
          {labelPrefix ? <span className="text-fg-subtle mr-1">{labelPrefix}</span> : null}
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <Chevron className="text-fg-subtle shrink-0" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={5}
          collisionPadding={8}
          className={twMerge(
            "timer-popover dark-surface text-fg relative z-[60] max-h-[min(20rem,var(--radix-select-content-available-height))] max-w-[min(24rem,calc(100vw-16px))] min-w-[var(--radix-select-trigger-width)] overflow-hidden text-sm font-medium",
            contentClassName,
          )}
        >
          <SelectPrimitive.ScrollUpButton className="text-fg-subtle flex h-6 items-center justify-center">
            <Chevron up />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-[5px]">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={toRadix(option.value)}
                disabled={option.disabled}
                textValue={
                  option.textValue ?? (typeof option.label === "string" ? option.label : undefined)
                }
                className={twMerge(
                  "hourlark-select-item data-[disabled]:text-fg-disabled relative flex h-[30px] cursor-pointer items-center gap-2 rounded-lg pr-8 pl-2.5 outline-none select-none data-[disabled]:cursor-not-allowed",
                  tone === "accent"
                    ? "data-[highlighted]:bg-accent-muted-hover data-[state=checked]:bg-accent-muted data-[state=checked]:text-accent-fg"
                    : "data-[highlighted]:bg-surface-hover data-[state=checked]:bg-surface-hover",
                )}
              >
                {option.color ? <Swatch color={option.color} /> : null}
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2.5 flex items-center">
                  <Check size={14} aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="text-fg-subtle flex h-6 items-center justify-center">
            <Chevron />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/** Toggl's 8x5 chevron. */
function Chevron({ up, className }: { up?: boolean; className?: string }) {
  return (
    <svg
      width="8"
      height="5"
      viewBox="0 0 8 5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={up ? "M1 4 4 1l3 3" : "M1 1l3 3 3-3"} />
    </svg>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}
