import { useEffect, useRef, type InputHTMLAttributes, type Ref } from "react";
import { twMerge } from "tailwind-merge";

/**
 * Toggl checkbox: 14x14, radius 4, 1px #666 border on the surface colour; checked fills with the
 * accent and a dark tick. Rendered as a native input (styled by `.hl-checkbox` in styles.css) so
 * it keeps form, label and react-hook-form behaviour.
 */
export function Checkbox({
  className,
  indeterminate = false,
  ref,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  indeterminate?: boolean;
  ref?: Ref<HTMLInputElement>;
}) {
  const inner = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      {...props}
      ref={(node) => {
        inner.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      type="checkbox"
      className={twMerge("hl-checkbox", className)}
    />
  );
}
