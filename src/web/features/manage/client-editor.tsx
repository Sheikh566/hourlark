import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { z } from "zod";

import { majorToMinor, minorToMajor } from "@/domain/billing/money";
import { useMe } from "@/web/app/context";
import { FormErrors } from "@/web/components/form-errors";
import { Button, Field, Input, Modal, Textarea, useToast } from "@/web/components/ui";
import { AdvancedToggle } from "@/web/features/manage/option-card";
import { apiRequest } from "@/web/lib/api";
import type { Client } from "@/web/types";

const clientFormSchema = z.object({
  name: z.string().trim().min(1, "This field is required."),
  billing_contact_name: z.string(),
  billing_email: z
    .string()
    .trim()
    .refine(
      (value) => !value || z.email().safeParse(value).success,
      "Enter a valid billing email address.",
    ),
  billing_address: z.string(),
  tax_identifier: z.string(),
  default_rate_major: z
    .string()
    .refine(
      (value) => !value || (Number.isFinite(Number(value)) && Number(value) >= 0),
      "Enter a non-negative number.",
    ),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, "Enter a three-letter currency code."),
  notes: z.string(),
});
type ClientForm = z.infer<typeof clientFormSchema>;

/**
 * Toggl's small "New client" dialog (360px): the client name first and one full-width 36px
 * primary button. Hourlark's billing profile fields live behind "Advanced options".
 */
export function ClientEditor({
  open,
  client,
  onOpenChange,
}: {
  open: boolean;
  client: Client | null;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const advancedId = useId();
  const [advanced, setAdvanced] = useState(false);
  const form = useForm<ClientForm>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: {
      name: "",
      billing_contact_name: "",
      billing_email: "",
      billing_address: "",
      tax_identifier: "",
      default_rate_major: "",
      currency: me.workspace.currency,
      notes: "",
    },
  });
  useEffect(() => {
    form.reset({
      name: client?.name ?? "",
      billing_contact_name: client?.billing_contact_name ?? "",
      billing_email: client?.billing_email ?? "",
      billing_address: client?.billing_address ?? "",
      tax_identifier: client?.tax_identifier ?? "",
      default_rate_major:
        client?.default_rate_minor === null || client?.default_rate_minor === undefined
          ? ""
          : String(
              minorToMajor(client.default_rate_minor, client.currency ?? me.workspace.currency),
            ),
      currency: client?.currency ?? me.workspace.currency,
      notes: client?.notes ?? "",
    });
    setAdvanced(false);
  }, [client, form, me.workspace.currency, open]);
  const mutation = useMutation({
    mutationFn: (values: ClientForm) => {
      const body = {
        name: values.name,
        billing_contact_name: values.billing_contact_name || null,
        billing_email: values.billing_email || null,
        billing_address: values.billing_address || null,
        tax_identifier: values.tax_identifier || null,
        default_rate_minor: values.default_rate_major
          ? majorToMinor(values.default_rate_major, values.currency)
          : null,
        currency: values.currency.toUpperCase(),
        notes: values.notes || null,
        ...(client ? { version: client.version } : {}),
      };
      return apiRequest(client ? `/clients/${client.id}` : "/clients", {
        method: client ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      toast({ message: client ? "Client updated." : "Client created." });
      onOpenChange(false);
    },
  });

  const errors = form.formState.errors;
  const otherErrors: FieldErrors<ClientForm> = { ...errors };
  delete otherErrors.name;
  const hasAdvancedErrors = Boolean(
    errors.billing_email ?? errors.currency ?? errors.default_rate_major,
  );
  useEffect(() => {
    if (hasAdvancedErrors) setAdvanced(true);
  }, [hasAdvancedErrors]);
  const submit = () =>
    void form.handleSubmit((values) => !mutation.isPending && mutation.mutate(values))();

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) onOpenChange(next);
      }}
      size="sm"
      title={client ? "Edit client" : "New Client"}
      footer={
        <Button className="w-full" disabled={mutation.isPending} onClick={submit}>
          {mutation.isPending ? "Saving…" : client ? "Save" : "Create client"}
        </Button>
      }
    >
      <form
        noValidate
        className="grid gap-4"
        onSubmit={form.handleSubmit((values) => !mutation.isPending && mutation.mutate(values))}
      >
        <fieldset disabled={mutation.isPending} className="contents">
          <div className="empty:hidden">
            <FormErrors errors={otherErrors} />
          </div>
          <Field label="Client name" error={errors.name ? "Please enter a Client name" : undefined}>
            <Input
              placeholder="Client name"
              aria-invalid={Boolean(errors.name)}
              {...form.register("name")}
            />
          </Field>
          <AdvancedToggle
            open={advanced}
            controls={advancedId}
            onClick={() => setAdvanced((current) => !current)}
          />
          {advanced ? (
            <div id={advancedId} className="grid gap-4">
              <Field label="Billing contact">
                <Input
                  aria-invalid={Boolean(errors.billing_contact_name)}
                  {...form.register("billing_contact_name")}
                />
              </Field>
              <Field label="Billing email">
                <Input
                  type="email"
                  aria-invalid={Boolean(errors.billing_email)}
                  {...form.register("billing_email")}
                />
              </Field>
              <Field label="Billing address">
                <Textarea
                  aria-invalid={Boolean(errors.billing_address)}
                  {...form.register("billing_address")}
                />
              </Field>
              <Field label="Tax / registration ID">
                <Input
                  aria-invalid={Boolean(errors.tax_identifier)}
                  {...form.register("tax_identifier")}
                />
              </Field>
              <Field label="Currency">
                <Input
                  maxLength={3}
                  aria-invalid={Boolean(errors.currency)}
                  {...form.register("currency")}
                />
              </Field>
              <Field label="Default hourly rate">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  aria-invalid={Boolean(errors.default_rate_major)}
                  {...form.register("default_rate_major")}
                />
              </Field>
              <Field label="Notes">
                <Textarea aria-invalid={Boolean(errors.notes)} {...form.register("notes")} />
              </Field>
            </div>
          ) : null}
          {mutation.error ? (
            <p role="alert" className="text-error-fg text-sm">
              {mutation.error.message}
            </p>
          ) : null}
        </fieldset>
      </form>
    </Modal>
  );
}
