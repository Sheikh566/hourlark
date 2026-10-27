import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button, Field, Input, Modal, Switch, useToast } from "@/web/components/ui";
import { ApiClientError, apiRequest } from "@/web/lib/api";
import { currentSubscription, disablePush, enablePush, isPushSupported } from "@/web/lib/push";
import type { NotificationPreferences, NotificationPreferencesResponse } from "@/web/types";

export const NOTIFICATION_PREFERENCES_KEY = ["notification-preferences"] as const;

const WEEKDAYS = [
  { label: "M", name: "Monday" },
  { label: "T", name: "Tuesday" },
  { label: "W", name: "Wednesday" },
  { label: "T", name: "Thursday" },
  { label: "F", name: "Friday" },
  { label: "S", name: "Saturday" },
  { label: "S", name: "Sunday" },
] as const;

/** Editable copy of the stored preferences; hours and the clock time stay strings while typing. */
interface Draft {
  long_timer_enabled: boolean;
  long_timer_hours: string;
  reminder_enabled: boolean;
  reminder_time: string;
  reminder_threshold_hours: string;
  reminder_weekdays: number;
}

function toDraft(preferences: NotificationPreferences): Draft {
  const minutes = preferences.reminder_time_minutes;
  return {
    long_timer_enabled: preferences.long_timer_enabled,
    long_timer_hours: String(preferences.long_timer_minutes / 60),
    reminder_enabled: preferences.reminder_enabled,
    reminder_time: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
    reminder_threshold_hours: String(preferences.reminder_threshold_minutes / 60),
    reminder_weekdays: preferences.reminder_weekdays,
  };
}

type DraftErrors = Partial<
  Record<"long_timer_hours" | "reminder_time" | "reminder_threshold_hours", string>
>;

function fromDraft(draft: Draft): {
  values?: Omit<NotificationPreferences, "version">;
  errors: DraftErrors;
} {
  const errors: DraftErrors = {};
  const longHours = Number(draft.long_timer_hours);
  if (!Number.isInteger(longHours) || longHours < 1 || longHours > 24) {
    errors.long_timer_hours = "Enter whole hours from 1 to 24";
  }
  const time = /^(\d{2}):(\d{2})$/.exec(draft.reminder_time);
  const reminderMinutes = time ? Number(time[1]) * 60 + Number(time[2]) : NaN;
  if (!time || reminderMinutes > 1439) errors.reminder_time = "Enter a time";
  const threshold = Math.round(Number(draft.reminder_threshold_hours) * 60);
  if (!Number.isFinite(threshold) || threshold < 15 || threshold > 1440) {
    errors.reminder_threshold_hours = "Enter 0.25 to 24 hours";
  }
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    values: {
      long_timer_enabled: draft.long_timer_enabled,
      long_timer_minutes: longHours * 60,
      reminder_enabled: draft.reminder_enabled,
      reminder_time_minutes: reminderMinutes,
      reminder_threshold_minutes: threshold,
      reminder_weekdays: draft.reminder_weekdays,
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof ApiClientError ? error.message : "Something went wrong. Try again.";
}

function SettingRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-fg-strong text-sm leading-5 font-semibold">{title}</p>
        <p className="text-fg-subtle text-xs leading-4 font-medium">{description}</p>
      </div>
      <Switch
        aria-label={title}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="mt-0.5"
      />
    </div>
  );
}

