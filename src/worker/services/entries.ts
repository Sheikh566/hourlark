import { can, canEditEntry, hasFinancialAccess } from "@/domain/permissions/policy";
import { canonicalJson, sha256 } from "@/domain/normalization";
import type { AuthenticatedMember, MemberRow } from "@/domain/types";
import {
  getProjectForMember,
  getWorkspace,
  hasOverlap,
  loadActiveTimer,
  loadEntry,
  parseTags,
  resolveRate,
  serializeEntry,
  validateActiveTags,
  type EntryJoinedRow,
  type ProjectRow,
  type RateSnapshot,
} from "@/db/repositories/time-entries";
import { ApiError } from "@/worker/errors";
import type { entryCreateSchema, entryUpdateSchema, timerInputSchema } from "@/worker/schemas";
import { isOptimisticVersionMismatch, optimisticVersionGuard } from "@/worker/version-guard";
import type { z } from "zod";

type TimerInput = z.infer<typeof timerInputSchema>;
type EntryCreateInput = z.infer<typeof entryCreateSchema>;
type EntryUpdateInput = z.infer<typeof entryUpdateSchema>;

interface MutationMeta {
  requestId: string;
  cfRay: string | null;
}

function auditStatement(
  db: D1Database,
  actor: AuthenticatedMember,
  action: string,
  targetType: string,
  targetId: string,
  before: unknown,
  after: unknown,
  reason: string | null,
  meta: MutationMeta,
  createdAt: number,
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

async function assertTargetMember(
  db: D1Database,
  actor: AuthenticatedMember,
  requestedMemberId: string | undefined,
): Promise<MemberRow> {
  const memberId = requestedMemberId ?? actor.id;
  if (memberId !== actor.id && !can(actor.role, "entry:edit-team")) {
    throw new ApiError(403, "member_time_forbidden", "You cannot create time for this member.");
  }
  const member = await db
    .prepare("SELECT * FROM members WHERE id = ? AND workspace_id = ?")
    .bind(memberId, actor.workspaceId)
    .first<MemberRow>();
  if (!member || member.status !== "active") {
    throw new ApiError(422, "member_unavailable", "The selected member is not active.");
  }
  return member;
}

async function assertProjectAvailabilityForTarget(
  db: D1Database,
  project: ProjectRow,
  targetMember: MemberRow,
): Promise<void> {
  if (project.visibility === "all" || targetMember.role !== "member") return;
  const assignment = await db
    .prepare("SELECT 1 AS allowed FROM project_members WHERE project_id = ? AND member_id = ?")
    .bind(project.id, targetMember.id)
    .first<{ allowed: number }>();
  if (!assignment) {
    throw new ApiError(422, "project_not_assigned", "The project is not assigned to this member.");
  }
}

async function billableSnapshot(
  db: D1Database,
  actor: AuthenticatedMember,
  billable: boolean,
  project: ProjectRow | null,
  explicitRate?: number | null,
  explicitCurrency?: string | null,
): Promise<RateSnapshot | { rateMinor: number; currency: string; source: "entry" }> {
  if (!billable) return { rateMinor: null, currency: null, source: "none" };
  if (explicitRate !== undefined && explicitRate !== null) {
    if (!hasFinancialAccess(actor.role)) {
      throw new ApiError(403, "rate_forbidden", "Only Managers and Admins can set billable rates.");
    }
    if (!explicitCurrency) {
      throw new ApiError(422, "rate_currency_required", "Currency is required with a rate.");
    }
    return { rateMinor: explicitRate, currency: explicitCurrency, source: "entry" };
  }
  return resolveRate(db, actor.workspaceId, project);
}

async function membersCanSetBillable(db: D1Database, actor: AuthenticatedMember): Promise<boolean> {
  if (actor.role !== "member") return true;
  const workspace = await getWorkspace(db, actor.workspaceId);
  return workspace.members_can_set_billable === 1;
}

async function assertBillableTransition(
  db: D1Database,
  actor: AuthenticatedMember,
  requestedBillable: boolean,
  previouslyBillable: boolean,
): Promise<void> {
  if (!requestedBillable || previouslyBillable || (await membersCanSetBillable(db, actor))) return;
  throw new ApiError(403, "billable_change_forbidden", "Members cannot mark entries billable.");
}

async function billableForCreate(
  db: D1Database,
  actor: AuthenticatedMember,
  requested: boolean | undefined,
  project: ProjectRow | null,
): Promise<boolean> {
  if (requested === true) {
    await assertBillableTransition(db, actor, true, false);
    return true;
  }
  if (requested === false) return false;
  if (!(await membersCanSetBillable(db, actor))) return false;
  return project?.billable_default === 1;
}

async function assertEntryUnlocked(
  db: D1Database,
  actor: AuthenticatedMember,
  entry: EntryJoinedRow,
  overrideReason: string | undefined,
): Promise<string | null> {
  const workspace = await getWorkspace(db, actor.workspaceId);
  if (workspace.lock_entries_after_days === null || entry.stopped_at === null) return null;
  const cutoff = Date.now() - workspace.lock_entries_after_days * 86_400_000;
  if (entry.stopped_at >= cutoff) return null;
  if (!can(actor.role, "lock:override")) {
    throw new ApiError(422, "entry_locked", "This entry is locked by workspace policy.");
  }
  if (!overrideReason || overrideReason.trim().length < 3) {
    throw new ApiError(
      422,
      "override_reason_required",
      "A reason is required to override the lock.",
    );
  }
  return overrideReason.trim();
}

async function insertTags(
  db: D1Database,
  entryId: string,
  tagIds: string[],
  createdAt: number,
): Promise<D1PreparedStatement[]> {
  await validateActiveTags(db, "00000000-0000-4000-8000-000000000001", tagIds);
  return [...new Set(tagIds)].map((tagId) =>
    db
      .prepare("INSERT INTO time_entry_tags (time_entry_id, tag_id, created_at) VALUES (?, ?, ?)")
      .bind(entryId, tagId, createdAt),
  );
}

export async function createManualEntry(
  db: D1Database,
  actor: AuthenticatedMember,
  input: EntryCreateInput,
  meta: MutationMeta,
) {
  const targetMember = await assertTargetMember(db, actor, input.member_id);
  const startedAt = Date.parse(input.started_at);
  const stoppedAt = Date.parse(input.stopped_at);
  if (stoppedAt <= startedAt) {
    throw new ApiError(422, "time_range_invalid", "Stop time must be after start time.");
  }
  const project = input.project_id ? await getProjectForMember(db, actor, input.project_id) : null;
  if (project) await assertProjectAvailabilityForTarget(db, project, targetMember);
  const billable = await billableForCreate(db, actor, input.billable, project);
  const rate = await billableSnapshot(
    db,
    actor,
    billable,
    project,
    input.rate_minor,
    input.rate_currency,
  );
  const id = crypto.randomUUID();
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO time_entries (
          id, workspace_id, member_id, project_id, client_id, description, started_at, stopped_at,
          billable, rate_minor, rate_currency, rate_source, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        actor.workspaceId,
        targetMember.id,
        project?.id ?? null,
        project?.client_id ?? null,
        input.description,
        startedAt,
        stoppedAt,
        billable ? 1 : 0,
        rate.rateMinor,
        rate.currency,
        rate.source,
        actor.id,
        actor.id,
        now,
        now,
      ),
    ...(await insertTags(db, id, input.tag_ids, now)),
    auditStatement(db, actor, "time_entry.created", "time_entry", id, null, input, null, meta, now),
  ];
  await db.batch(statements);
  const entry = await loadEntry(db, id);
  if (!entry) throw new ApiError(500, "entry_create_failed", "The entry could not be loaded.");
  return {
    entry: serializeEntry(entry, actor, now),
    warnings: {
      overlap: await hasOverlap(db, targetMember.id, startedAt, stoppedAt, id),
    },
    server_now: new Date(now).toISOString(),
  };
}

