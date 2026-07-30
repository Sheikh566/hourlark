import { formatLocal } from "@/domain/dates/time";
import type { ReportGroup, ReportRow } from "@/domain/reports/reporting";

function protectFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number | null): string {
  const text = protectFormula(value === null ? "" : String(value));
  return `"${text.replaceAll('"', '""')}"`;
}

function line(values: Array<string | number | null>): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}

export function detailedCsv(rows: ReportRow[], timezone: string): string {
  const headers = [
    "Entry ID",
    "Date",
    "Member",
    "Client",
    "Project",
    "Description",
    "Tags",
    "Start ISO",
    "Stop ISO",
    "Local Start",
    "Local Stop",
    "Raw Duration Seconds",
    "Rounded Duration Seconds",
    "Billable",
    "Rate Minor Units",
    "Currency",
    "Amount Minor Units",
    "Running",
  ];
  let output = line(headers);
  for (const row of rows) {
    output += line([
      row.id,
      row.date,
      row.memberName,
      row.clientName,
      row.projectName,
      row.description,
      row.tags.map((tag) => tag.name).join(", "),
      new Date(row.clippedStart).toISOString(),
      row.running ? null : new Date(row.clippedStop).toISOString(),
      formatLocal(row.clippedStart, timezone),
      row.running ? null : formatLocal(row.clippedStop, timezone),
      Math.round(row.rawDurationMs / 1000),
      Math.round(row.roundedDurationMs / 1000),
      row.billable ? "Yes" : "No",
      row.rateMinor,
      row.currency,
      row.amountMinor,
      row.running ? "Yes" : "No",
    ]);
  }
  return output;
}

export function summaryCsv(groups: ReportGroup[]): string {
  let output = line([
    "Group",
    "Tracked Seconds",
    "Rounded Seconds",
    "Billable Seconds",
    "Non-Billable Seconds",
    "Percent of Total",
    "Amounts by Currency",
  ]);
  for (const group of groups) {
    output += line([
      group.label,
      Math.round(group.rawDurationMs / 1000),
      Math.round(group.roundedDurationMs / 1000),
      Math.round(group.billableDurationMs / 1000),
      Math.round(group.nonBillableDurationMs / 1000),
      group.percentOfTotal.toFixed(2),
      Object.entries(group.amounts)
        .map(([currency, amount]) => `${currency} ${amount}`)
        .join("; "),
    ]);
  }
  return output;
}
