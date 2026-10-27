import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useRef, useState } from "react";

import { NotificationSettingsDialog } from "@/web/features/notifications/notification-settings-dialog";
import { useDismissPopover, useEscapeToClose } from "@/web/features/timer/use-dismiss-popover";
import { useNow } from "@/web/hooks/use-now";
import { apiRequest } from "@/web/lib/api";
import type { AppNotification, TimeEntry } from "@/web/types";

interface TimerQuery {
  entry: TimeEntry | null;
  unread_notifications?: number;
  server_now: string;
}

interface NotificationsQuery {
  notifications: AppNotification[];
  unread_count: number;
}

const NOTIFICATIONS_KEY = ["notifications"] as const;

/** The unread count rides on the sidebar's 30 s `["timer"]` poll, so the bell adds no requests. */
function useUnreadCount(): number {
  const timer = useQuery({
    queryKey: ["timer"],
    queryFn: () => apiRequest<TimerQuery>("/timer"),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  return timer.data?.unread_notifications ?? 0;
}

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function timeAgo(iso: string, now: number): string {
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, "hour");
  return relativeTime.format(Math.round(hours / 24), "day");
}

/** Mounted only while the panel is open, so the closed bell does not re-render every tick. */
function TimeAgo({ iso }: { iso: string }) {
  const now = useNow(30_000);
  return (
    <time dateTime={iso} className="text-fg-muted mt-1 block text-[11px] leading-4 font-medium">
      {timeAgo(iso, now)}
    </time>
  );
}

export function NotificationBell() {
  const queryClient = useQueryClient();
  const unread = useUnreadCount();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDismissPopover(root, close, undefined, open);
  useEscapeToClose(open, close);

  const list = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => apiRequest<NotificationsQuery>("/notifications"),
    enabled: open,
    staleTime: 0,
  });

  const setUnread = (count: number) =>
    queryClient.setQueryData<TimerQuery>(["timer"], (current) =>
      current ? { ...current, unread_notifications: count } : current,
    );

  const markRead = useMutation({
    mutationFn: (id: string | null) =>
      apiRequest<{ unread_count: number }>(
        id ? `/notifications/${id}/read` : "/notifications/read-all",
        { method: "POST" },
      ),
    onMutate: (id) => {
      const readAt = new Date().toISOString();
      queryClient.setQueryData<NotificationsQuery>(NOTIFICATIONS_KEY, (current) =>
        current
          ? {
              ...current,
              notifications: current.notifications.map((item) =>
                (id === null || item.id === id) && !item.read_at
                  ? { ...item, read_at: readAt }
                  : item,
              ),
            }
          : current,
      );
    },
    onSuccess: (data) => setUnread(data.unread_count),
    onError: () => void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });

  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
  const notifications = list.data?.notifications ?? [];

  return (
    <div ref={root}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        className="text-fg-muted hover:text-fg-soft relative grid h-[34px] w-[47px] place-items-center"
      >
        <Bell size={18} aria-hidden="true" />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="bg-accent text-fg-inverted absolute top-1 left-[24px] grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none font-bold"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="timer-popover absolute bottom-[60px] left-[45px] z-30 flex max-h-[min(480px,calc(100dvh-80px))] w-[340px] max-w-[calc(100vw-61px)] flex-col shadow-[0_2px_6px_rgb(0_0_0/39%)]"
        >
          <div className="border-stroke flex h-11 shrink-0 items-center justify-between border-b px-4">
            <h2 className="text-fg-strong text-sm leading-5 font-semibold">Notifications</h2>
            <button
              type="button"
              disabled={!notifications.some((item) => !item.read_at)}
              onClick={() => markRead.mutate(null)}
              className="text-fg-muted hover:text-fg-strong text-xs font-semibold disabled:cursor-default disabled:opacity-40"
            >
              Mark all as read
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {list.isPending ? (
              <p className="text-fg-subtle px-3 py-6 text-center text-sm font-medium">Loading…</p>
            ) : list.isError ? (
              <p role="alert" className="px-3 py-6 text-center text-sm font-medium text-[#e32817]">
                Notifications could not be loaded.
              </p>
            ) : notifications.length === 0 ? (
              <p className="text-fg-subtle px-3 py-6 text-center text-sm font-medium">
                You're all caught up.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {notifications.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!item.read_at) markRead.mutate(item.id);
                      }}
                      className="hover:bg-surface-hover flex w-full gap-2.5 rounded-lg px-3 py-2.5 text-left"
                    >
                      <span
                        aria-hidden="true"
                        className={
                          item.read_at
                            ? "mt-1.5 size-2 shrink-0"
                            : "bg-accent mt-1.5 size-2 shrink-0 rounded-full"
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={
                            item.read_at
                              ? "text-fg-secondary block text-sm leading-5 font-medium"
                              : "text-fg-strong block text-sm leading-5 font-semibold"
                          }
                        >
                          {item.title}
                          {item.read_at ? null : <span className="sr-only"> (unread)</span>}
                        </span>
                        <span className="text-fg-subtle block text-xs leading-4 font-medium">
                          {item.body}
                        </span>
                        <TimeAgo iso={item.created_at} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-stroke shrink-0 border-t p-1">
            <button
              type="button"
              onClick={() => {
                close();
                setSettingsOpen(true);
              }}
              className="text-fg hover:bg-surface-hover flex h-9 w-full items-center rounded-lg px-3 text-sm font-medium"
            >
              Notification settings
            </button>
          </div>
        </div>
      ) : null}
      <NotificationSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
