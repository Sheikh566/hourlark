import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  Clock3,
  LogOut,
  Pencil,
  Settings,
  Tags,
  Users,
} from "lucide-react";
import { useRef, useState, type ComponentType, type ReactNode } from "react";
import { Link, NavLink } from "react-router";

import { AuthMode } from "@/domain/auth";
import { useMe } from "@/web/app/context";
import { useDismissPopover, useEscapeToClose } from "@/web/features/timer/use-dismiss-popover";
import { useNow } from "@/web/hooks/use-now";
import { apiRequest, DEVELOPMENT_IDENTITIES, setDevelopmentIdentity, signOut } from "@/web/lib/api";
import { formatClockDuration } from "@/web/lib/format";
import type { TimeEntry } from "@/web/types";

interface NavigationItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  /** Right-aligned element such as the running timer's pencil (Toggl's Timer item). */
  trailing?: ReactNode;
  /** Accessible name when the visible label is not the item name (running timer). */
  ariaLabel?: string;
}

/** Same payload as the timer bar's `["timer"]` query (read-only here). */
interface TimerQuery {
  entry: TimeEntry | null;
  server_now: string;
}

/**
 * Toggl's sidebar "Timer" item shows the live duration while an entry is running.
 * Reads the timer bar's own query so the two surfaces never disagree.
 */
