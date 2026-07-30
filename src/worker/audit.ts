import type { AuthenticatedMember } from "@/domain/types";

export interface AuditMeta {
  requestId: string;
  cfRay: string | null;
}

export function createAuditStatement(
  db: D1Database,
  actor: AuthenticatedMember,
  action: string,
  targetType: string,
  targetId: string,
  before: unknown,
  after: unknown,
  reason: string | null,
  meta: AuditMeta,
  createdAt = Date.now(),
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs (
        id, workspace_id, actor_member_id, action, target_type, target_id,
        before_json, after_json, reason, request_id, cf_ray, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      actor.workspaceId,
      actor.id,
      action,
      targetType,
      targetId,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      reason,
      meta.requestId,
      meta.cfRay,
      createdAt,
    );
}