function BrowserNotifications({ publicKey }: { publicKey: string }) {
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [permission, setPermission] = useState(() => Notification.permission);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void currentSubscription().then((subscription) => {
      if (active) setSubscribed(subscription !== null);
    });
    return () => {
      active = false;
    };
  }, []);

  const toggle = useMutation({
    mutationFn: async () => {
      if (subscribed) {
        await disablePush();
        return false;
      }
      const result = await enablePush(publicKey);
      setPermission(result);
      return result === "granted";
    },
    onSuccess: (next) => {
      setError(null);
      setSubscribed(next);
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  return (
    <section className="border-stroke grid gap-2 border-t pt-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-fg-strong text-sm leading-5 font-semibold">Browser notifications</p>
          <p className="text-fg-subtle text-xs leading-4 font-medium">
            {permission === "denied"
              ? "Notifications are blocked for this site in your browser settings."
              : subscribed
                ? "This device receives notifications, even when Hourlark is closed."
                : "Get notified on this device, even when Hourlark is closed."}
          </p>
        </div>
        <Button
          variant="secondary"
          className="shrink-0"
          disabled={subscribed === null || toggle.isPending || permission === "denied"}
          onClick={() => toggle.mutate()}
        >
          {subscribed ? "Turn off" : "Turn on"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-[#e32817]">
          {error}
        </p>
      ) : null}
    </section>
  );
}

const FORM_ID = "notification-settings";

function PreferencesForm({
  stored,
  push,
  saving,
  formError,
  onSubmit,
}: {
  stored: NotificationPreferences;
  push: NotificationPreferencesResponse["push"];
  saving: boolean;
  formError: string | null;
  onSubmit: (values: Omit<NotificationPreferences, "version">) => void;
}) {
  const [draft, setDraft] = useState(() => toDraft(stored));
  const [errors, setErrors] = useState<DraftErrors>({});
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <form
      id={FORM_ID}
      noValidate
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (saving) return;
        const result = fromDraft(draft);
        setErrors(result.errors);
        if (result.values) onSubmit(result.values);
      }}
    >
      <fieldset disabled={saving} className="contents">
        {formError ? (
          <p role="alert" className="text-sm font-medium text-[#e32817]">
            {formError}
          </p>
        ) : null}
        <section className="grid gap-3">
          <SettingRow
            title="Long-running timer"
            description="Warn me once when a timer keeps running, in case I forgot to stop it."
            checked={draft.long_timer_enabled}
            onCheckedChange={(checked) => update({ long_timer_enabled: checked })}
          />
          {draft.long_timer_enabled ? (
            <div className="w-40">
              <Field label="Warn after (hours)" error={errors.long_timer_hours}>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={24}
                  step={1}
                  value={draft.long_timer_hours}
                  aria-invalid={Boolean(errors.long_timer_hours)}
                  onChange={(event) => update({ long_timer_hours: event.target.value })}
                />
              </Field>
            </div>
          ) : null}
        </section>

        <section className="border-stroke grid gap-3 border-t pt-4">
          <SettingRow
            title="Tracking reminder"
            description="Remind me when I've tracked less than my goal for the day."
            checked={draft.reminder_enabled}
            onCheckedChange={(checked) => update({ reminder_enabled: checked })}
          />
          {draft.reminder_enabled ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Remind at" error={errors.reminder_time}>
                  <Input
                    type="time"
                    value={draft.reminder_time}
                    aria-invalid={Boolean(errors.reminder_time)}
                    onChange={(event) => update({ reminder_time: event.target.value })}
                  />
                </Field>
                <Field label="Daily goal (hours)" error={errors.reminder_threshold_hours}>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0.25}
                    max={24}
                    step={0.25}
                    value={draft.reminder_threshold_hours}
                    aria-invalid={Boolean(errors.reminder_threshold_hours)}
                    onChange={(event) => update({ reminder_threshold_hours: event.target.value })}
                  />
                </Field>
              </div>
              <div role="group" aria-label="Reminder days" className="flex gap-1.5">
                {WEEKDAYS.map((day, index) => {
                  const bit = 1 << index;
                  const pressed = (draft.reminder_weekdays & bit) !== 0;
                  return (
                    <button
                      key={day.name}
                      type="button"
                      aria-label={day.name}
                      aria-pressed={pressed}
                      onClick={() => update({ reminder_weekdays: draft.reminder_weekdays ^ bit })}
                      className={
                        pressed
                          ? "bg-accent text-fg-inverted size-8 rounded-full text-xs font-semibold"
                          : "border-control text-fg-muted hover:bg-surface-hover size-8 rounded-full border text-xs font-semibold"
                      }
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </section>

        {push.available && push.public_key && isPushSupported() ? (
          <BrowserNotifications publicKey={push.public_key} />
        ) : null}
      </fieldset>
    </form>
  );
}

export function NotificationSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: NOTIFICATION_PREFERENCES_KEY,
    queryFn: () => apiRequest<NotificationPreferencesResponse>("/notifications/preferences"),
    enabled: open,
  });
  const stored = query.data?.preferences;

  const save = useMutation({
    mutationFn: (values: Omit<NotificationPreferences, "version">) =>
      apiRequest<NotificationPreferencesResponse>("/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify({ ...values, version: stored?.version ?? 0 }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(NOTIFICATION_PREFERENCES_KEY, data);
      toast({ message: "Notification settings saved" });
      onOpenChange(false);
    },
    onError: (failure) => {
      if (failure instanceof ApiClientError && failure.status === 409) void query.refetch();
    },
  });

  const sendTest = useMutation({
    mutationFn: () => apiRequest<{ pushed: number }>("/notifications/test", { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["timer"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast({ message: "Test notification sent" });
    },
    onError: (failure) => toast({ message: errorMessage(failure) }),
  });

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (save.isPending) return;
        if (!next) save.reset();
        onOpenChange(next);
      }}
      size="md"
      titleSize="md"
      title="Notifications"
      description="Reminders use your time zone."
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <Button variant="text" disabled={sendTest.isPending} onClick={() => sendTest.mutate()}>
            Send test notification
          </Button>
          <Button type="submit" form={FORM_ID} disabled={!stored || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      {query.isError ? (
        <p role="alert" className="text-sm font-medium text-[#e32817]">
          {errorMessage(query.error)}
        </p>
      ) : !stored || !query.data ? (
        <p className="text-fg-subtle text-sm font-medium">Loading…</p>
      ) : (
        // Remounting on a new version (after a conflict refetch) restarts from the stored values.
        <PreferencesForm
          key={stored.version}
          stored={stored}
          push={query.data.push}
          saving={save.isPending}
          formError={save.isError ? errorMessage(save.error) : null}
          onSubmit={(values) => save.mutate(values)}
        />
      )}
    </Modal>
  );
}
