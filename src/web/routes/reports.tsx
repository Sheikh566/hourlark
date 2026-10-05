import { useQuery } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useMe } from "@/web/app/context";
import { Badge, Button, ErrorState, Field, Input, Modal, Select } from "@/web/components/ui";
import { ReportFilterBar, type ReportFilters } from "@/web/features/reports/report-filter-bar";
import { ReportDateFilter } from "@/web/features/reports/report-date-filter";
import {
  addCalendarDays,
  exclusiveEndIso,
  inclusiveDayCount,
  startOfWeekDate,
  zonedDayStartIso,
  zonedToday,
} from "@/web/features/timer/list-date-range";
import { apiDownload, apiRequest } from "@/web/lib/api";
import { formatDuration, formatMoney } from "@/web/lib/format";
import type { Client, Member, Project, Tag } from "@/web/types";

interface SummaryGroup {
  key: string;
  label: string;
  rawDurationMs: number;
  roundedDurationMs: number;
  billableDurationMs: number;
  nonBillableDurationMs: number;
  amounts?: Record<string, number>;
  percentOfTotal: number;
  budgetMinutes?: number;
  children?: SummaryGroup[];
}

interface SummaryReport {
  generated_at: string;
  timezone: string;
  totals: {
    tracked_duration_ms: number;
    billable_duration_ms: number;
    non_billable_duration_ms: number;
    amounts?: Record<string, number>;
  };
  groups: SummaryGroup[];
}

interface DetailedRow {
  id: string;
  date: string;
  member: { id: string; name: string };
  client: { id: string | null; name: string };
  project: { id: string | null; name: string; color: string | null };
  description: string;
  tags: Tag[];
  local_start: string;
  local_stop: string | null;
  raw_duration_ms: number;
  rounded_duration_ms: number;
  billable: boolean;
  running: boolean;
  rate_minor?: number | null;
  currency?: string | null;
  amount_minor?: number | null;
}

