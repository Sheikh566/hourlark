import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  useChartWidth,
  useYAxisScale,
} from "recharts";

import { Select } from "@/web/components/ui";
import { ReportEmpty } from "@/web/features/reports/report-empty";
import {
  DIMENSION_LABELS,
  DIMENSION_SINGULAR,
  SLICE_DIMENSIONS,
  type GroupDimension,
  type SummaryGroup,
} from "@/web/features/reports/report-types";
import { addCalendarDays } from "@/web/features/timer/list-date-range";
import { formatAxisHours, formatClockDuration } from "@/web/lib/format";

export const CHART_HEIGHT = 344;
const Y_GUTTER = 48;
const X_AXIS_HEIGHT = 65;
/** Space above the plot so tall bars keep their value label (Toggl: 37px). */
const PLOT_TOP = 37;
const BAR_SIZE = 16;
const GRID = "#3a3a3a";
const LABEL = "#999999";
const NICE_STEPS_MIN = [
  1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 150, 180, 210, 240, 300, 360, 480, 600, 720, 1440,
];

export interface DayPoint {
  key: string;
  durationMs: number;
}

/** Every day of the range (zero days included) like Toggl; including long ranges. */
export function buildDayPoints(groups: SummaryGroup[], start: string, end: string): DayPoint[] {
  const byDay = new Map(groups.map((group) => [group.key, group.rawDurationMs]));
  const span = Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 864e5,
  );
  if (!Number.isFinite(span) || span < 0) {
    return [...byDay.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, durationMs]) => ({ key, durationMs }));
  }
  return Array.from({ length: span + 1 }, (_, index) => {
    const key = addCalendarDays(start, index);
    return { key, durationMs: byDay.get(key) ?? 0 };
  });
}

