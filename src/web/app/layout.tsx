import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronDown,
  Clock3,
  Menu,
  Settings,
  Tags,
  Users,
  X,
} from "lucide-react";
import { useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { twMerge } from "tailwind-merge";

import { useMe } from "@/web/app/context";
import { Button } from "@/web/components/ui";
import { GlobalTimerBar } from "@/web/features/timer/global-timer";
import { setDevelopmentIdentity } from "@/web/lib/api";

interface NavigationItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
}

export function AppLayout() {
  const me = useMe();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const track: NavigationItem[] = [
    { to: "/time", label: "Time", icon: Clock3 },
    { to: "/calendar", label: "Calendar", icon: CalendarDays },
  ];
  const analyze: NavigationItem[] = [{ to: "/reports", label: "Reports", icon: BarChart3 }];
  const manage: NavigationItem[] = [
    { to: "/projects", label: "Projects", icon: BriefcaseBusiness },
    { to: "/clients", label: "Clients", icon: Building2 },
    ...(me.permissions.manage_workspace ? [{ to: "/tags", label: "Tags", icon: Tags }] : []),
    ...(me.permissions.view_team || me.permissions.manage_members
      ? [{ to: "/members", label: "Members", icon: Users }]
      : []),
  ];
  const admin: NavigationItem[] = me.permissions.view_audit
    ? [{ to: "/administration", label: "Administration", icon: Settings }]
    : [];
  const edgeToEdge = location.pathname === "/time" || location.pathname === "/calendar";

  const sidebar = (
    <aside className="flex h-full w-[204px] flex-col border-r border-white/10 bg-[#0a0f09] text-white">
      <div className="relative border-b border-white/10 p-3">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-white/6"
          onClick={() => setUserOpen((value) => !value)}
          aria-expanded={userOpen}
        >
          <span className="bg-light-green-500 text-light-green-950 grid h-8 w-8 place-items-center rounded-lg text-xs font-black">
            {me.member.displayName
              .split(" ")
              .map((part) => part[0])
              .slice(0, 2)
              .join("")}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-slate-100">
              {me.member.displayName}
            </span>
            <span className="block truncate text-[10px] text-slate-400 capitalize">
              {me.member.role} · {me.workspace.app_name}
            </span>
          </span>
          <ChevronDown size={14} className="text-slate-500" />
        </button>
        {userOpen ? (
          <div className="timer-popover absolute top-14 left-3 z-50 w-64 p-2">
            <div className="border-b border-white/10 p-2">
              <p className="truncate text-sm font-medium text-slate-200">{me.member.email}</p>
              <p className="mt-0.5 text-xs text-slate-500">{me.member.timezone}</p>
            </div>
            {import.meta.env.DEV ? (
              <div className="p-1.5">
                <p className="px-2 py-1.5 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                  Development identity
                </p>
                {["sheikh.abdullah@iomechs.com", "manager@iomechs.com", "member@iomechs.com"].map(
                  (email) => (
                    <button
                      key={email}
                      className="block w-full rounded-md px-2 py-2 text-left text-xs text-slate-300 hover:bg-white/8 hover:text-white"
                      onClick={() => setDevelopmentIdentity(email)}
                    >
                      {email}
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Primary navigation">
        <NavigationGroup label="Track" items={track} onNavigate={() => setMobileOpen(false)} />
        <NavigationGroup label="Analyze" items={analyze} onNavigate={() => setMobileOpen(false)} />
        <NavigationGroup label="Manage" items={manage} onNavigate={() => setMobileOpen(false)} />
      </nav>

      {admin.length ? (
        <div className="border-t border-white/10 px-2 py-3">
          <NavigationGroup label="Admin" items={admin} onNavigate={() => setMobileOpen(false)} />
        </div>
      ) : (
        <div className="border-t border-white/10 px-4 py-3 text-[10px] text-slate-600">
          IOMechs internal workspace
        </div>
      )}
    </aside>
  );

  return (
    <div className="app-shell min-h-screen bg-[#0f150e] text-slate-200">
      <div className="fixed inset-y-0 left-0 z-30 hidden md:block">{sidebar}</div>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/70"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-[204px]">{sidebar}</div>
        </div>
      ) : null}

      <div className="min-h-screen md:pl-[204px]">
        <Button
          variant="ghost"
          className="fixed top-4 left-2 z-30 h-10 w-10 bg-[#111710]/90 p-0 text-slate-300 md:hidden"
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setMobileOpen((value) => !value)}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </Button>
        <GlobalTimerBar />
        <main
          className={twMerge("mx-auto w-full max-w-[1800px]", edgeToEdge ? "p-0" : "p-4 md:p-6")}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function NavigationGroup({
  label,
  items,
  onNavigate,
}: {
  label: string;
  items: NavigationItem[];
  onNavigate: () => void;
}) {
  return (
    <section className="mb-5 last:mb-0">
      <h2 className="px-2 pb-1.5 text-[10px] font-bold tracking-[0.12em] text-slate-600 uppercase">
        {label}
      </h2>
      <div className="space-y-0.5">
        {items.map(({ to, label: itemLabel, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              twMerge(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-slate-400 transition hover:bg-white/6 hover:text-slate-100",
                isActive &&
                  "bg-frosted-mint-900/80 text-frosted-mint-200 shadow-[inset_2px_0_0_#21de47]",
              )
            }
          >
            <Icon size={16} aria-hidden />
            {itemLabel}
          </NavLink>
        ))}
      </div>
    </section>
  );
}