const chartColors = ["#f59e0b", "#56b4e9", "#e69f00", "#009e73", "#f0e442", "#cc79a7"];
export function ReportsPage() {
  const me = useMe();
  const weekStartsOn = me.workspace.week_start === "monday" ? 1 : 0;
  const initialToday = zonedToday(new Date(), me.member.timezone);
  const initialWeek = startOfWeekDate(initialToday, weekStartsOn);
  const [mode, setMode] = useState<"summary" | "detailed">("summary");
  const [start, setStart] = useState(initialWeek);
  const [end, setEnd] = useState(addCalendarDays(initialWeek, 6));
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [clientId, setClientId] = useState("");
  const [filters, setFilters] = useState<ReportFilters>({});
  const [groupBy, setGroupBy] = useState("project");
  const [secondary, setSecondary] = useState("");
  const [sort, setSort] = useState("started_desc");
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
  const dayCount = Math.max(1, inclusiveDayCount(start, end));
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

  return (
    <>
      <h1 className="sr-only">Reports</h1>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[#3b3b3b] pb-0 pl-10 md:pl-0">
        <div className="flex items-center gap-5" role="tablist" aria-label="Report view">
          {(["summary", "detailed"] as const).map((value) => (
            <button
              key={value}
              role="tab"
              aria-selected={mode === value}
              type="button"
              className={`border-b-2 px-1 py-4 text-sm font-semibold capitalize ${mode === value ? "border-[#f59e0b] text-[#fbbf24]" : "border-transparent text-[#a4a4a4] hover:text-[#fafafa]"}`}
              onClick={() => {
                setMode(value);
                setCursor("");
              }}
            >
              {value === "summary" ? "Summary" : "Detailed"}
            </button>
          ))}
        </div>
        {me.permissions.export ? (
          <div className="flex gap-2 pb-3">
            <Button variant="secondary" disabled={exporting} onClick={() => void downloadCsv()}>
              <Download size={15} /> {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setExportError("");
                setPdfOpen(true);
              }}
            >
              <FileText size={15} /> Time Report PDF
            </Button>
          </div>
        ) : null}
      </div>
      {exportError ? (
        <p role="alert" className="mb-3 text-sm text-red-300">
          {exportError}
        </p>
      ) : null}
      <section className="mb-5 border-b border-[#3b3b3b] pb-3">
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
      </section>
      {summary.error ? (
        <ErrorState message={summary.error.message} onRetry={() => void summary.refetch()} />
      ) : mode === "summary" ? (
        <SummaryContent
          report={summary.data}
          daily={daily.data}
          dailyError={daily.error?.message}
          dayCount={dayCount}
          financial={me.permissions.financial}
          groupBy={groupBy}
          secondary={secondary}
          onGroupChange={(value) => {
            setGroupBy(value);
            if (secondary === value) setSecondary("");
          }}
          onSecondaryChange={setSecondary}
        />
      ) : (
        <div className="space-y-3">
          <ReportMetrics
            report={summary.data}
            financial={me.permissions.financial}
            dayCount={dayCount}
          />
          {detailed.error ? (
            <ErrorState message={detailed.error.message} onRetry={() => void detailed.refetch()} />
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Select
              className="w-48"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setCursor("");
              }}
              aria-label="Detailed report sort"
            >
              <option value="started_desc">Newest first</option>
              <option value="started_asc">Oldest first</option>
              <option value="duration_desc">Longest first</option>
            </Select>
            <div className="flex gap-2">
              {cursor ? (
                <Button variant="secondary" onClick={() => setCursor("")}>
                  First page
                </Button>
              ) : null}
              <Button
                variant="secondary"
                disabled={!detailed.data?.next_cursor}
                onClick={() => setCursor(detailed.data?.next_cursor ?? "")}
              >
                Next page
              </Button>
            </div>
          </div>
          <DetailedContent
            rows={detailed.data?.entries ?? []}
            loading={detailed.isLoading}
            financial={me.permissions.financial}
          />
        </div>
      )}

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
              onChange={(event) => {
                const otherFilters = { ...filters };
                delete otherFilters.project;
                delete otherFilters.client;
                const id = event.target.value;
                changeFilters(
                  id
                    ? { ...otherFilters, client: { condition: "is", values: [id] } }
                    : otherFilters,
                );
                setClientId(id);
                setPdfProjectIds([]);
              }}
            >
              <option value="">Select a client</option>
              {(clients.data?.clients ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Projects" hint="Leave empty to include every project for the client.">
            <Select
              multiple
              className="min-h-28"
              value={pdfProjectIds}
              onChange={(event) =>
                setPdfProjectIds(
                  [...event.currentTarget.selectedOptions].map((option) => option.value),
                )
              }
            >
              {(projects.data?.projects ?? [])
                .filter((project) => project.client_id === clientId)
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
            </Select>
          </Field>
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
              onChange={(event) => setPdfGrouping(event.target.value as typeof pdfGrouping)}
            >
              <option value="project">Project</option>
              <option value="date">Date</option>
            </Select>
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
    </>
  );
}

function ReportMetrics({
  report,
  financial,
  dayCount,
}: {
  report?: SummaryReport;
  financial: boolean;
  dayCount: number;
}) {
  const cards = [
    ["Total Hours", report ? formatDuration(report.totals.tracked_duration_ms) : "—"],
    ["Billable Hours", report ? formatDuration(report.totals.billable_duration_ms) : "—"],
    ...(financial
      ? [
          [
            "Amount",
            report
              ? Object.entries(report.totals.amounts ?? {})
                  .map(([currency, amount]) => formatMoney(amount, currency))
                  .join(" · ") || "No rate"
              : "—",
          ],
        ]
      : []),
    [
      "Average Daily Hours",
      report ? formatDuration(report.totals.tracked_duration_ms / dayCount) : "—",
    ],
  ];
  return (
    <div
      aria-label="Report totals"
      className="flex flex-wrap gap-x-10 gap-y-4 border-b border-[#3b3b3b] px-1 pb-5"
    >
      {cards.map(([label, value]) => (
        <div key={label}>
          <p className="text-xs font-medium text-[#a4a4a4]">{label}</p>
          <p
            className="mt-2 text-2xl font-semibold text-[#fafafa]"
            title={
              label === "Average Daily Hours"
                ? `Average across ${dayCount} calendar days in the selected period`
                : undefined
            }
          >
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}

function SummaryContent({
  report,
  daily,
  dailyError,
  financial,
  dayCount,
  groupBy,
  secondary,
  onGroupChange,
  onSecondaryChange,
}: {
  report?: SummaryReport;
  daily?: SummaryReport;
  dailyError?: string;
  financial: boolean;
  dayCount: number;
  groupBy: string;
  secondary: string;
  onGroupChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
}) {
  if (!report)
    return <div className="h-80 animate-pulse rounded-lg bg-white/5" aria-label="Loading report" />;
  const dimensionLabel = (groupBy[0]?.toUpperCase() ?? "") + groupBy.slice(1);
  const days = [...(daily?.groups ?? [])].sort((left, right) => left.key.localeCompare(right.key));
  return (
    <div className="space-y-5">
      <ReportMetrics report={report} financial={financial} dayCount={dayCount} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section className="panel p-5">
          <h2 className="mb-4 text-sm font-semibold">Duration by day</h2>
          {dailyError ? (
            <p role="alert" className="text-sm text-red-300">
              {dailyError}
            </p>
          ) : !daily ? (
            <div className="h-64 animate-pulse bg-white/5" aria-label="Loading daily duration" />
          ) : days.length === 0 ? (
            <ReportEmpty />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={days}>
                  <CartesianGrid vertical={false} stroke="#3b3b3b" />
                  <XAxis
                    dataKey="key"
                    tick={{ fill: "#a4a4a4", fontSize: 11 }}
                    tickFormatter={(value: string) => value.slice(5)}
                  />
                  <YAxis
                    tick={{ fill: "#a4a4a4", fontSize: 11 }}
                    tickFormatter={(value: number) => `${Math.round(value / 360_000) / 10}h`}
                    width={40}
                  />
                  <Tooltip
                    formatter={(value) => formatDuration(Number(value))}
                    contentStyle={{
                      background: "#212121",
                      border: "1px solid #3b3b3b",
                      color: "#fafafa",
                    }}
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  />
                  <Bar dataKey="rawDurationMs" name="Tracked" fill="#f59e0b" maxBarSize={42} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
        <section className="panel p-5">
          <h2 className="mb-4 text-sm font-semibold">{dimensionLabel} distribution</h2>
          {!report.groups.length ? (
            <ReportEmpty />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={report.groups}
                    dataKey="rawDurationMs"
                    nameKey="label"
                    innerRadius={68}
                    outerRadius={104}
                    paddingAngle={2}
                  >
                    {report.groups.map((group, index) => (
                      <Cell key={group.key} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => formatDuration(Number(value))}
                    contentStyle={{
                      background: "#212121",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 8,
                      color: "#e2e8f0",
                    }}
                    itemStyle={{ color: "#fafafa" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#3b3b3b] px-4 py-3">
          <h2 className="text-sm font-semibold">
            {dimensionLabel}
            {secondary ? ` and ${secondary}` : ""} breakdown
          </h2>
          <div className="flex flex-wrap gap-2">
            <Select
              className="h-8 min-h-8 w-auto text-xs"
              aria-label="Primary group"
              value={groupBy}
              onChange={(event) => onGroupChange(event.target.value)}
            >
              {["client", "project", "member", "day", "week", "month", "description"].map(
                (value) => (
                  <option key={value} value={value}>
                    Breakdown by: {value}
                  </option>
                ),
              )}
            </Select>
            <Select
              className="h-8 min-h-8 w-auto text-xs"
              aria-label="Secondary group"
              value={secondary}
              onChange={(event) => onSecondaryChange(event.target.value)}
            >
              <option value="">and: None</option>
              {["client", "project", "member", "day", "week", "month", "description"]
                .filter((value) => value !== groupBy)
                .map((value) => (
                  <option key={value} value={value}>
                    and: {value}
                  </option>
                ))}
            </Select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Group</th>
                <th className="px-4 py-3 text-right">Tracked</th>
                <th className="px-4 py-3 text-right">Billable</th>
                <th className="px-4 py-3 text-right">Share</th>
                {financial ? <th className="px-4 py-3 text-right">Amount</th> : null}
              </tr>
            </thead>
            <tbody>
              {report.groups.map((group) => (
                <tr key={group.key} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium">
                    {group.children?.length ? (
                      <details>
                        <summary className="cursor-pointer">{group.label}</summary>
                        <div className="mt-2 grid gap-1 pl-3 text-xs font-normal text-slate-500">
                          {group.children.map((child) => (
                            <span key={child.key} className="flex justify-between gap-3">
                              <span>{child.label}</span>
                              <span>{formatDuration(child.rawDurationMs)}</span>
                            </span>
                          ))}
                        </div>
                      </details>
                    ) : (
                      group.label
                    )}
                    {group.budgetMinutes ? (
                      <div className="mt-2">
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-[#f59e0b]"
                            style={{
                              width: `${Math.min(
                                100,
                                (group.rawDurationMs / (group.budgetMinutes * 60_000)) * 100,
                              )}%`,
                            }}
                          />
                        </div>
                        <span className="text-[10px] font-normal text-slate-400">
                          {formatDuration(group.budgetMinutes * 60_000)} budget
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">{formatDuration(group.rawDurationMs)}</td>
                  <td className="px-4 py-3 text-right">
                    {formatDuration(group.billableDurationMs)}
                  </td>
                  <td className="px-4 py-3 text-right">{group.percentOfTotal.toFixed(1)}%</td>
                  {financial ? (
                    <td className="px-4 py-3 text-right">
                      {Object.entries(group.amounts ?? {})
                        .map(([currency, amount]) => formatMoney(amount, currency))
                        .join(" · ") || "—"}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ReportEmpty() {
  return (
    <div className="grid min-h-64 content-center gap-2 text-center">
      <p className="text-base font-semibold">Nothing to see here…</p>
      <p className="text-sm text-[#a4a4a4]">
        No time entries match. Try another date range or adjust your filters.
      </p>
    </div>
  );
}

function DetailedContent({
  rows,
  loading,
  financial,
}: {
  rows: DetailedRow[];
  loading: boolean;
  financial: boolean;
}) {
  if (loading) return <div className="h-80 animate-pulse rounded-xl bg-slate-200" />;
  if (!rows.length) return <ReportEmpty />;
  return (
    <section className="panel overflow-x-auto">
      <table className="w-full min-w-[1050px] text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
          <tr>
            <th className="px-4 py-3">Date / member</th>
            <th className="px-4 py-3">Client / project</th>
            <th className="px-4 py-3">Description</th>
            <th className="px-4 py-3">Start – stop</th>
            <th className="px-4 py-3 text-right">Raw</th>
            <th className="px-4 py-3 text-right">Rounded</th>
            {financial ? <th className="px-4 py-3 text-right">Amount</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-slate-100 align-top">
              <td className="px-4 py-3">
                <div className="font-medium">{row.date}</div>
                <div className="text-xs text-slate-500">{row.member.name}</div>
              </td>
              <td className="px-4 py-3">
                <div>{row.client.name}</div>
                <Badge color={row.project.color}>{row.project.name}</Badge>
              </td>
              <td className="max-w-xs px-4 py-3">
                <div className="truncate">{row.description}</div>
                <div className="mt-1 flex gap-1">
                  {row.tags.map((tag) => (
                    <Badge key={tag.id}>{tag.name}</Badge>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3 text-slate-600">
                {row.local_start.slice(11)} – {row.running ? "running" : row.local_stop?.slice(11)}
              </td>
              <td className="px-4 py-3 text-right">{formatDuration(row.raw_duration_ms)}</td>
              <td className="px-4 py-3 text-right">{formatDuration(row.rounded_duration_ms)}</td>
              {financial ? (
                <td className="px-4 py-3 text-right">
                  {row.currency && row.amount_minor !== null && row.amount_minor !== undefined
                    ? formatMoney(row.amount_minor, row.currency)
                    : "—"}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