/** Six evenly spaced y ticks (0..5 steps); the step is the smallest "nice" duration that fits. */
export function niceTicks(maxMs: number): number[] {
  const rawMinutes = Math.max(maxMs, 0) / 60_000 / 5;
  const stepMinutes =
    NICE_STEPS_MIN.find((step) => step >= rawMinutes) ?? Math.ceil(rawMinutes / 1440) * 1440;
  return Array.from({ length: 6 }, (_, index) => index * stepMinutes * 60_000);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function weekday(key: string): string {
  return WEEKDAYS[new Date(`${key}T00:00:00Z`).getUTCDay()] ?? "";
}
export function dayLabel(key: string): string {
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}
export function fullDate(key: string): string {
  return `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;
}

/** Toggl's tooltip card (235 wide, r8, 1px #3a3a3a, 0 4px 16px). */
export function ReportTooltipCard({
  title,
  dotColor,
  value,
}: {
  title: ReactNode;
  dotColor: string;
  value: string;
}) {
  return (
    <div
      role="status"
      className="bg-surface border-stroke shadow-popover box-border grid w-[235px] gap-2 rounded-lg border p-4"
    >
      <div className="text-fg truncate text-sm leading-5 font-semibold">{title}</div>
      <div className="text-fg flex items-center gap-2 text-xs leading-4 font-medium">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor }}
          aria-hidden="true"
        />
        <span className="flex-1">Duration</span>
        <span>{value}</span>
      </div>
    </div>
  );
}

function DayTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: DayPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <ReportTooltipCard
      title={fullDate(point.key)}
      dotColor="var(--color-accent)"
      value={formatClockDuration(point.durationMs)}
    />
  );
}

/** Dashed horizontal grid that spans the whole chart including the y-label gutter. */
function DashedGrid({ ticks }: { ticks: number[] }) {
  const width = useChartWidth();
  const scale = useYAxisScale();
  if (!width || !scale) return null;
  return (
    <g aria-hidden="true">
      {ticks.map((tick) => {
        const y = scale(tick);
        return y === undefined ? null : (
          <line
            key={tick}
            x1={0}
            x2={width}
            y1={y}
            y2={y}
            stroke={GRID}
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        );
      })}
      <line x1={0} x2={width} y1={scale(0)} y2={scale(0)} stroke={GRID} strokeWidth={2} />
    </g>
  );
}

interface TickProps {
  x?: number | string;
  y?: number | string;
  payload?: { value?: unknown };
}

export function DurationByDayChart({
  days,
  error,
  loading,
}: {
  days: DayPoint[];
  error?: string;
  loading: boolean;
}) {
  if (error)
    return (
      <p role="alert" className="text-error-fg p-6 text-sm">
        {error}
      </p>
    );
  if (loading)
    return (
      <div
        className="h-[372px] animate-pulse rounded-lg bg-white/5"
        aria-label="Loading daily duration"
      />
    );
  if (!days.some((day) => day.durationMs > 0)) return <ReportEmpty />;
  const ticks = niceTicks(days.reduce((max, day) => Math.max(max, day.durationMs), 0));
  const every = days.length > 20 ? 1 : 0;
  return (
    <>
      <div style={{ height: CHART_HEIGHT }} role="img" aria-label="Duration by day">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={days}
            margin={{ top: PLOT_TOP, right: 0, bottom: 0, left: 0 }}
            barCategoryGap={0}
          >
            <YAxis
              width={Y_GUTTER}
              ticks={ticks}
              domain={[0, ticks[5] ?? 0]}
              axisLine={false}
              tickLine={false}
              tick={({ y, payload }: TickProps) => (
                <text
                  x={0}
                  y={Number(y ?? 0) - 11}
                  textAnchor="start"
                  dominantBaseline="middle"
                  fontSize={12}
                  fontWeight={500}
                  fill={LABEL}
                >
                  {formatAxisHours(Number(payload?.value ?? 0))}
                </text>
              )}
            />
            <XAxis
              dataKey="key"
              height={X_AXIS_HEIGHT}
              tickMargin={0}
              tickSize={0}
              interval={every}
              axisLine={false}
              tickLine={false}
              tick={({ x, y, payload }: TickProps) => {
                const key = typeof payload?.value === "string" ? payload.value : "";
                // Toggl: one rotated line, weekday bright and date grey, ending under the bar.
                return (
                  <g transform={`translate(${Number(x ?? 0)},${Number(y ?? 0) + 12})`}>
                    <text
                      textAnchor="end"
                      dominantBaseline="middle"
                      fontSize={12}
                      fontWeight={400}
                      fill={LABEL}
                      style={{ transform: "rotate(-45deg)" }}
                    >
                      <tspan fill="var(--color-fg)">{weekday(key)}</tspan>
                      <tspan dx={6}> {dayLabel(key)}</tspan>
                    </text>
                  </g>
                );
              }}
            />
            <DashedGrid ticks={ticks} />
            <Tooltip
              content={<DayTooltip />}
              cursor={false}
              isAnimationActive={false}
              allowEscapeViewBox={{ x: false, y: true }}
            />
            <Bar
              dataKey="durationMs"
              name="Duration"
              fill="var(--color-accent)"
              barSize={BAR_SIZE}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="durationMs"
                content={(props) => {
                  const { x, y, width, value } = props as {
                    x?: number;
                    y?: number;
                    width?: number;
                    value?: number;
                  };
                  const hours = (value ?? 0) / 3_600_000;
                  if (!hours) return null;
                  // Toggl keeps two significant digits ("17 h", "0.23 h").
                  const text = `${hours >= 100 ? Math.round(hours) : Number(hours.toPrecision(2))} h`;
                  const cx = (x ?? 0) + (width ?? 0) / 2;
                  // Toggl keeps 4px above flat labels and 8px above rotated ones.
                  const vertical = text.length * 5.6 > 30;
                  const top = (y ?? 0) - (vertical ? 8 : 6);
                  return (
                    <text
                      x={cx}
                      y={top}
                      fontSize={10}
                      fontWeight={500}
                      fill={LABEL}
                      textAnchor={vertical ? "start" : "middle"}
                      dominantBaseline={vertical ? "central" : "auto"}
                      transform={vertical ? `rotate(-90 ${cx} ${top})` : undefined}
                    >
                      {text}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex h-4 items-center justify-center gap-1.5 text-xs leading-4 font-medium">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect y="5" width="16" height="6" rx="1" fill="var(--color-accent)" />
        </svg>
        <span className="text-fg">
          Duration <span className="text-fg-subtle">(m)</span>
        </span>
      </div>
    </>
  );
}

export const SLICE_COLORS = ["#f59e0b", "#56b4e9", "#009e73", "#cc79a7", "#e69f00", "#f0e442"];
export const NO_PROJECT_COLOR = "#808080";

export interface Slice {
  key: string;
  label: string;
  durationMs: number;
  percent: number;
  color: string;
}

export function buildSlices(
  groups: SummaryGroup[],
  dimension: GroupDimension,
  colors: Map<string, string>,
): Slice[] {
  const total = groups.reduce((sum, group) => sum + group.rawDurationMs, 0);
  return groups
    .filter((group) => group.rawDurationMs > 0)
    .map((group, index) => ({
      key: group.key,
      label: group.label,
      durationMs: group.rawDurationMs,
      percent: total ? (group.rawDurationMs / total) * 100 : 0,
      color:
        colors.get(group.key) ??
        (dimension === "project"
          ? NO_PROJECT_COLOR
          : (SLICE_COLORS[index % SLICE_COLORS.length] ?? NO_PROJECT_COLOR)),
    }));
}

function SliceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Slice }>;
}) {
  const slice = payload?.[0]?.payload;
  if (!active || !slice) return null;
  return (
    <ReportTooltipCard
      title={slice.label}
      dotColor={slice.color}
      value={formatClockDuration(slice.durationMs)}
    />
  );
}

const RADIAN = Math.PI / 180;

export function ProjectDistribution({
  slices,
  dimension,
  totalMs,
  loading,
  error,
}: {
  slices: Slice[];
  dimension: GroupDimension;
  totalMs: number;
  loading: boolean;
  error?: string;
}) {
  if (loading)
    return (
      <div className="h-[344px] animate-pulse rounded-lg bg-white/5" aria-label="Loading slices" />
    );
  if (error)
    return (
      <p role="alert" className="text-error-fg p-6 text-sm">
        {error}
      </p>
    );
  if (!slices.length) return <ReportEmpty className="" />;
  return (
    <div className="flex min-h-[344px] flex-col items-center sm:h-[344px] sm:flex-row">
      <div className="relative h-[344px] w-[292px] max-w-full shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart role="img" aria-label={`${DIMENSION_LABELS[dimension]} distribution`}>
            <Pie
              data={slices}
              dataKey="durationMs"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={51.5}
              outerRadius={85.9}
              startAngle={90}
              endAngle={-270}
              cornerRadius={4}
              paddingAngle={0}
              stroke="var(--color-surface)"
              strokeWidth={1}
              isAnimationActive={false}
              labelLine={false}
              label={(props: {
                cx?: number;
                cy?: number;
                midAngle?: number;
                outerRadius?: number;
                percent?: number;
              }) => {
                // Recharts spreads the slice onto the label props, so `percent` is already 0-100.
                const percent = props.percent ?? 0;
                if (percent < 5) return null;
                const radius = (props.outerRadius ?? 0) + 18;
                const angle = props.midAngle ?? 0;
                const x = (props.cx ?? 0) + radius * Math.cos(-angle * RADIAN);
                const y = (props.cy ?? 0) + radius * Math.sin(-angle * RADIAN);
                return (
                  <text
                    x={x}
                    y={y}
                    fill="var(--color-fg)"
                    fontSize={14}
                    fontWeight={500}
                    textAnchor={x > (props.cx ?? 0) ? "start" : "end"}
                    dominantBaseline="central"
                  >
                    {Math.round(percent)}%
                  </text>
                );
              }}
            >
              {slices.map((slice) => (
                <Cell key={slice.key} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip content={<SliceTooltip />} isAnimationActive={false} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <div className="text-fg text-base leading-6 font-semibold">
            {formatClockDuration(totalMs)}
          </div>
          <div className="text-fg-subtle text-[10px] leading-3 font-semibold uppercase">
            {DIMENSION_SINGULAR[dimension]}
          </div>
        </div>
      </div>
      <ul className="max-h-[344px] min-w-0 flex-1 overflow-y-auto py-[5px] pl-2.5">
        {slices.map((slice) => (
          <li
            key={slice.key}
            className="flex h-5 items-center gap-2.5 text-sm leading-5 font-medium"
          >
            <span
              className="size-3 shrink-0 rounded"
              style={{ backgroundColor: slice.color }}
              aria-hidden="true"
            />
            <span className="text-fg min-w-0 truncate" title={slice.label}>
              {slice.label}
            </span>
            <span className="text-fg-subtle shrink-0">{slice.percent.toFixed(2)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SliceBySelect({
  value,
  onChange,
}: {
  value: GroupDimension;
  onChange: (value: GroupDimension) => void;
}) {
  return (
    <Select
      aria-label="Slice by"
      tone="accent"
      labelPrefix="Slice by:"
      // Toggl's select trigger text is `white-space: normal`; the shared Select's truncate makes it
      // nowrap, so undo it locally (no visual change with these short labels).
      className="h-9 w-[175px] [&_span]:whitespace-normal"
      value={value}
      onValueChange={(next) => onChange(next as GroupDimension)}
      options={SLICE_DIMENSIONS.map((dimension) => ({
        value: dimension,
        label: DIMENSION_LABELS[dimension],
      }))}
    />
  );
}