async function storedIdempotentResponse(
  db: D1Database,
  actor: AuthenticatedMember,
  action: string,
  key: string,
  requestHash: string,
): Promise<{ found: false } | { found: true; response: unknown }> {
  const existing = await db
    .prepare(
      `SELECT request_hash, response_body
       FROM idempotency_records
       WHERE workspace_id = ? AND member_id = ? AND action = ? AND idempotency_key = ?`,
    )
    .bind(actor.workspaceId, actor.id, action, key)
    .first<{ request_hash: string; response_body: string }>();
  if (!existing) return { found: false };
  if (existing.request_hash !== requestHash) {
    throw new ApiError(
      409,
      "idempotency_key_reused",
      "This idempotency key was already used with another request.",
    );
  }
  return { found: true, response: JSON.parse(existing.response_body) as unknown };
}

function timerResponsePreview(
  id: string,
  actor: AuthenticatedMember,
  input: TimerInput,
  project: ProjectRow | null,
  tags: Array<{ id: string; name: string; color: string; status: string }>,
  billable: boolean,
  rate: RateSnapshot | { rateMinor: number; currency: string; source: "entry" },
  startedAt: number,
) {
  const entry = {
    id,
    member: { id: actor.id, name: actor.displayName, email: actor.email },
    project: project ? { id: project.id, name: project.name, color: project.color } : null,
    client: project ? { id: project.client_id, name: project.client_name ?? null } : null,
    description: input.description,
    tags,
    started_at: new Date(startedAt).toISOString(),
    stopped_at: null,
    duration_ms: 0,
    running: true,
    billable,
    deleted_at: null,
    created_at: new Date(startedAt).toISOString(),
    updated_at: new Date(startedAt).toISOString(),
    version: 1,
  };
  return {
    entry: hasFinancialAccess(actor.role)
      ? {
          ...entry,
          rate_minor: rate.rateMinor,
          rate_currency: rate.currency,
          rate_source: rate.source,
        }
      : entry,
    server_now: new Date(startedAt).toISOString(),
  };
}

