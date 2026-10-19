import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { useMe } from "@/web/app/context";
import { Button, ErrorState, Field, Input, Modal, Select } from "@/web/components/ui";
import { ReportBreakdown } from "@/web/features/reports/report-breakdown";
import { ReportCard, ReportCardHeader } from "@/web/features/reports/report-card";
import {
  buildDayPoints,
  buildSlices,
  DurationByDayChart,
  ProjectDistribution,
  SliceBySelect,
} from "@/web/features/reports/report-charts";
import { ReportDateFilter, describeRange } from "@/web/features/reports/report-date-filter";
import {
  ReportDetailedTable,
  type DetailedSort,
} from "@/web/features/reports/report-detailed-table";
import { ReportExportMenu } from "@/web/features/reports/report-export-menu";
import { ReportFilterBar, type ReportFilters } from "@/web/features/reports/report-filter-bar";
import { ReportMetrics } from "@/web/features/reports/report-metrics";
import type {
  DetailedRow,
  GroupDimension,
  SummaryReport,
} from "@/web/features/reports/report-types";
import {
  addCalendarDays,
  exclusiveEndIso,
  startOfWeekDate,
  zonedDayStartIso,
  zonedToday,
} from "@/web/features/timer/list-date-range";
import { apiDownload, apiRequest } from "@/web/lib/api";
import type { Client, Member, Project, Tag } from "@/web/types";

type ReportMode = "summary" | "detailed";
const REPORT_TABS: Array<{ value: ReportMode; label: string }> = [
  { value: "summary", label: "Summary" },
  { value: "detailed", label: "Detailed" },
];

