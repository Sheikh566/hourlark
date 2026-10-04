import type { FieldErrors, FieldValues } from "react-hook-form";

const labels: Record<string, string> = {
  name: "Name",
  color: "Color",
  visibility: "Visibility",
  role: "Role",
  status: "Account status",
  client_id: "Client",
  display_name: "Display name",
  email: "Company email",
  timezone: "Timezone",
  currency: "Currency",
  billing_email: "Billing email",
  default_rate_major: "Default hourly rate",
  hourly_rate_major: "Hourly rate",
  budget_hours: "Budget hours",
  weekly_target_hours: "Weekly target hours",
  app_name: "Application name",
  company_name: "Company name",
  company_domain: "Company domain",
  allowed_email_domains: "Allowed email domains",
  lock_entries_after_days: "Lock entries after days",
};

export function FormErrors<T extends FieldValues>({ errors }: { errors: FieldErrors<T> }) {
  const messages = Object.entries(errors).flatMap(([field, error]) =>
    error && typeof error.message === "string"
      ? [`${labels[field] ?? field.replaceAll("_", " ")}: ${error.message}`]
      : [],
  );
  if (!messages.length) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 sm:col-span-2"
    >
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}
