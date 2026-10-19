import { averageDailyDurationMs } from "@/domain/reports/averages";
import { formatDecimalHours, formatMoney, formatReportDuration } from "@/web/lib/format";
import type { SummaryReport } from "@/web/features/reports/report-types";

/**
 * Toggl's metrics card: four equal columns split by 1px dividers. Labels are 14/600, values 16/600
 * with "-" for nothing tracked and a grey "Hours" unit after the average.
 */
export function ReportMetrics({
  report,
  financial,
  trackedDays,
}: {
  report?: SummaryReport;
  financial: boolean;
  /** Fallback when the server does not report `tracked_days` (derived from the day series). */
  trackedDays?: number;
}) {
  const days = report?.totals.tracked_days ?? trackedDays ?? 0;
  const amounts = report
    ? Object.entries(report.totals.amounts ?? {})
        .filter(([, amount]) => amount !== 0)
        .map(([currency, amount]) => formatMoney(amount, currency))
        .join(" · ")
    : "";
  const average = report ? averageDailyDurationMs(report.totals.tracked_duration_ms, days) : 0;
  const cards: Array<{ label: string; value: string; unit?: string; title?: string }> = [
    {
      label: "Total hours",
      value: report ? formatReportDuration(report.totals.tracked_duration_ms) : "-",
    },
    {
      label: "Billable hours",
      value: report ? formatReportDuration(report.totals.billable_duration_ms) : "-",
    },
    ...(financial ? [{ label: "Amount", value: amounts || "-" }] : []),
    {
      label: "Average daily hours",
      value: formatDecimalHours(average),
      unit: "Hours",
      title: `Average across the ${days} ${days === 1 ? "day" : "days"} with tracked time`,
    },
  ];
  return (
    <div
      aria-label="Report totals"
      className="report-surface bg-surface box-border flex min-w-0 flex-col gap-3 rounded-lg border border-transparent p-3 leading-[14px]"
    >
      <div
        className={`grid w-full grid-cols-2 gap-y-3 px-3 sm:gap-x-[57px] ${financial ? "sm:grid-cols-[repeat(4,18%)]" : "sm:grid-cols-[repeat(3,18%)]"}`}
      >
        {cards.map((card, index) => (
          <div key={card.label} className="relative grid min-w-0 gap-1" title={card.title}>
            {index > 0 ? (
              <span
                aria-hidden="true"
                className="bg-stroke absolute top-0 -left-[29px] hidden h-12 w-px sm:block"
              />
            ) : null}
            <h5 className="text-fg text-sm leading-5 font-semibold whitespace-nowrap capitalize">
              {card.label}
            </h5>
            <h4 className="text-fg text-base leading-6 font-semibold whitespace-nowrap">
              {card.value}
              {card.unit ? <b className="text-fg-subtle ml-1 font-semibold">{card.unit}</b> : null}
            </h4>
          </div>
        ))}
      </div>
    </div>
  );
}
