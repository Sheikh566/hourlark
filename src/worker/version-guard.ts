export function optimisticVersionGuard(db: D1Database): D1PreparedStatement[] {
  return [
    db.prepare("INSERT INTO member_update_checks (updated_rows) VALUES (changes())"),
    db.prepare("DELETE FROM member_update_checks"),
  ];
}

export function isOptimisticVersionMismatch(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("member_update_version_matches");
}
