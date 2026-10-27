import type { SelectOption } from "@/web/components/select";

let cached: SelectOption[] | undefined;

/** "UTC+05:30" for the zone's current offset; engines print a zero offset as bare "GMT". */
function utcOffset(timeZone: string, at: Date): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  return !name || name === "GMT" ? "UTC+00:00" : name.replace("GMT", "UTC");
}

function option(timeZone: string, at: Date): SelectOption {
  const name = timeZone.replaceAll("_", " ");
  return { value: timeZone, label: `${name} (${utcOffset(timeZone, at)})`, textValue: name };
}

/**
 * IANA time zones as `Select` options, labelled with their current UTC offset. Typeahead matches
 * the zone name. `current` is always included so a stored zone the runtime does not list (e.g. an
 * alias like "US/Eastern") stays selectable.
 */
export function timeZoneOptions(current?: string): SelectOption[] {
  if (!cached) {
    const now = new Date();
    const zones =
      typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    cached = ["UTC", ...zones.filter((zone) => zone !== "UTC")].map((zone) => option(zone, now));
  }
  if (!current || cached.some((entry) => entry.value === current)) return cached;
  try {
    return [option(current, new Date()), ...cached];
  } catch {
    return [{ value: current, label: current }, ...cached];
  }
}