export async function startTimer(
  db: D1Database,
  actor: AuthenticatedMember,
  input: TimerInput,
  idempotencyKey: string,
  meta: MutationMeta,
): Promise<unknown> {
  const requestHash = await sha256(canonicalJson(input));
  const stored = await storedIdempotentResponse(
    db,
    actor,
    "timer.start",
    idempotencyKey,
    requestHash,
  );
  if (stored.found) return stored.response;

  const project = input.project_id ? await getProjectForMember(db, actor, input.project_id) : null;
  const tags = await validateActiveTags(db, actor.workspaceId, input.tag_ids);
  const billable = await billableForCreate(db, actor, input.billable, project);
  const rate = await billableSnapshot(db, actor, billable, project);
  const now = Date.now();
  const id = crypto.randomUUID();
  const response = timerResponsePreview(id, actor, input, project, tags, billable, rate, now);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO idempotency_records (
          id, workspace_id, member_id, action, idempotency_key, request_hash,
          response_status, response_body, created_at
        ) VALUES (?, ?, ?, 'timer.start', ?, ?, 200, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        actor.workspaceId,
        actor.id,
        idempotencyKey,
        requestHash,
        JSON.stringify(response),
        now,
      ),
    db
      .prepare(
        `UPDATE time_entries
         SET stopped_at = ?, updated_at = ?, updated_by = ?, version = version + 1
         WHERE workspace_id = ? AND member_id = ? AND stopped_at IS NULL AND deleted_at IS NULL`,
      )
      .bind(now, now, actor.id, actor.workspaceId, actor.id),
    db
      .prepare(
        `INSERT INTO time_entries (
          id, workspace_id, member_id, project_id, client_id, description, started_at, stopped_at,
          billable, rate_minor, rate_currency, rate_source, created_by, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        actor.workspaceId,
        actor.id,
        project?.id ?? null,
        project?.client_id ?? null,
        input.description,
        now,
        billable ? 1 : 0,
        rate.rateMinor,
        rate.currency,
        rate.source,
        actor.id,
        actor.id,
        now,
        now,
      ),
    ...tags.map((tag) =>
      db
        .prepare("INSERT INTO time_entry_tags (time_entry_id, tag_id, created_at) VALUES (?, ?, ?)")
        .bind(id, tag.id, now),
    ),
    auditStatement(db, actor, "timer.started", "time_entry", id, null, input, null, meta, now),
  ];

  try {
    await db.batch(statements);
    return response;
  } catch (error) {
    const raced = await storedIdempotentResponse(
      db,
      actor,
      "timer.start",
      idempotencyKey,
      requestHash,
    );
    if (raced.found) return raced.response;
    throw error;
  }
}

export async function stopTimer(
  db: D1Database,
  actor: AuthenticatedMember,
  idempotencyKey: string,
  meta: MutationMeta,
): Promise<unknown> {
  const requestHash = await sha256("{}");
  const stored = await storedIdempotentResponse(
    db,
    actor,
    "timer.stop",
    idempotencyKey,
    requestHash,
  );
  if (stored.found) return stored.response;

  const active = await loadActiveTimer(db, actor.id);
  const now = Date.now();
  const response = {
    entry: active
      ? serializeEntry(
          { ...active, stopped_at: now, updated_at: now, version: active.version + 1 },
          actor,
          now,
        )
      : null,
    server_now: new Date(now).toISOString(),
  };
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO idempotency_records (
          id, workspace_id, member_id, action, idempotency_key, request_hash,
          response_status, response_body, created_at
        ) VALUES (?, ?, ?, 'timer.stop', ?, ?, 200, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        actor.workspaceId,
        actor.id,
        idempotencyKey,
        requestHash,
        JSON.stringify(response),
        now,
      ),
  ];
  if (active) {
    statements.push(
      db
        .prepare(
          `UPDATE time_entries
           SET stopped_at = ?, updated_at = ?, updated_by = ?, version = version + 1
           WHERE id = ? AND stopped_at IS NULL AND deleted_at IS NULL`,
        )
        .bind(now, now, actor.id, active.id),
      auditStatement(
        db,
        actor,
        "timer.stopped",
        "time_entry",
        active.id,
        serializeEntry(active, actor, now),
        response.entry,
        null,
        meta,
        now,
      ),
    );
  }
  try {
    await db.batch(statements);
    return response;
  } catch (error) {
    const raced = await storedIdempotentResponse(
      db,
      actor,
      "timer.stop",
      idempotencyKey,
      requestHash,
    );
    if (raced.found) return raced.response;
    throw error;
  }
}

export async function updateEntry(
  db: D1Database,
  actor: AuthenticatedMember,
  entryId: string,
  input: EntryUpdateInput,
  meta: MutationMeta,
) {
  const existing = await loadEntry(db, entryId);
  if (!existing || existing.deleted_at !== null) {
    throw new ApiError(404, "entry_not_found", "Time entry not found.");
  }
  if (!canEditEntry(actor, existing.member_id)) {
    throw new ApiError(403, "entry_edit_forbidden", "You cannot edit this time entry.");
  }
  if (input.version !== existing.version) {
    throw new ApiError(409, "entry_conflict", "The entry changed elsewhere.", {
      authoritative: serializeEntry(existing, actor),
    });
  }
  const overrideReason = await assertEntryUnlocked(db, actor, existing, input.override_reason);
  const startedAt = input.started_at ? Date.parse(input.started_at) : existing.started_at;
  const stoppedAt =
    input.stopped_at === undefined
      ? existing.stopped_at
      : input.stopped_at === null
        ? null
        : Date.parse(input.stopped_at);
  if (stoppedAt !== null && stoppedAt <= startedAt) {
    throw new ApiError(422, "time_range_invalid", "Stop time must be after start time.");
  }
  if (existing.stopped_at !== null && stoppedAt === null) {
    throw new ApiError(
      422,
      "timer_reopen_forbidden",
      "Continue the entry instead of reopening it.",
    );
  }

  const projectChanged = input.project_id !== undefined && input.project_id !== existing.project_id;
  const projectId = input.project_id === undefined ? existing.project_id : input.project_id;
  const project = projectId
    ? await getProjectForMember(db, actor, projectId, !projectChanged)
    : null;
  const targetMember = await db
    .prepare("SELECT * FROM members WHERE id = ?")
    .bind(existing.member_id)
    .first<MemberRow>();
  if (!targetMember) throw new ApiError(404, "member_not_found", "Member not found.");
  if (project) await assertProjectAvailabilityForTarget(db, project, targetMember);

  const billable = input.billable ?? existing.billable === 1;
  await assertBillableTransition(db, actor, billable, existing.billable === 1);
  let rate: { rateMinor: number | null; currency: string | null; source: string } = {
    rateMinor: existing.rate_minor,
    currency: existing.rate_currency,
    source: existing.rate_source,
  };
  if (!billable) {
    rate = { rateMinor: null, currency: null, source: "none" };
  } else if (input.rate_minor !== undefined) {
    rate = await billableSnapshot(db, actor, true, project, input.rate_minor, input.rate_currency);
  } else if (projectChanged || existing.billable !== 1 || input.recalculate_rate) {
    rate = await billableSnapshot(db, actor, true, project);
  }

  const currentTags = parseTags(existing.tags_json).map((tag) => tag.id);
  const tagIds = input.tag_ids ?? currentTags;
  await validateActiveTags(db, actor.workspaceId, tagIds);
  const now = Date.now();
  const after = {
    ...existing,
    project_id: project?.id ?? null,
    client_id: project?.client_id ?? null,
    description: input.description ?? existing.description,
    started_at: startedAt,
    stopped_at: stoppedAt,
    billable: billable ? 1 : 0,
    rate_minor: rate.rateMinor,
    rate_currency: rate.currency,
    rate_source: rate.source,
    tags_json: JSON.stringify(tagIds),
    updated_by: actor.id,
    updated_at: now,
    version: existing.version + 1,
  };
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE time_entries
         SET project_id = ?, client_id = ?, description = ?, started_at = ?, stopped_at = ?,
             billable = ?, rate_minor = ?, rate_currency = ?, rate_source = ?,
             updated_by = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND version = ? AND deleted_at IS NULL`,
      )
      .bind(
        project?.id ?? null,
        project?.client_id ?? null,
        after.description,
        startedAt,
        stoppedAt,
        billable ? 1 : 0,
        rate.rateMinor,
        rate.currency,
        rate.source,
        actor.id,
        now,
        entryId,
        existing.version,
      ),
    db
      .prepare(
        `DELETE FROM time_entry_tags
         WHERE time_entry_id = ?
           AND EXISTS (
             SELECT 1 FROM time_entries
             WHERE id = ? AND version = ? AND updated_at = ?
           )`,
      )
      .bind(entryId, entryId, existing.version + 1, now),
    ...[...new Set(tagIds)].map((tagId) =>
      db
        .prepare(
          `INSERT INTO time_entry_tags (time_entry_id, tag_id, created_at)
           SELECT ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM time_entries
             WHERE id = ? AND version = ? AND updated_at = ?
           )`,
        )
        .bind(entryId, tagId, now, entryId, existing.version + 1, now),
    ),
    db
      .prepare(
        `INSERT INTO audit_logs (
          id, workspace_id, actor_member_id, action, target_type, target_id,
          before_json, after_json, reason, request_id, cf_ray, created_at
        )
        SELECT ?, ?, ?, ?, 'time_entry', ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM time_entries WHERE id = ? AND version = ? AND updated_at = ?
        )`,
      )
      .bind(
        crypto.randomUUID(),
        actor.workspaceId,
        actor.id,
        actor.id === existing.member_id ? "time_entry.updated" : "time_entry.corrected",
        entryId,
        JSON.stringify(serializeEntry(existing, actor, now)),
        JSON.stringify(after),
        overrideReason,
        meta.requestId,
        meta.cfRay,
        now,
        entryId,
        existing.version + 1,
        now,
      ),
  ];
  const results = await db.batch(statements);
  if (results[0]?.meta.changes === 0) {
    const authoritative = await loadEntry(db, entryId);
    throw new ApiError(409, "entry_conflict", "The entry changed elsewhere.", {
      authoritative: authoritative ? serializeEntry(authoritative, actor) : null,
    });
  }
  const updated = await loadEntry(db, entryId);
  if (!updated) throw new ApiError(500, "entry_update_failed", "The entry could not be loaded.");
  return {
    entry: serializeEntry(updated, actor, now),
    warnings: {
      overlap:
        stoppedAt === null
          ? false
          : await hasOverlap(db, existing.member_id, startedAt, stoppedAt, entryId),
    },
    server_now: new Date(now).toISOString(),
  };
}

