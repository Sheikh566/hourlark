import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { twMerge } from "tailwind-merge";

import { Sidebar } from "@/web/app/sidebar";
import { useSidebarCollapsed } from "@/web/app/sidebar-state";
import { Button } from "@/web/components/ui";
import { GlobalTimerBar } from "@/web/features/timer/global-timer";

export function AppLayout() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const content = useRef<HTMLElement>(null);
  // Toggl shows the timer bar only on the Timer page; other screens use their own page header.
  const showTimerBar = location.pathname === "/time";
  const edgeToEdge = location.pathname !== "/reports";

  useEffect(() => {
    if (content.current) content.current.scrollTop = 0;
  }, [location.pathname]);

  return (
    <div className="app-shell bg-surface text-fg h-dvh overflow-hidden">
      <div className="fixed inset-y-0 left-0 z-30 hidden md:block">
        <Sidebar
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onNavigate={() => setMobileOpen(false)}
        />
      </div>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/70"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-[226px]">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}

      <div
        className={twMerge(
          "flex h-full min-w-0 flex-col md:transition-[padding-left] md:duration-200 md:ease-in-out",
          collapsed ? "md:pl-[47px]" : "md:pl-[226px]",
          !showTimerBar && "[&>.global-timer]:hidden",
        )}
      >
        <Button
          variant="ghost"
          className="bg-surface/90 text-fg fixed top-4 left-2 z-30 h-10 w-10 p-0 md:hidden"
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setMobileOpen((value) => !value)}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </Button>
        <GlobalTimerBar />
        <main
          ref={content}
          className={twMerge(
            "min-h-0 w-full flex-1 overflow-y-auto",
            edgeToEdge ? "p-0" : "p-4 md:p-6",
          )}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
