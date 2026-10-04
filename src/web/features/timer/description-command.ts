export type DescriptionCommandKind = "project" | "tag";

export interface DescriptionCommand {
  kind: DescriptionCommandKind;
  marker: "@" | "#";
  query: string;
  start: number;
  end: number;
}

export function findDescriptionCommand(
  description: string,
  cursor = description.length,
): DescriptionCommand | null {
  const safeCursor = Math.max(0, Math.min(cursor, description.length));
  const beforeCursor = description.slice(0, safeCursor);
  const match = beforeCursor.match(/(?:^|\s)([@#])([^\s@#]*)$/u);
  if (!match) return null;

  const marker = match[1];
  const query = match[2] ?? "";
  if (marker !== "@" && marker !== "#") return null;

  return {
    kind: marker === "@" ? "project" : "tag",
    marker,
    query,
    start: safeCursor - query.length - 1,
    end: safeCursor,
  };
}

export function removeDescriptionCommand(
  description: string,
  command: DescriptionCommand,
): { description: string; cursor: number } {
  const before = description.slice(0, command.start).replace(/\s+$/u, "");
  const after = description.slice(command.end).replace(/^\s+/u, "");
  if (!before) return { description: after, cursor: 0 };
  if (!after) {
    const next = `${before} `;
    return { description: next, cursor: next.length };
  }
  return {
    description: `${before} ${after}`,
    cursor: before.length + 1,
  };
}

export function matchesDescriptionCommand(label: string, query: string): boolean {
  return label.trim().toLocaleLowerCase().startsWith(query.trim().toLocaleLowerCase());
}
