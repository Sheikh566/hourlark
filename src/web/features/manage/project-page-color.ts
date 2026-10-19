/**
 * Toggl renders project names on the Projects page with a hand-tuned light variant of the stored
 * palette colour, while dots/swatches/list rows keep the stored colour (TOGGL-CAPTURES project
 * colour table, "Projects page name" column). The 15 palette presets are an exact lookup; any
 * other (custom) colour falls back to an HSL lift that keeps the hue, clamps saturation to >= 80%
 * and sets lightness to 63% — the documented approximation.
 */
const PROJECT_PAGE_NAME_COLORS: Readonly<Record<string, string>> = {
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

export function projectPageNameColor(color: string | null | undefined): string {
  const key = color?.trim().toLowerCase();
  if (key && PROJECT_PAGE_NAME_COLORS[key]) return PROJECT_PAGE_NAME_COLORS[key];
  // Custom colours: HSL lift (hue kept, saturation >= 80%, lightness 63%).
  return key ? `hsl(from ${key} h max(s, 80) 63)` : "#b7b7b7";
}
