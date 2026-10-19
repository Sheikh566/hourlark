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

const PICKER_TEXT_COLORS: Readonly<Record<string, string>> = {
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

export function projectTextColor(color: string): string {
  // shortcut: Custom colours use a readable lift; replace when matching custom reference data exists.
  return PROJECT_TEXT_COLORS[color.toLowerCase()] ?? `hsl(from ${color} h max(s, 80) 63)`;
}

export function projectPickerTextColor(color: string): string {
  // shortcut: Five uncaptured picker presets use the measured chip tint until their rows are captured.
  return PICKER_TEXT_COLORS[color.toLowerCase()] ?? projectTextColor(color);
}

export function projectChipBackground(color: string): string {
  return `color-mix(in srgb, ${color} 20%, #1b1b1b)`;
}