export async function setEntryDeleted(
  db: D1Database,
  actor: AuthenticatedMember,
  entryId: string,
  deleted: boolean,
  meta: MutationMeta,
  requestedOverrideReason?: string,
) {
  const existing = await loadEntry(db, entryId);
  if (!existing || (deleted ? existing.deleted_at !== null : existing.deleted_at === null)) {
    throw new ApiError(404, "entry_not_found", "Time entry not found.");
  }
  if (!canEditEntry(actor, existing.member_id)) {
    throw new ApiError(403, "entry_edit_forbidden", "You cannot change this time entry.");
  }
  if (existing.stopped_at === null && deleted) {
    throw new ApiError(422, "running_entry_delete_forbidden", "Stop the timer before deleting it.");
  }
  const overrideReason = await assertEntryUnlocked(db, actor, existing, requestedOverrideReason);
  const now = Date.now();
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE time_entries
           SET deleted_at = ?, deleted_by = ?, updated_by = ?, updated_at = ?, version = version + 1
           WHERE id = ? AND version = ?`,
        )
        .bind(
          deleted ? now : null,
          deleted ? actor.id : null,
          actor.id,
          now,
          entryId,
          existing.version,
        ),
      ...optimisticVersionGuard(db),
      auditStatement(
        db,
        actor,
        deleted ? "time_entry.deleted" : "time_entry.restored",
        "time_entry",
        entryId,
        serializeEntry(existing, actor, now),
        { deleted_at: deleted ? new Date(now).toISOString() : null },
        overrideReason,
        meta,
        now,
      ),
    ]);
  } catch (error) {
    if (isOptimisticVersionMismatch(error)) {
      throw new ApiError(409, "entry_conflict", "The entry changed elsewhere.");
    }
    throw error;
  }
  const updated = await loadEntry(db, entryId);
  return {
    entry: updated ? serializeEntry(updated, actor, now) : null,
    server_now: new Date(now).toISOString(),
  };
}
