import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
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
          "group border-hourlark-control-border flex min-h-10 w-full max-w-full min-w-0 items-center gap-2 rounded-lg border bg-[#1b1b1b] px-3 py-2 text-left text-sm text-[#fafafa] transition-colors outline-none hover:border-[#a4a4a4] focus-visible:border-[#f59e0b] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-500 data-[placeholder]:text-[#a4a4a4] data-[state=open]:border-[#f59e0b]",
          className,
        )}
      >
        {icon ? (
          <span className="flex shrink-0 text-[#a4a4a4]" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {selected?.color ? <Swatch color={selected.color} /> : null}
        <span className="min-w-0 flex-1 truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className="shrink-0 text-[#a4a4a4] transition-transform group-data-[state=open]:rotate-180"
          />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className={twMerge(
            "dark-surface relative z-[60] max-h-[min(20rem,var(--radix-select-content-available-height))] max-w-[min(24rem,calc(100vw-16px))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-[#3b3b3b] bg-[#212121] text-sm text-[#fafafa] shadow-[0_18px_50px_rgb(0_0_0/45%)]",
            contentClassName,
          )}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-[#a4a4a4]">
            <ChevronUp size={14} aria-hidden="true" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={toRadix(option.value)}
                disabled={option.disabled}
                textValue={
                  option.textValue ?? (typeof option.label === "string" ? option.label : undefined)
                }
                className="hourlark-select-item relative flex min-h-8 cursor-pointer items-center gap-2 rounded-md py-1.5 pr-8 pl-2.5 outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-white/7 data-[state=checked]:bg-[#382b16] data-[state=checked]:text-[#fbbf24]"
              >
                {option.color ? <Swatch color={option.color} /> : null}
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2.5 flex items-center">
                  <Check size={14} aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-[#a4a4a4]">
            <ChevronDown size={14} aria-hidden="true" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
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
