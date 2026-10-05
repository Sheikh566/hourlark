import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";

import { Select, type SelectProps } from "@/web/components/select";

/** `Select` bound to a react-hook-form field. */
export function FormSelect<T extends FieldValues>({
  control,
  name,
  ...props
}: { control: Control<T>; name: Path<T> } & Omit<
  SelectProps,
  "value" | "onValueChange" | "onBlur" | "ref"
>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Select
          {...props}
          ref={field.ref}
          value={field.value}
          onValueChange={field.onChange}
          onBlur={field.onBlur}
          aria-invalid={props["aria-invalid"] ?? fieldState.invalid}
        />
      )}
    />
  );
}
