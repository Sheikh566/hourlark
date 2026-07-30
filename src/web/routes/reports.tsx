import { useQuery } from "@tanstack/react-query";
import { addDays, startOfMonth, startOfWeek, subMonths, subWeeks } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { Download, FileText, Filter, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { useMe } from "@/web/app/context";
import {
  Badge,
  Button,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
} from "@/web/components/ui";
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

const chartColors = ["#36546D", "#FEB500", "#2A9D8F", "#7C5CFC", "#E76F51", "#8A9AA8"];

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function ReportsPage() {
  const me = useMe();
  const today = new Date();
  const weekStart = startOfWeek(today, {
    weekStartsOn: me.workspace.week_start === "monday" ? 1 : 0,
  });
  const [mode, setMode] = useState<"summary" | "detailed">("summary");
  const [start, setStart] = useState(dateOnly(weekStart));
  const [end, setEnd] = useState(dateOnly(addDays(weekStart, 7)));
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [tagId, setTagId] = useState("");
  const [billable, setBillable] = useState("");
  const [running, setRunning] = useState("");
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState("project");
  const [secondary, setSecondary] = useState("");
  const [sort, setSort] = useState("started_desc");
  const [cursor, setCursor] = useState("");
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfTitle, setPdfTitle] = useState("Time Report");
  const [pdfReference, setPdfReference] = useState("");
  const [pdfNotes, setPdfNotes] = useState("");
  const [pdfProjectIds, setPdfProjectIds] = useState<string[]>([]);
  const [pdfShowMembers, setPdfShowMembers] = useState(true);
  const [pdfShowDescriptions, setPdfShowDescriptions] = useState(true);
  const [pdfShowTags, setPdfShowTags] = useState(true);
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

  const common = useMemo(
    () => ({
      start: fromZonedTime(`${start}T00:00:00`, me.member.timezone).toISOString(),
      end: fromZonedTime(`${end}T00:00:00`, me.member.timezone).toISOString(),
      timezone: me.member.timezone,
      group_by: groupBy,
      ...(secondary ? { secondary_group_by: secondary } : {}),
      ...(clientId ? { client_id: clientId } : {}),
      ...(projectId ? { project_id: projectId } : {}),
      ...(memberId ? { member_id: memberId } : {}),
      ...(tagId ? { tag_id: tagId } : {}),
      ...(billable ? { billable } : {}),
      ...(running ? { running } : {}),
      ...(search ? { search } : {}),
    }),
    [
      billable,
      clientId,
      end,
      groupBy,
      me.member.timezone,
      memberId,
      projectId,
      running,
      search,
      secondary,
      start,
      tagId,
    ],
  );
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

  const setPreset = (preset: string) => {
    const now = new Date();
    if (preset === "today") {
      setStart(dateOnly(now));
      setEnd(dateOnly(addDays(now, 1)));
    } else if (preset === "yesterday") {
      setStart(dateOnly(addDays(now, -1)));
      setEnd(dateOnly(now));
    } else if (preset === "this_week") {
      const value = startOfWeek(now, {
        weekStartsOn: me.workspace.week_start === "monday" ? 1 : 0,
      });
      setStart(dateOnly(value));
      setEnd(dateOnly(addDays(value, 7)));
    } else if (preset === "last_week") {
      const value = subWeeks(
        startOfWeek(now, { weekStartsOn: me.workspace.week_start === "monday" ? 1 : 0 }),
        1,
      );
      setStart(dateOnly(value));
      setEnd(dateOnly(addDays(value, 7)));
    } else if (preset === "this_month") {
      const value = startOfMonth(now);
      setStart(dateOnly(value));
      setEnd(dateOnly(startOfMonth(addDays(value, 35))));
    } else if (preset === "last_month") {
      const value = startOfMonth(subMonths(now, 1));
      setStart(dateOnly(value));
      setEnd(dateOnly(startOfMonth(now)));
    }
  };

  const exportCsv = () =>
    apiDownload("/exports/csv", { ...common, mode }, `iomechs-time-${mode}.csv`);
  const exportPdf = async () => {
    if (!clientId) return;
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
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description="Analyze overlapping time within a precise half-open date range."
        actions={
          me.permissions.export ? (
            <>
              <Button variant="secondary" onClick={() => void exportCsv()}>
                <Download size={16} /> Export CSV
              </Button>
              <Button onClick={() => setPdfOpen(true)}>
                <FileText size={16} /> Time Report PDF
              </Button>
            </>
          ) : undefined
        }
      />

      <section className="panel mb-5 p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Filter size={17} className="text-brand-blue" />
          {(
            [
              ["today", "Today"],
              ["yesterday", "Yesterday"],
              ["this_week", "This week"],
              ["last_week", "Last week"],
              ["this_month", "This month"],
              ["last_month", "Last month"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              variant="ghost"
              className="min-h-8 px-2 py-1"
              onClick={() => setPreset(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Start">
            <Input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </Field>
          <Field label="End (exclusive)">
            <Input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          </Field>
          <Field label="Client">
            <Select value={clientId} onChange={(event) => setClientId(event.target.value)}>
              <option value="">All clients</option>
              {(clients.data?.clients ?? []).map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project">
            <Select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">All projects</option>
              {(projects.data?.projects ?? [])
                .filter((project) => !clientId || project.client_id === clientId)
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
            </Select>
          </Field>
          {me.permissions.view_team ? (
            <Field label="Member">
              <Select value={memberId} onChange={(event) => setMemberId(event.target.value)}>
                <option value="">All members</option>
                {(members.data?.members ?? []).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.display_name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Tag">
            <Select value={tagId} onChange={(event) => setTagId(event.target.value)}>
              <option value="">All tags</option>
              {(tags.data?.tags ?? []).map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Billing">
            <Select value={billable} onChange={(event) => setBillable(event.target.value)}>
              <option value="">All time</option>
              <option value="true">Billable</option>
              <option value="false">Non-billable</option>
            </Select>
          </Field>
          <Field label="Entry status">
            <Select value={running} onChange={(event) => setRunning(event.target.value)}>
              <option value="">Completed and running</option>
              <option value="false">Completed</option>
              <option value="true">Running</option>
            </Select>
          </Field>
          <Field label="Primary group">
            <Select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
              {["client", "project", "member", "day", "week", "month", "description"].map(
                (value) => (
                  <option key={value} value={value}>
                    {value[0]?.toUpperCase()}
                    {value.slice(1)}
                  </option>
                ),
              )}
            </Select>
          </Field>
          <Field label="Secondary group">
            <Select value={secondary} onChange={(event) => setSecondary(event.target.value)}>
              <option value="">None</option>
              {["client", "project", "member", "day", "week", "month", "description"]
                .filter((value) => value !== groupBy)
                .map((value) => (
                  <option key={value} value={value}>
                    {value[0]?.toUpperCase()}
                    {value.slice(1)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Description">
            <div className="relative">
              <Search className="absolute top-3 left-3 text-slate-400" size={15} />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </Field>
        </div>
      </section>

      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1">
        {(["summary", "detailed"] as const).map((value) => (
          <button
            key={value}
            className={`rounded-md px-4 py-2 text-sm font-semibold capitalize ${
              mode === value ? "bg-brand-blue text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
            onClick={() => setMode(value)}
          >
            {value}
          </button>
        ))}
      </div>

      {summary.error ? (
        <ErrorState message={summary.error.message} onRetry={() => void summary.refetch()} />
      ) : mode === "summary" ? (
        <SummaryContent report={summary.data} financial={me.permissions.financial} />
      ) : (
        <div className="space-y-3">
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
        onOpenChange={setPdfOpen}
        title="Client-ready Time Report"
        description="This produces a time report for attaching to an invoice; it is not an invoice."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPdfOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!clientId} onClick={() => void exportPdf()}>
              Generate PDF
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Client" hint="Select the client in the report filters before exporting.">
            <Select
              value={clientId}
              onChange={(event) => {
                setClientId(event.target.value);
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
        </div>
      </Modal>
    </>
  );
}

function SummaryContent({ report, financial }: { report?: SummaryReport; financial: boolean }) {
  if (!report) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="h-28 animate-pulse rounded-xl bg-slate-200" />
        ))}
      </div>
    );
  }
  const cards = [
    ["Total tracked", formatDuration(report.totals.tracked_duration_ms)],
    ["Billable", formatDuration(report.totals.billable_duration_ms)],
    ["Non-billable", formatDuration(report.totals.non_billable_duration_ms)],
    [
      "Amount",
      financial
        ? Object.entries(report.totals.amounts ?? {})
            .map(([currency, amount]) => formatMoney(amount, currency))
            .join(" · ") || "No rate"
        : "Hidden for your role",
    ],
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={label} className="panel p-4">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <section className="panel p-5">
          <h2 className="mb-4 font-bold text-slate-800">Time distribution</h2>
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
                <Tooltip formatter={(value) => formatDuration(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="panel overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 font-bold text-slate-800">
            Grouped summary
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
                              className="bg-brand-yellow h-full rounded-full"
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
