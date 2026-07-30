import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";

import { AppLayout } from "@/web/app/layout";
import { TimePage } from "@/web/routes/time";

const CalendarPage = lazy(() =>
  import("@/web/routes/calendar").then((module) => ({ default: module.CalendarPage })),
);
const ReportsPage = lazy(() =>
  import("@/web/routes/reports").then((module) => ({ default: module.ReportsPage })),
);
const ProjectsPage = lazy(() =>
  import("@/web/routes/projects").then((module) => ({ default: module.ProjectsPage })),
);
const ClientsPage = lazy(() =>
  import("@/web/routes/clients").then((module) => ({ default: module.ClientsPage })),
);
const MembersPage = lazy(() =>
  import("@/web/routes/members").then((module) => ({ default: module.MembersPage })),
);
const AdministrationPage = lazy(() =>
  import("@/web/routes/administration").then((module) => ({
    default: module.AdministrationPage,
  })),
);

export function AppRouter() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-56 items-center justify-center text-sm text-slate-500">
          Loading view…
        </div>
      }
    >
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/time" replace />} />
          <Route path="/time" element={<TimePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/administration" element={<AdministrationPage />} />
          <Route path="*" element={<Navigate to="/time" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
