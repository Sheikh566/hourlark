export type CalendarMode = "week" | "workweek" | "day";

export const CALENDAR_MODES: ReadonlyArray<{ value: CalendarMode; label: string }> = [
  { value: "week", label: "Week view" },
  { value: "workweek", label: "5 days view" },
  { value: "day", label: "Day view" },
];

/** Toggl's grid group is always 60px tall; zoom changes how much time one group represents. */
export const CALENDAR_SLOT_HEIGHT = 60;

export interface CalendarZoomLevel {
  /** FullCalendar slotDuration (one labelled 60px group). */
  slot: string;
  /** FullCalendar snapDuration for drag/select/resize. */
  snap: string;
  minutes: number;
}

export const CALENDAR_ZOOM_LEVELS: readonly CalendarZoomLevel[] = [
  { slot: "02:00:00", snap: "00:15:00", minutes: 120 },
  { slot: "01:00:00", snap: "00:15:00", minutes: 60 },
  { slot: "00:30:00", snap: "00:15:00", minutes: 30 },
  { slot: "00:15:00", snap: "00:15:00", minutes: 15 },
  { slot: "00:05:00", snap: "00:05:00", minutes: 5 },
];

export const DEFAULT_CALENDAR_ZOOM = 3;
const ZOOM_STORAGE_KEY = "hourlark.calendar.zoom";

export function clampCalendarZoom(level: number): number {
  if (!Number.isFinite(level)) return DEFAULT_CALENDAR_ZOOM;
  return Math.min(CALENDAR_ZOOM_LEVELS.length - 1, Math.max(0, Math.round(level)));
}

export function readCalendarZoom(): number {
  try {
    const raw = window.localStorage.getItem(ZOOM_STORAGE_KEY);
    if (raw === null) return DEFAULT_CALENDAR_ZOOM;
    return clampCalendarZoom(Number(raw));
  } catch {
    return DEFAULT_CALENDAR_ZOOM;
  }
}

export function storeCalendarZoom(level: number): void {
  try {
    window.localStorage.setItem(ZOOM_STORAGE_KEY, String(clampCalendarZoom(level)));
  } catch {
    // Storage can be blocked; the zoom level then simply is not remembered.
  }
}

/** Pixels per hour at a zoom level (60px per slot). */
export function pixelsPerHour(level: number): number {
  const zoom = CALENDAR_ZOOM_LEVELS[clampCalendarZoom(level)];
  return (CALENDAR_SLOT_HEIGHT * 60) / (zoom?.minutes ?? 15);
}

const HEX = /^#?([0-9a-f]{6})$/i;

function parseHex(color: string | null | undefined): [number, number, number] | null {
  const match = color ? HEX.exec(color.trim()) : null;
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex(channels: [number, number, number]): string {
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

/** Toggl calendar surface (--background-primary); event tints are blended over it. */
export const CALENDAR_SURFACE = "#1b1b1b";
/** Toggl event fill without a project. */
export const CALENDAR_NO_PROJECT_FILL = "#343434";

/** Toggl event block: 20% project colour over the calendar surface; grey without a project. */
export function eventFillColor(projectColor: string | null | undefined): string {
  const project = parseHex(projectColor);
  const surface = parseHex(CALENDAR_SURFACE);
  if (!project || !surface) return CALENDAR_NO_PROJECT_FILL;
  return toHex([
    project[0] * 0.2 + surface[0] * 0.8,
    project[1] * 0.2 + surface[1] * 0.8,
    project[2] * 0.2 + surface[2] * 0.8,
  ]);
}

const PROJECT_TEXT_COLORS: Readonly<Record<string, string>> = {
  "#0b83d9": "#31a9ff",
  "#9e5bd9": "#c481ff",
  "#d94182": "#ff67a8",
  "#e36a00": "#ff861c",
  "#bf7000": "#f6aa3e",
  "#2da608": "#7dee5b",
  "#06a893": "#57efdb",
  "#c9806b": "#fab29e",
  "#465bb3": "#8b9ff2",
  "#990099": "#ea5dea",
  "#c7af14": "#f9e24a",
  "#566614": "#cbd993",
  "#d92b2b": "#ff5151",
  "#525266": "#c8c8d9",
  "#991102": "#ea6d5f",
};

const PROJECT_PICKER_TEXT_COLORS: Readonly<Record<string, string>> = {
  "#9e5bd9": "#c48bf6",
  "#d94182": "#f675ac",
  "#e36a00": "#f99136",
  "#2da608": "#87e769",
  "#c9806b": "#f2b5a3",
  "#465bb3": "#93a3eb",
  "#990099": "#e46be4",
  "#d92b2b": "#f66363",
  "#525266": "#c6c6d5",
  "#991102": "#e4796d",
};

/** Measured Toggl palette for calendar/project names and timesheet rows. */
export function projectTextColor(projectColor: string | null | undefined): string {
  const color = projectColor?.trim().toLowerCase();
  const measured = color ? PROJECT_TEXT_COLORS[color] : undefined;
  if (measured) return measured;
  const rgb = parseHex(projectColor);
  if (!rgb) return "#b7b7b7";
  // shortcut: Custom colours use an HSL lift; replace when their Toggl variants are measured.
  const [red, green, blue] = rgb.map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  const s = Math.max(saturation, 0.8);
  const l = 0.63;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - chroma / 2;
  const sector = Math.floor(hue / 60) % 6;
  const [r1, g1, b1] = (
    [
      [chroma, x, 0],
      [x, chroma, 0],
      [0, chroma, x],
      [0, x, chroma],
      [x, 0, chroma],
      [chroma, 0, x],
    ] as const
  )[sector] ?? [0, 0, 0];
  return toHex([(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255]);
}

/** Picker rows use a separate measured palette; uncaptured variants keep the project-name tint. */
export function projectPickerTextColor(projectColor: string | null | undefined): string {
  const color = projectColor?.trim().toLowerCase();
  return (color ? PROJECT_PICKER_TEXT_COLORS[color] : undefined) ?? projectTextColor(projectColor);
}
