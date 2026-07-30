import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronDown,
  Clock3,
  Menu,
  Settings,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { twMerge } from "tailwind-merge";

import { useMe } from "@/web/app/context";
import { Button } from "@/web/components/ui";
import { setDevelopmentIdentity } from "@/web/lib/api";

const baseNavigation = [
  { to: "/time", label: "Time", icon: Clock3 },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/projects", label: "Projects", icon: BriefcaseBusiness },
  { to: "/clients", label: "Clients", icon: Building2 },
] as const;

export function AppLayout() {
  const me = useMe();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const navigation = [
    ...baseNavigation,
    ...(me.permissions.view_team || me.permissions.manage_members
      ? [{ to: "/members", label: "Members", icon: Users } as const]
      : []),
    ...(me.permissions.view_audit
      ? [{ to: "/administration", label: "Administration", icon: Settings } as const]
      : []),
  ];

  const sidebar = (
    <aside className="from-willow-green-950 to-willow-green-800 flex h-full w-64 flex-col bg-gradient-to-b text-white">
      <div className="flex h-16 items-center border-b border-white/15 px-5">
        <div className="bg-light-green-400 text-light-green-950 mr-3 grid h-8 w-8 place-items-center rounded-lg font-black">
          IT
        </div>
        <span className="font-bold tracking-tight">{me.workspace.app_name}</span>
      </div>
      <nav className="flex-1 space-y-1 p-3" aria-label="Primary navigation">
        {navigation.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              twMerge(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white",
                isActive && "border border-white/15 bg-white/12 text-white shadow-sm",
              )
            }
          >
            <Icon size={18} aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/15 p-4 text-xs text-white/65">
        Internal company workspace
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="fixed inset-y-0 left-0 z-30 hidden md:block">{sidebar}</div>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-slate-950/50"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-64">{sidebar}</div>
        </div>
      ) : null}

      <div className="md:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:px-6">
          <Button
            variant="ghost"
            className="h-10 w-10 p-0 md:hidden"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMobileOpen((value) => !value)}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </Button>
          <div className="hidden text-xs font-medium tracking-wide text-slate-400 uppercase md:block">
            {me.workspace.company_name} · {me.workspace.timezone}
          </div>
          <div className="relative">
            <button
              className="flex items-center gap-2 rounded-lg p-1.5 text-left hover:bg-slate-100"
              onClick={() => setUserOpen((value) => !value)}
              aria-expanded={userOpen}
            >
              <span className="bg-frosted-mint-700 grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white">
                {me.member.displayName
                  .split(" ")
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <span className="hidden sm:block">
                <span className="block text-sm font-semibold text-slate-800">
                  {me.member.displayName}
                </span>
                <span className="block text-xs text-slate-500 capitalize">{me.member.role}</span>
              </span>
              <ChevronDown size={15} className="text-slate-400" />
            </button>
            {userOpen ? (
              <div className="panel absolute top-12 right-0 w-64 p-2 shadow-xl">
                <div className="border-b border-slate-100 p-2">
                  <p className="truncate text-sm font-medium">{me.member.email}</p>
                  <p className="text-xs text-slate-500">{me.member.timezone}</p>
                </div>
                {import.meta.env.DEV ? (
                  <div className="p-2">
                    <p className="mb-2 text-xs font-semibold text-slate-500 uppercase">
                      Development role
                    </p>
                    {[
                      "sheikh.abdullah@iomechs.com",
                      "manager@iomechs.com",
                      "member@iomechs.com",
                    ].map((email) => (
                      <button
                        key={email}
                        className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100"
                        onClick={() => setDevelopmentIdentity(email)}
                      >
                        {email}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