function useRunningTimer(): { duration: string } | null {
  const now = useNow();
  const timer = useQuery({
    queryKey: ["timer"],
    queryFn: () => apiRequest<TimerQuery>("/timer"),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const entry = timer.data?.entry ?? null;
  if (!entry) return null;
  return { duration: formatClockDuration(now - new Date(entry.started_at).getTime()) };
}

export const SIDEBAR_WIDTH = 226;
export const SIDEBAR_RAIL_WIDTH = 47;

function initialsOf(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
}

export function Sidebar({
  collapsed = false,
  onToggleCollapsed,
  onNavigate,
}: {
  /** Desktop only: the 179px panel slides under the 47px rail. */
  collapsed?: boolean;
  /** Present on the desktop sidebar; the mobile drawer has no collapse toggle. */
  onToggleCollapsed?: () => void;
  onNavigate: () => void;
}) {
  const me = useMe();
  const runningTimer = useRunningTimer();
  // Toggl replaces the "Timer" label with the live duration plus a pencil icon while running.
  const track: NavigationItem[] = [
    runningTimer
      ? {
          to: "/time",
          label: runningTimer.duration,
          icon: Clock3,
          ariaLabel: `Timer running, ${runningTimer.duration}`,
          trailing: <Pencil size={14} aria-hidden className="shrink-0" />,
        }
      : { to: "/time", label: "Timer", icon: Clock3 },
  ];
  const analyze: NavigationItem[] = [{ to: "/reports", label: "Reports", icon: BarChart3 }];
  const manage: NavigationItem[] = [
    { to: "/projects", label: "Projects", icon: BriefcaseBusiness },
    { to: "/clients", label: "Clients", icon: Building2 },
    // Toggl's MANAGE order is Projects, Clients, Members, Tags.
    ...(me.permissions.view_team || me.permissions.manage_members
      ? [{ to: "/members", label: "Members", icon: Users }]
      : []),
    ...(me.permissions.manage_workspace ? [{ to: "/tags", label: "Tags", icon: Tags }] : []),
  ];
  const admin: NavigationItem[] = me.permissions.view_audit
    ? [{ to: "/administration", label: "Settings", icon: Settings }]
    : [];

  return (
    <aside
      className="text-fg relative h-full shadow-[1px_0_0_0_#3a3a3a] data-[animate=true]:transition-[width] data-[animate=true]:duration-200 data-[animate=true]:ease-in-out"
      data-animate={onToggleCollapsed ? "true" : "false"}
      data-collapsed={collapsed ? "true" : "false"}
      style={{ width: collapsed ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH }}
    >
      <div
        className="bg-sidenav absolute top-0 left-[47px] flex h-full w-[179px] flex-col transition-transform duration-200 ease-in-out"
        style={{ transform: collapsed ? "translateX(-181px)" : undefined }}
        inert={collapsed}
        aria-hidden={collapsed ? true : undefined}
      >
        <WorkspaceMenu collapsed={collapsed} onNavigate={onNavigate} />
        <nav
          className="flex min-h-0 flex-1 flex-col gap-6 overflow-x-clip overflow-y-auto py-6"
          aria-label="Primary navigation"
        >
          <NavigationGroup
            label="Track"
            items={track}
            onNavigate={onNavigate}
            className="w-[188px]"
          />
          <NavigationGroup
            label="Analyze"
            items={analyze}
            onNavigate={onNavigate}
            className="w-[188px]"
          />
          <NavigationGroup
            label="Manage"
            items={manage}
            onNavigate={onNavigate}
            className="w-[188px]"
          />
        </nav>
        {admin.length ? (
          <div className="pt-3 pb-[15px]">
            <NavigationGroup label="Admin" items={admin} onNavigate={onNavigate} />
          </div>
        ) : (
          <div className="pb-[15px]" />
        )}
      </div>

      <Rail collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} onNavigate={onNavigate} />
    </aside>
  );
}

function Rail({
  collapsed,
  onToggleCollapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onNavigate: () => void;
}) {
  const toggleLabel = collapsed ? "Open sidebar" : "Close sidebar";
  return (
    <div className="absolute inset-y-0 left-0 z-10 flex w-[47px] flex-col items-center justify-between bg-black pt-2 pb-4">
      <div className="h-[105px] w-full">
        <Link
          to="/time"
          aria-label="Hourlark home"
          onClick={onNavigate}
          className="flex h-[53px] w-full items-start justify-center pt-2"
        >
          <img
            src="/brand/hourlark-original/icon-48.png"
            alt=""
            width={24}
            height={24}
            className="size-6 shrink-0"
          />
        </Link>
      </div>

      {onToggleCollapsed ? (
        <div className="group relative">
          <button
            type="button"
            aria-label={toggleLabel}
            aria-keyshortcuts="H"
            onClick={onToggleCollapsed}
            className="text-fg-muted grid h-[34px] w-[47px] place-items-center"
          >
            <svg width="21" height="12" viewBox="0 0 21 12" fill="none" aria-hidden="true">
              <path
                d="M0 12V10.5H12.982V12H0Z M0 6.7V5.2H9.98613V6.7H0Z M0 1.5V0H12.982V1.5H0Z"
                fill="currentColor"
              />
              <path
                d="m 16.367078,1.275 -4.7184,4.725 4.6935,4.7 1.0735,-1.075 -3.62,-3.625 3.645,-3.65 z"
                fill="currentColor"
                transform={collapsed ? "translate(33.1 0) scale(-1 1)" : undefined}
              />
            </svg>
          </button>
          <div
            aria-hidden="true"
            className="border-stroke bg-surface text-fg pointer-events-none absolute top-1/2 left-[42px] z-20 hidden -translate-y-1/2 items-center gap-[5px] rounded-lg border p-[15px] text-xs leading-4 font-medium whitespace-nowrap shadow-[0_2px_6px_rgb(0_0_0/39%)] group-hover:flex group-focus-within:has-[:focus-visible]:flex"
          >
            {toggleLabel}
            <Kbd>H</Kbd>
          </div>
        </div>
      ) : (
        <div />
      )}

      <div className="flex h-[118px] w-full justify-center">
        <ProfileMenu onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="border-fg-subtle text-fg inline-flex rounded-md border px-[5px] py-[3px] text-center font-mono text-[11px] leading-[11px] font-normal shadow-[inset_0_-1px_0_#999]">
      {children}
    </kbd>
  );
}

function Avatar({ name, size }: { name: string; size: 26 | 40 }) {
  return (
    <span
      aria-hidden="true"
      className={
        size === 26
          ? "border-surface bg-accent text-fg-inverted grid size-[26px] place-items-center rounded-full border text-[9px] leading-[9px] font-bold uppercase"
          : "bg-accent text-fg-inverted grid size-10 shrink-0 place-items-center rounded-full text-xs leading-3 font-bold uppercase"
      }
    >
      {initialsOf(name)}
    </span>
  );
}

function WorkspaceMenu({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: () => void }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuOpen = open && !collapsed;
  const close = () => setOpen(false);
  useDismissPopover(root, close, undefined, menuOpen);
  useEscapeToClose(menuOpen, close);

  const name = me.workspace.company_name || me.workspace.app_name;
  const canOpenSettings = me.permissions.view_audit;

  return (
    <div ref={root} className="relative px-1.5 pt-2">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 text-left"
      >
        <span className="text-fg-strong min-w-0 flex-1 truncate text-base leading-[22.88px] font-semibold">
          {name}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={menuOpen ? "shrink-0 rotate-180" : "shrink-0"}
        >
          <path d="M3 5h10l-5 6z" fill="#b1b1b1" />
        </svg>
      </button>
      {menuOpen ? (
        <div
          role="menu"
          aria-label="Workspace"
          className="timer-popover absolute top-[calc(100%+4px)] left-1.5 z-30 w-[330px] max-w-[calc(100vw-61px)] p-1 shadow-[0_2px_6px_rgb(0_0_0/39%)]"
        >
          <div className="py-2">
            <div className="flex h-14 items-center gap-3 px-2">
              <span className="border-stroke bg-surface text-fg-disabled grid size-14 shrink-0 place-items-center rounded-full border">
                <Building2 size={24} aria-hidden="true" />
              </span>
              <p className="text-fg-strong min-w-0 flex-1 truncate text-base leading-6 font-semibold">
                {name}
              </p>
            </div>
            <div className="bg-stroke-secondary my-4 h-px" />
            <p className="text-fg-secondary px-2 text-xs leading-4 font-medium">
              Signed in as <strong className="font-semibold capitalize">{me.member.role}</strong> in{" "}
              {me.workspace.app_name}.
            </p>
            {canOpenSettings ? (
              <>
                <div className="bg-stroke-secondary my-4 h-px" />
                <Link
                  to="/administration"
                  role="menuitem"
                  onClick={() => {
                    close();
                    onNavigate();
                  }}
                  className="text-fg-strong hover:bg-surface-hover flex h-9 w-full items-center gap-2 rounded-lg border border-transparent px-4 text-sm leading-5 font-semibold"
                >
                  Settings
                </Link>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const profileItemClassName =
  "flex min-h-[30px] w-full items-center rounded-lg px-2.5 text-left text-sm leading-[30px] font-medium text-fg hover:bg-[rgb(250_250_250/5%)]";

function ProfileMenu({ onNavigate }: { onNavigate: () => void }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDismissPopover(root, close, undefined, open);
  useEscapeToClose(open, close);

  return (
    <div ref={root}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Profile"
        onClick={() => setOpen((value) => !value)}
        className="text-fg-muted flex w-[33px] flex-col items-center gap-1 py-1.5 leading-[14px]"
      >
        <Avatar name={me.member.displayName} size={26} />
        <span className="text-fg-muted text-left text-[8px] leading-2 font-medium uppercase">
          Profile
        </span>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Profile"
          className="timer-popover absolute bottom-[47px] left-[45px] z-30 w-60 px-1 pt-3.5 pb-[5px]"
        >
          <div className="flex h-10 items-center gap-2 px-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-fg-secondary truncate text-sm leading-[17px] font-medium">
                {me.member.displayName}
              </p>
              <p className="text-fg-subtle truncate text-xs leading-[17px] font-medium">
                {me.member.email}
              </p>
            </div>
            <Avatar name={me.member.displayName} size={40} />
          </div>
          <div className="bg-stroke my-2.5 h-px" />
          <p className="text-fg-subtle px-2.5 text-xs leading-[17px] font-medium">
            Time zone: {me.member.timezone}
          </p>
          {import.meta.env.DEV ? (
            <div className="border-stroke mt-2.5 border-t pt-2.5">
              <p className="text-fg-muted px-2.5 pb-1 text-[11px] leading-4 font-semibold tracking-[0.04em] uppercase">
                Development identity
              </p>
              <div className="flex flex-col gap-0.5">
                {DEVELOPMENT_IDENTITIES.map(({ email, label }) => (
                  <button
                    key={email}
                    type="button"
                    role="menuitem"
                    className="flex w-full flex-col justify-center rounded-lg px-2.5 py-1 text-left hover:bg-[rgb(250_250_250/5%)]"
                    onClick={() => setDevelopmentIdentity(email)}
                  >
                    <span className="text-fg text-sm leading-[17px] font-medium">{label}</span>
                    <span className="text-fg-subtle text-xs leading-[17px] font-medium">
                      {email}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {me.auth_mode === AuthMode.Google ? (
            <>
              <div className="bg-stroke my-2.5 h-px" />
              <button
                type="button"
                role="menuitem"
                className={profileItemClassName}
                onClick={() => {
                  close();
                  onNavigate();
                  void signOut();
                }}
              >
                <LogOut size={14} aria-hidden="true" className="mr-2" />
                Sign out
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NavigationGroup({
  label,
  items,
  onNavigate,
  className,
}: {
  label: string;
  items: NavigationItem[];
  onNavigate: () => void;
  /** Main groups are 188px wide like Toggl's overflowing nav sections; Admin stays 179px. */
  className?: string;
}) {
  return (
    <section className={className}>
      <h2 className="text-fg-muted mb-2 px-4 text-[11px] leading-4 font-semibold tracking-[0.04em] uppercase">
        {label}
      </h2>
      <div className="flex flex-col gap-0.5">
        {items.map(({ to, label: itemLabel, icon: Icon, trailing, ariaLabel }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            aria-label={ariaLabel}
            className="text-fg-muted block leading-[14px]"
          >
            {({ isActive }) => (
              <span
                className={[
                  "mx-2.5 flex h-7 items-center gap-3 rounded-md px-1.5 text-sm leading-5 font-medium",
                  isActive
                    ? "bg-nav-selected text-accent-fg-active"
                    : "text-fg-muted hover:bg-sidenav-hover hover:text-fg-soft",
                ].join(" ")}
              >
                <Icon size={14} aria-hidden />
                <span className="flex-1">{itemLabel}</span>
                {trailing}
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </section>
  );
}