export function ReportsPage() {
  const me = useMe();
  const weekStartsOn = me.workspace.week_start === "monday" ? 1 : 0;
  const initialToday = zonedToday(new Date(), me.member.timezone);
  const initialWeek = startOfWeekDate(initialToday, weekStartsOn);
  const [mode, setMode] = useState<ReportMode>("summary");
  const [start, setStart] = useState(initialWeek);
  const [end, setEnd] = useState(addCalendarDays(initialWeek, 6));
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [clientId, setClientId] = useState("");
  const [filters, setFilters] = useState<ReportFilters>({});
  const [groupBy, setGroupBy] = useState<GroupDimension>("project");
  const [sliceBy, setSliceBy] = useState<GroupDimension>("project");
  const [secondary, setSecondary] = useState<GroupDimension | "">("member");
  const [sort, setSort] = useState<DetailedSort>("started_desc");
  const [cursor, setCursor] = useState("");
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfTitle, setPdfTitle] = useState("Time Report");
  const [pdfReference, setPdfReference] = useState("");
  const [pdfNotes, setPdfNotes] = useState("");
  const [pdfProjectIds, setPdfProjectIds] = useState<string[]>([]);
  const [pdfShowMembers, setPdfShowMembers] = useState(me.workspace.report_show_members ?? true);
  const [pdfShowDescriptions, setPdfShowDescriptions] = useState(
    me.workspace.report_show_descriptions ?? true,
  );
  const [pdfShowTags, setPdfShowTags] = useState(me.workspace.report_show_tags ?? true);
  const [pdfShowRates, setPdfShowRates] = useState(true);
  const [pdfGrouping, setPdfGrouping] = useState<"project" | "date">("project");
  const projects = useQuery({
    queryKey: ["projects", "reports"],
    queryFn: () => apiRequest<{ projects: Project[] }>("/projects"),
  });
  const clients = useQuery({
    queryKey: ["clients", "reports"],
    queryFn: () => apiRequest<{ clients: Client[] }>("/clients"),
  });
  const pdfClientProjects = (projects.data?.projects ?? []).filter(
    (project) => project.client_id === clientId,
  );
  const tags = useQuery({
    queryKey: ["tags", "reports"],
    queryFn: () => apiRequest<{ tags: Tag[] }>("/tags"),
  });
  const members = useQuery({
    queryKey: ["members", "reports"],
    queryFn: () => apiRequest<{ members: Member[] }>("/members"),
    enabled: me.permissions.view_team,
  });

  const changeFilters = (next: ReportFilters) => {
    if (JSON.stringify(next.client) !== JSON.stringify(filters.client)) {
      setClientId(
        next.client?.condition === "is" && next.client.values.length === 1
          ? (next.client.values[0] ?? "")
          : "",
      );
      setPdfProjectIds([]);
    }
    setFilters(next);
  };
  const common = useMemo(() => {
    const query: Record<string, string> = {
      start: zonedDayStartIso(start, me.member.timezone),
      end: exclusiveEndIso(end, me.member.timezone),
      timezone: me.member.timezone,
      group_by: groupBy,
      ...(secondary ? { secondary_group_by: secondary } : {}),
    };
    for (const [key, parameter] of [
      ["member", "member_ids"],
      ["client", "client_ids"],
      ["project", "filter_project_ids"],
      ["tag", "tag_ids"],
    ] as const) {
      const filter = filters[key];
      if (!filter) continue;
      query[`${key}_condition`] = filter.condition;
      if (filter.condition === "is" && filter.values.length)
        query[parameter] = filter.values.join(",");
    }
    if (filters.description) {
      query.description_condition = filters.description.condition;
      if (filters.description.condition !== "is_empty")
        query.search = filters.description.text ?? "";
    }
    for (const key of ["billable", "running"] as const) {
      if (filters[key]?.values[0]) query[key] = filters[key].values[0];
    }
    return query;
  }, [filters, end, groupBy, me.member.timezone, secondary, start]);
  useEffect(() => setCursor(""), [common]);
  const searchParams = new URLSearchParams(common);
  const summary = useQuery({
    queryKey: ["reports", "summary", common],
    queryFn: () => apiRequest<SummaryReport>(`/reports/summary?${searchParams}`),
  });
  const detailed = useQuery({
    queryKey: ["reports", "detailed", common, cursor, sort],
    queryFn: () =>
      apiRequest<{
        entries: DetailedRow[];
        next_cursor: string | null;
        generated_at: string;
      }>(
        `/reports/detailed?${new URLSearchParams({
          ...common,
          page_size: "200",
          sort,
          ...(cursor ? { cursor } : {}),
        })}`,
      ),
    enabled: mode === "detailed",
  });

  const dailyParams: Record<string, string> = { ...common, group_by: "day" };
  delete dailyParams.secondary_group_by;
  const daily = useQuery({
    queryKey: ["reports", "summary", dailyParams],
    queryFn: () =>
      apiRequest<SummaryReport>(`/reports/summary?${new URLSearchParams(dailyParams)}`),
    enabled: mode === "summary",
  });
  const sliceParams: Record<string, string> = { ...common, group_by: sliceBy };
  delete sliceParams.secondary_group_by;
  const sameAsBreakdown = sliceBy === groupBy && !secondary;
  const slice = useQuery({
    queryKey: ["reports", "summary", sliceParams],
    queryFn: () =>
      apiRequest<SummaryReport>(`/reports/summary?${new URLSearchParams(sliceParams)}`),
    enabled: mode === "summary" && !sameAsBreakdown,
  });
  const sliceReport = sameAsBreakdown ? summary.data : slice.data;
  const projectColors = useMemo(
    () => new Map((projects.data?.projects ?? []).map((project) => [project.id, project.color])),
    [projects.data],
  );
  const days = useMemo(
    () => (daily.data ? buildDayPoints(daily.data.groups, start, end) : []),
    [daily.data, end, start],
  );
  const periodLabel = describeRange(start, end, initialToday, weekStartsOn);
  const exportCsv = () => apiDownload("/exports/csv", { ...common, mode }, `hourlark-${mode}.csv`);
  const downloadCsv = async () => {
    if (exporting) return;
    setExportError("");
    setExporting(true);
    try {
      await exportCsv();
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed. Try again.");
    } finally {
      setExporting(false);
    }
  };
  const exportPdf = async () => {
    if (!clientId || exporting) return;
    setExportError("");
    setExporting(true);
    try {
      await apiDownload(
        "/exports/pdf",
        {
          ...common,
          client_id: clientId,
          project_ids: pdfProjectIds,
          title: pdfTitle,
          reference: pdfReference || undefined,
          notes: pdfNotes || undefined,
          show_members: pdfShowMembers,
          show_descriptions: pdfShowDescriptions,
          show_tags: pdfShowTags,
          show_rates: me.permissions.financial && pdfShowRates,
          pdf_grouping: pdfGrouping,
        },
        "time-report.pdf",
      );
      setPdfOpen(false);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed. Try again.");
    } finally {
      setExporting(false);
    }
  };

  const tabs = (
    <div className="flex" role="tablist" aria-label="Report view">
      {REPORT_TABS.map(({ value, label }) => (
        <button
          key={value}
          role="tab"
          aria-selected={mode === value}
          type="button"
          className="text-fg-subtle hover:bg-surface-hover hover:text-fg-strong box-border inline-flex h-[30px] items-center justify-center rounded-lg px-3 py-1.5 text-start text-sm leading-5 font-semibold"
          onClick={() => {
            setMode(value);
            setCursor("");
          }}
        >
          {/* Toggl marks the active tab with a 2px rule in the accent colour (inactive: transparent)
              and leaves the unused sides border-style: none (Tailwind's preflight makes them solid). */}
          <span
            className={`flex items-baseline [border-width:0_0_2px_0] [border-style:none_none_solid_none] whitespace-nowrap ${
              mode === value
                ? "border-accent-fg text-accent-fg"
                : "border-fg-subtle border-b-transparent"
            }`}
          >
            {label}
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="bg-surface-secondary text-fg -m-4 min-h-screen md:-m-6">
      <header className="bg-surface shadow-card grid grid-cols-[minmax(0,1fr)] gap-2 pb-2">
        <div className="flex min-h-[66px] flex-wrap items-center gap-x-4 gap-y-2 px-5 pl-14 md:pl-5">
          <h1 className="text-fg text-base leading-6 font-semibold">Reports</h1>
          {tabs}
          {me.permissions.export ? (
            <div className="ml-auto flex items-center gap-[5px]">
              <ReportExportMenu
                exporting={exporting}
                onCsv={() => void downloadCsv()}
                onPdf={() => {
                  setExportError("");
                  setPdfOpen(true);
                }}
              />
            </div>
          ) : null}
        </div>
        <div className="px-5">
          <ReportFilterBar
            filters={filters}
            onChange={changeFilters}
            members={members.data?.members ?? []}
            clients={clients.data?.clients ?? []}
            projects={projects.data?.projects ?? []}
            tags={tags.data?.tags ?? []}
            canViewTeam={me.permissions.view_team}
            currentMemberName={me.member.displayName}
            loading={
              clients.isLoading ||
              projects.isLoading ||
              tags.isLoading ||
              (members.isLoading && me.permissions.view_team)
            }
            dateControl={
              <ReportDateFilter
                start={start}
                end={end}
                today={initialToday}
                weekStartsOn={weekStartsOn}
                onChange={(range) => {
                  setStart(range.start);
                  setEnd(range.end);
                }}
              />
            }
          />
        </div>
      </header>
      <div className="grid gap-4 p-6">
        {exportError ? (
          <p role="alert" className="text-error-fg text-sm">
            {exportError}
          </p>
        ) : null}
        {summary.error ? (
          <ErrorState message={summary.error.message} onRetry={() => void summary.refetch()} />
        ) : !summary.data ? (
          <div className="h-80 animate-pulse rounded-lg bg-white/5" aria-label="Loading report" />
        ) : (
          <>
            <ReportMetrics
              report={summary.data}
              financial={me.permissions.financial}
              trackedDays={daily.data?.groups.length}
            />
            {mode === "summary" ? (
              <>
                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1089fr)_minmax(0,536fr)]">
                  <ReportCard>
                    <ReportCardHeader title="Duration by day" />
                    <div className="px-3">
                      <DurationByDayChart
                        days={days}
                        error={daily.error?.message}
                        loading={!daily.data && !daily.error}
                      />
                    </div>
                  </ReportCard>
                  <ReportCard>
                    <ReportCardHeader
                      title={`${sliceBy === "project" ? "Project" : sliceBy.charAt(0).toUpperCase() + sliceBy.slice(1)} distribution`}
                    >
                      <SliceBySelect value={sliceBy} onChange={setSliceBy} />
                    </ReportCardHeader>
                    <div className="px-3">
                      <ProjectDistribution
                        slices={buildSlices(
                          sliceReport?.groups ?? [],
                          sliceBy,
                          sliceBy === "project" ? projectColors : new Map<string, string>(),
                        )}
                        dimension={sliceBy}
                        totalMs={sliceReport?.totals.tracked_duration_ms ?? 0}
                        loading={!sliceReport && !slice.error}
                        error={slice.error?.message}
                      />
                    </div>
                  </ReportCard>
                </div>
                <ReportBreakdown
                  report={summary.data}
                  groupBy={groupBy}
                  secondary={secondary}
                  colors={projectColors}
                  onGroupChange={(value) => {
                    setGroupBy(value);
                    if (secondary === value) setSecondary("");
                  }}
                  onSecondaryChange={setSecondary}
                />
              </>
            ) : (
              <>
                {detailed.error ? (
                  <ErrorState
                    message={detailed.error.message}
                    onRetry={() => void detailed.refetch()}
                  />
                ) : null}
                <ReportDetailedTable
                  rows={detailed.data?.entries ?? []}
                  loading={detailed.isLoading}
                  periodLabel={periodLabel}
                  sort={sort}
                  onSortChange={(value) => {
                    setSort(value);
                    setCursor("");
                  }}
                  hasPrevious={Boolean(cursor)}
                  hasNext={Boolean(detailed.data?.next_cursor)}
                  onFirstPage={() => setCursor("")}
                  onNextPage={() => setCursor(detailed.data?.next_cursor ?? "")}
                />
              </>
            )}
          </>
        )}
      </div>

      <Modal
        open={pdfOpen}
        onOpenChange={(open) => {
          if (!exporting) setPdfOpen(open);
        }}
        title="Client-ready Time Report"
        description="This produces a time report for attaching to an invoice; it is not an invoice."
        footer={
          <>
            <Button variant="secondary" disabled={exporting} onClick={() => setPdfOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!clientId || exporting} onClick={() => void exportPdf()}>
              {exporting ? "Generating…" : "Generate PDF"}
            </Button>
          </>
        }
      >
        <fieldset disabled={exporting} className="grid min-w-0 gap-4 border-0 p-0">
          {exportError ? (
            <p role="alert" className="rounded-lg bg-red-950/30 p-3 text-sm text-red-300">
              {exportError}
            </p>
          ) : null}
          <Field label="Client" hint="PDFs use one client and the current report filters.">
            <Select
              value={clientId}
              placeholder="Select a client"
              onValueChange={(id) => {
                const otherFilters = { ...filters };
                delete otherFilters.project;
                delete otherFilters.client;
                changeFilters(
                  id
                    ? { ...otherFilters, client: { condition: "is", values: [id] } }
                    : otherFilters,
                );
                setClientId(id);
                setPdfProjectIds([]);
              }}
              options={(clients.data?.clients ?? []).map((client) => ({
                value: client.id,
                label: client.name,
              }))}
            />
          </Field>
          <fieldset className="grid min-w-0 gap-1.5 border-0 p-0">
            <legend className="mb-1.5 text-sm font-medium text-[#a4a4a4]">Projects</legend>
            <div className="border-hourlark-control-border max-h-40 min-h-10 overflow-y-auto rounded-lg border bg-[#1b1b1b] p-1">
              {pdfClientProjects.length ? (
                pdfClientProjects.map((project) => (
                  <label
                    key={project.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-[#fafafa] hover:bg-white/7"
                  >
                    <input
                      type="checkbox"
                      checked={pdfProjectIds.includes(project.id)}
                      onChange={(event) =>
                        setPdfProjectIds((current) =>
                          event.target.checked
                            ? [...current, project.id]
                            : current.filter((id) => id !== project.id),
                        )
                      }
                    />
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: project.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{project.name}</span>
                  </label>
                ))
              ) : (
                <p className="px-2.5 py-1.5 text-sm text-[#a4a4a4]">
                  {clientId ? "This client has no projects." : "Select a client first."}
                </p>
              )}
            </div>
            <span className="text-xs text-[#a4a4a4]">
              Leave empty to include every project for the client.
            </span>
          </fieldset>
          <Field label="Report title">
            <Input value={pdfTitle} onChange={(event) => setPdfTitle(event.target.value)} />
          </Field>
          <Field label="Invoice or purchase-order reference">
            <Input value={pdfReference} onChange={(event) => setPdfReference(event.target.value)} />
          </Field>
          <Field label="Notes">
            <textarea
              className="min-h-24 rounded-lg border border-slate-300 p-3 text-sm"
              value={pdfNotes}
              onChange={(event) => setPdfNotes(event.target.value)}
            />
          </Field>
          <Field label="Group rows by">
            <Select
              value={pdfGrouping}
              onValueChange={(value) => setPdfGrouping(value as typeof pdfGrouping)}
              options={[
                { value: "project", label: "Project" },
                { value: "date", label: "Date" },
              ]}
            />
          </Field>
          <fieldset className="grid gap-2 rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold">Visible detail</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pdfShowMembers}
                onChange={(event) => setPdfShowMembers(event.target.checked)}
              />
              Member names
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pdfShowDescriptions}
                onChange={(event) => setPdfShowDescriptions(event.target.checked)}
              />
              Descriptions
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pdfShowTags}
                onChange={(event) => setPdfShowTags(event.target.checked)}
              />
              Tags
            </label>
            {me.permissions.financial ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={pdfShowRates}
                  onChange={(event) => setPdfShowRates(event.target.checked)}
                />
                Rates and amounts
              </label>
            ) : null}
          </fieldset>
        </fieldset>
      </Modal>
    </div>
  );
}
