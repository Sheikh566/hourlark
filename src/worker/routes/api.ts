import { addDays, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { Hono, type Context } from "hono";
import { z, type ZodType } from "zod";

import {
  getProjectForMember,
  getWorkspace,
  listEntries,
  loadActiveTimer,
  loadEntry,
  parseTags,
  serializeEntry,
} from "@/db/repositories/time-entries";
import { assertValidTimeZone, formatInclusivePeriod } from "@/domain/dates/time";
import { normalizeEmail, normalizeName } from "@/domain/normalization";
import { can, canViewMemberTime, hasFinancialAccess } from "@/domain/permissions/policy";
import {
  buildSummary,
  toReportRows,
  type GroupDimension,
  type ReportRow,
} from "@/domain/reports/reporting";
import {
  WORKSPACE_ID,
  type AppContext,
  type AuthenticatedMember,
  type MemberRow,
  type WorkspaceRow,
} from "@/domain/types";
import { createAuditStatement, type AuditMeta } from "@/worker/audit";
import { ApiError } from "@/worker/errors";
import { detailedCsv, summaryCsv } from "@/worker/exports/csv";
import { createTimeReportPdf } from "@/worker/exports/pdf";
import { createCsrfToken } from "@/worker/middleware/csrf";
import {
  clientInputSchema,
  entryCreateSchema,
  entryListQuerySchema,
  entryUpdateSchema,
  idSchema,
  memberCreateSchema,
  memberUpdateSchema,
  pdfExportSchema,
  projectInputSchema,
  reportQuerySchema,
  settingsUpdateSchema,
  tagInputSchema,
  timerInputSchema,
} from "@/worker/schemas";
import {
  createManualEntry,
  setEntryDeleted,
  startTimer,
  stopTimer,
  updateEntry,
} from "@/worker/services/entries";
import { isOptimisticVersionMismatch, optimisticVersionGuard } from "@/worker/version-guard";

const api = new Hono<AppContext>();

function mutationMeta(c: Context<AppContext>): AuditMeta {
  return { requestId: c.get("requestId"), cfRay: c.req.header("CF-Ray") ?? null };
}

function zodDetails(error: z.ZodError): Record<string, unknown> {
  return {
    fields: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

async function jsonBody<T>(c: Context<AppContext>, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(422, "body_invalid", "A valid JSON body is required.");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(
      422,
      "validation_failed",
      "The request is invalid.",
      zodDetails(result.error),
    );
  }
  return result.data;
}

function queryInput<T>(c: Context<AppContext>, schema: ZodType<T>): T {
  const result = schema.safeParse(c.req.query());
  if (!result.success) {
    throw new ApiError(422, "validation_failed", "The query is invalid.", zodDetails(result.error));
  }
  return result.data;
}

function idempotencyKey(c: Context<AppContext>): string {
  const key = c.req.header("Idempotency-Key")?.trim();
  if (!key || key.length < 8 || key.length > 200) {
    throw new ApiError(
      422,
      "idempotency_key_required",
      "Idempotency-Key must be between 8 and 200 characters.",
    );
  }
  return key;
}

function rangeFrom(start: string, end: string): { start: number; end: number } {
  const range = { start: Date.parse(start), end: Date.parse(end) };
  if (range.end <= range.start) {
    throw new ApiError(422, "date_range_invalid", "The end of the range must be after the start.");
  }
  return range;
}

function entryFilters(query: z.infer<typeof entryListQuerySchema>) {
  const range = rangeFrom(query.start, query.end);
  return {
    ...range,
    memberId: query.member_id,
    projectId: query.project_id,
    clientId: query.client_id,
    tagId: query.tag_id,
    billable: query.billable === undefined ? undefined : query.billable === "true",
    running: query.running === undefined ? undefined : query.running === "true",
    search: query.search,
    includeDeleted: query.include_deleted === "true",
    limit: query.limit,
  };
}

function safeWorkspace(workspace: WorkspaceRow) {
  return {
    id: workspace.id,
    app_name: workspace.app_name,
    company_name: workspace.company_name,
    company_domain: workspace.company_domain,
    timezone: workspace.timezone,
    currency: workspace.currency,
    week_start: workspace.week_start,
    members_can_set_billable: workspace.members_can_set_billable === 1,
    lock_entries_after_days: workspace.lock_entries_after_days,
    rounding_increment_minutes: workspace.rounding_increment_minutes,
    rounding_method: workspace.rounding_method,
    report_show_members: workspace.report_show_members === 1,
    report_show_descriptions: workspace.report_show_descriptions === 1,
    report_show_tags: workspace.report_show_tags === 1,
    version: workspace.version,
  };
}

api.get("/health", async (c) => {
  const database = await c.env.DB.prepare("SELECT 1 AS healthy").first<{ healthy: number }>();
  return c.json({
    status: database?.healthy === 1 ? "ok" : "degraded",
    server_now: new Date().toISOString(),
    request_id: c.get("requestId"),
  });
});

api.get("/me", async (c) => {
  const member = c.get("member");
  const [workspace, activeTimer, csrfToken] = await Promise.all([
    getWorkspace(c.env.DB, member.workspaceId),
    loadActiveTimer(c.env.DB, member.id),
    createCsrfToken(c.env, member.id),
  ]);
  return c.json({
    member,
    workspace: safeWorkspace(workspace),
    permissions: {
      view_team: can(member.role, "entry:view-team"),
      financial: hasFinancialAccess(member.role),
      export: can(member.role, "report:export"),
      manage_workspace: can(member.role, "client:manage"),
      manage_members: can(member.role, "member:manage-role"),
      view_audit: can(member.role, "audit:view"),
    },
    active_timer: activeTimer ? serializeEntry(activeTimer, member) : null,
    csrf_token: csrfToken,
    server_now: new Date().toISOString(),
  });
});

api.get("/me/recent", async (c) => {
  const member = c.get("member");
  const recent = await c.env.DB.prepare(
    `SELECT e.description, e.project_id, p.name AS project_name, p.color AS project_color,
              c.name AS client_name, MAX(e.started_at) AS last_used_at
       FROM time_entries e
       LEFT JOIN projects p ON p.id = e.project_id
       LEFT JOIN clients c ON c.id = e.client_id
       WHERE e.member_id = ? AND e.deleted_at IS NULL
       GROUP BY e.description, e.project_id
       ORDER BY last_used_at DESC
       LIMIT 12`,
  )
    .bind(member.id)
    .all();
  return c.json({ recent: recent.results });
});

api.get("/timer", async (c) => {
  const member = c.get("member");
  const entry = await loadActiveTimer(c.env.DB, member.id);
  return c.json({
    entry: entry ? serializeEntry(entry, member) : null,
    server_now: new Date().toISOString(),
  });
});

api.post("/timer/start", async (c) => {
  const input = await jsonBody(c, timerInputSchema);
  return c.json(
    await startTimer(c.env.DB, c.get("member"), input, idempotencyKey(c), mutationMeta(c)),
  );
});

api.post("/timer/stop", async (c) =>
  c.json(await stopTimer(c.env.DB, c.get("member"), idempotencyKey(c), mutationMeta(c))),
);

api.get("/time-entries", async (c) => {
  const query = queryInput(c, entryListQuerySchema);
  const member = c.get("member");
  const generatedAt = Date.now();
  const entries = await listEntries(c.env.DB, member, entryFilters(query), generatedAt);
  return c.json({
    entries: entries.map((entry) => serializeEntry(entry, member, generatedAt)),
    generated_at: new Date(generatedAt).toISOString(),
  });
});

api.post("/time-entries", async (c) => {
  const input = await jsonBody(c, entryCreateSchema);
  return c.json(await createManualEntry(c.env.DB, c.get("member"), input, mutationMeta(c)), 201);
});

api.get("/time-entries/:id", async (c) => {
  const id = idSchema.parse(c.req.param("id"));
  const member = c.get("member");
  const entry = await loadEntry(c.env.DB, id);
  if (!entry || !canViewMemberTime(member, entry.member_id)) {
    throw new ApiError(404, "entry_not_found", "Time entry not found.");
  }
  return c.json({ entry: serializeEntry(entry, member) });
});

api.patch("/time-entries/:id", async (c) => {
  const id = idSchema.parse(c.req.param("id"));
  const input = await jsonBody(c, entryUpdateSchema);
  return c.json(await updateEntry(c.env.DB, c.get("member"), id, input, mutationMeta(c)));
});

api.delete("/time-entries/:id", async (c) => {
  const id = idSchema.parse(c.req.param("id"));
  return c.json(
    await setEntryDeleted(
      c.env.DB,
      c.get("member"),
      id,
      true,
      mutationMeta(c),
      c.req.query("override_reason"),
    ),
  );
});

api.post("/time-entries/:id/restore", async (c) => {
  const id = idSchema.parse(c.req.param("id"));
  return c.json(
    await setEntryDeleted(
      c.env.DB,
      c.get("member"),
      id,
      false,
      mutationMeta(c),
      c.req.query("override_reason"),
    ),
  );
});

api.post("/time-entries/:id/continue", async (c) => {
  const id = idSchema.parse(c.req.param("id"));
  const member = c.get("member");
  const entry = await loadEntry(c.env.DB, id);
  if (!entry || !canViewMemberTime(member, entry.member_id)) {
    throw new ApiError(404, "entry_not_found", "Time entry not found.");
  }
  const workspace = await getWorkspace(c.env.DB, member.workspaceId);
  const canKeepBillable = member.role !== "member" || workspace.members_can_set_billable === 1;
  return c.json(
    await startTimer(
      c.env.DB,
      member,
      {
        description: entry.description,
        project_id: entry.project_id,
        tag_ids: parseTags(entry.tags_json)
          .filter((tag) => tag.status === "active")
          .map((tag) => tag.id),
        billable: canKeepBillable && entry.billable === 1,
      },
      idempotencyKey(c),
      mutationMeta(c),
    ),
  );
});

api.get("/calendar", async (c) => {
  const query = queryInput(c, entryListQuerySchema);
  const member = c.get("member");
  const generatedAt = Date.now();
  const entries = await listEntries(c.env.DB, member, entryFilters(query), generatedAt);
  return c.json({
    events: entries.map((entry) => serializeEntry(entry, member, generatedAt)),
    generated_at: new Date(generatedAt).toISOString(),
  });
});

function requireAction(member: AuthenticatedMember, action: Parameters<typeof can>[1]): void {
  if (!can(member.role, action)) {
    throw new ApiError(403, "permission_denied", "You do not have permission for this action.");
  }
}

api.get("/clients", async (c) => {
  const member = c.get("member");
  const status = c.req.query("status");
  const search = c.req.query("search")?.trim();
  const conditions = ["c.workspace_id = ?"];
  const bindings: Array<string | number> = [member.workspaceId];
  if (member.role === "member") {
    conditions.push("c.status = 'active'");
    conditions.push(
      `EXISTS (
        SELECT 1 FROM projects p
        WHERE p.client_id = c.id AND p.status = 'active'
          AND (p.visibility = 'all' OR EXISTS (
            SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.member_id = ?
          ))
      )`,
    );
    bindings.push(member.id);
  } else if (status === "active" || status === "archived") {
    conditions.push("c.status = ?");
    bindings.push(status);
  }
  if (search) {
    conditions.push("c.name LIKE ? ESCAPE '\\' COLLATE NOCASE");
    bindings.push(
      `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`,
    );
  }
  const result = await c.env.DB.prepare(
    `SELECT c.*,
              (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS project_count,
              COALESCE((SELECT SUM(COALESCE(e.stopped_at, ?) - e.started_at)
                        FROM time_entries e WHERE e.client_id = c.id AND e.deleted_at IS NULL), 0) AS tracked_ms
       FROM clients c
       WHERE ${conditions.join(" AND ")}
       ORDER BY c.status, c.name`,
  )
    .bind(Date.now(), ...bindings)
    .all<Record<string, unknown>>();
  return c.json({
    clients:
      member.role === "member"
        ? result.results.map((client) => ({
            id: client.id,
            name: client.name,
            status: client.status,
            project_count: client.project_count,
          }))
        : result.results,
  });
});

api.post("/clients", async (c) => {
  const member = c.get("member");
  requireAction(member, "client:manage");
  const input = await jsonBody(c, clientInputSchema);
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO clients (
          id, workspace_id, name, status, billing_contact_name, billing_email, billing_address,
          tax_identifier, default_rate_minor, currency, notes, created_at, updated_at
        ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      member.workspaceId,
      input.name,
      input.billing_contact_name ?? null,
      input.billing_email ?? null,
      input.billing_address ?? null,
      input.tax_identifier ?? null,
      input.default_rate_minor ?? null,
      input.currency,
      input.notes ?? null,
      now,
      now,
    ),
    createAuditStatement(
      c.env.DB,
      member,
      "client.created",
      "client",
      id,
      null,
      input,
      null,
      mutationMeta(c),
      now,
    ),
  ]);
  const client = await c.env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first();
  return c.json({ client }, 201);
});

api.patch("/clients/:id", async (c) => {
  const member = c.get("member");
  requireAction(member, "client:manage");
  const id = idSchema.parse(c.req.param("id"));
  const input = await jsonBody(
    c,
    clientInputSchema.extend({ version: z.number().int().positive() }),
  );
  const existing = await c.env.DB.prepare("SELECT * FROM clients WHERE id = ? AND workspace_id = ?")
    .bind(id, member.workspaceId)
    .first<Record<string, unknown> & { version: number }>();
  if (!existing) throw new ApiError(404, "client_not_found", "Client not found.");
  if (existing.version !== input.version)
    throw new ApiError(409, "client_conflict", "The client changed.");
  const now = Date.now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE clients SET name = ?, billing_contact_name = ?, billing_email = ?, billing_address = ?,
           tax_identifier = ?, default_rate_minor = ?, currency = ?, notes = ?, updated_at = ?,
           version = version + 1 WHERE id = ? AND version = ?`,
      ).bind(
        input.name,
        input.billing_contact_name ?? null,
        input.billing_email ?? null,
        input.billing_address ?? null,
        input.tax_identifier ?? null,
        input.default_rate_minor ?? null,
        input.currency,
        input.notes ?? null,
        now,
        id,
        input.version,
      ),
      ...optimisticVersionGuard(c.env.DB),
      createAuditStatement(
        c.env.DB,
        member,
        "client.updated",
        "client",
        id,
        existing,
        input,
        null,
        mutationMeta(c),
        now,
      ),
    ]);
  } catch (error) {
    if (isOptimisticVersionMismatch(error)) {
      throw new ApiError(409, "client_conflict", "The client changed.");
    }
    throw error;
  }
  return c.json({
    client: await c.env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first(),
  });
});

async function setStatus(
  c: Context<AppContext>,
  table: "clients" | "projects" | "tags",
  id: string,
  status: "active" | "archived",
) {
  const member = c.get("member");
  const action =
    table === "clients" ? "client:manage" : table === "projects" ? "project:manage" : "tag:manage";
  requireAction(member, action);
  const existing = await c.env.DB.prepare(
    `SELECT * FROM ${table} WHERE id = ? AND workspace_id = ?`,
  )
    .bind(id, member.workspaceId)
    .first<Record<string, unknown>>();
  if (!existing) throw new ApiError(404, `${table.slice(0, -1)}_not_found`, "Record not found.");
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE ${table} SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
    ).bind(status, now, id),
    createAuditStatement(
      c.env.DB,
      member,
      `${table.slice(0, -1)}.${status === "active" ? "reactivated" : "archived"}`,
      table.slice(0, -1),
      id,
      existing,
      { status },
      null,
      mutationMeta(c),
      now,
    ),
  ]);
  return c.json({
    record: await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first(),
  });
}

api.post("/clients/:id/archive", (c) =>
  setStatus(c, "clients", idSchema.parse(c.req.param("id")), "archived"),
);
api.post("/clients/:id/reactivate", (c) =>
  setStatus(c, "clients", idSchema.parse(c.req.param("id")), "active"),
);

api.get("/projects", async (c) => {
  const member = c.get("member");
  const conditions = ["p.workspace_id = ?"];
  const bindings: Array<string | number> = [member.workspaceId];
  if (member.role === "member") {
    conditions.push("p.status = 'active'", "c.status = 'active'");
    conditions.push(
      "(p.visibility = 'all' OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.member_id = ?))",
    );
    bindings.push(member.id);
  } else {
    const status = c.req.query("status");
    const clientId = c.req.query("client_id");
    if (status === "active" || status === "archived") {
      conditions.push("p.status = ?");
      bindings.push(status);
    }
    if (clientId) {
      conditions.push("p.client_id = ?");
      bindings.push(clientId);
    }
  }
  const search = c.req.query("search")?.trim();
  if (search) {
    conditions.push("p.name LIKE ? ESCAPE '\\' COLLATE NOCASE");
    bindings.push(
      `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`,
    );
  }
  const result = await c.env.DB.prepare(
    `SELECT p.*, c.name AS client_name, c.status AS client_status,
              COALESCE((SELECT SUM(COALESCE(e.stopped_at, ?) - e.started_at)
                        FROM time_entries e WHERE e.project_id = p.id AND e.deleted_at IS NULL), 0) AS tracked_ms,
              COALESCE((SELECT json_group_array(pm.member_id) FROM project_members pm WHERE pm.project_id = p.id), '[]') AS member_ids_json
       FROM projects p JOIN clients c ON c.id = p.client_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY p.status, c.name, p.name`,
  )
    .bind(Date.now(), ...bindings)
    .all<Record<string, unknown>>();
  return c.json({
    projects:
      member.role === "member"
        ? result.results.map((project) => ({
            id: project.id,
            name: project.name,
            color: project.color,
            client_id: project.client_id,
            client_name: project.client_name,
            billable_default: project.billable_default === 1,
          }))
        : result.results,
  });
});

api.get("/projects/:id/recent", async (c) => {
  const member = c.get("member");
  const projectId = idSchema.parse(c.req.param("id"));
  await getProjectForMember(c.env.DB, member, projectId, true);
  const generatedAt = Date.now();
  const entries = await listEntries(
    c.env.DB,
    member,
    {
      start: 0,
      end: generatedAt + 1,
      projectId,
      limit: 10,
    },
    generatedAt,
  );
  return c.json({
    entries: entries.map((entry) => serializeEntry(entry, member, generatedAt)),
    generated_at: new Date(generatedAt).toISOString(),
  });
});

async function replaceProjectMembers(
  db: D1Database,
  projectId: string,
  memberIds: string[],
  now: number,
): Promise<D1PreparedStatement[]> {
  const unique = [...new Set(memberIds)];
  if (unique.length > 0) {
    const placeholders = unique.map(() => "?").join(",");
    const count =
      (await db
        .prepare(
          `SELECT COUNT(*) AS count FROM members
           WHERE workspace_id = ? AND status = 'active' AND id IN (${placeholders})`,
        )
        .bind(WORKSPACE_ID, ...unique)
        .first<{ count: number }>("count")) ?? 0;
    if (count !== unique.length) {
      throw new ApiError(
        422,
        "project_member_invalid",
        "One or more assigned members are unavailable.",
      );
    }
  }
  return [
    db.prepare("DELETE FROM project_members WHERE project_id = ?").bind(projectId),
    ...unique.map((memberId) =>
      db
        .prepare("INSERT INTO project_members (project_id, member_id, created_at) VALUES (?, ?, ?)")
        .bind(projectId, memberId, now),
    ),
  ];
}

api.post("/projects", async (c) => {
  const member = c.get("member");
  requireAction(member, "project:manage");
  const input = await jsonBody(c, projectInputSchema);
  const client = await c.env.DB.prepare(
    "SELECT status FROM clients WHERE id = ? AND workspace_id = ?",
  )
    .bind(input.client_id, member.workspaceId)
    .first<{ status: string }>();
  if (!client || client.status !== "active") {
    throw new ApiError(422, "client_unavailable", "An active client is required.");
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO projects (
          id, workspace_id, client_id, name, color, status, billable_default, hourly_rate_minor,
          currency, budget_minutes, visibility, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      member.workspaceId,
      input.client_id,
      input.name,
      input.color,
      input.billable_default ? 1 : 0,
      input.hourly_rate_minor ?? null,
      input.currency,
      input.budget_minutes ?? null,
      input.visibility,
      input.notes ?? null,
      now,
      now,
    ),
    ...(await replaceProjectMembers(c.env.DB, id, input.member_ids, now)),
    createAuditStatement(
      c.env.DB,
      member,
      "project.created",
      "project",
      id,
      null,
      input,
      null,
      mutationMeta(c),
      now,
    ),
  ]);
  return c.json(
    { project: await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first() },
    201,
  );
});

api.patch("/projects/:id", async (c) => {
  const member = c.get("member");
  requireAction(member, "project:manage");
  const id = idSchema.parse(c.req.param("id"));
  const input = await jsonBody(
    c,
    projectInputSchema.extend({ version: z.number().int().positive() }),
  );
  const existing = await c.env.DB.prepare(
    "SELECT * FROM projects WHERE id = ? AND workspace_id = ?",
  )
    .bind(id, member.workspaceId)
    .first<Record<string, unknown> & { client_id: string; version: number }>();
  if (!existing) throw new ApiError(404, "project_not_found", "Project not found.");
  if (existing.version !== input.version)
    throw new ApiError(409, "project_conflict", "The project changed.");
  if (existing.client_id !== input.client_id) {
    const historical =
      (
        await c.env.DB.prepare("SELECT COUNT(*) AS count FROM time_entries WHERE project_id = ?")
          .bind(id)
          .first<{ count: number }>()
      )?.count ?? 0;
    if (historical > 0 && !input.confirm_client_change) {
      throw new ApiError(
        409,
        "project_client_change_confirmation_required",
        "Historical entries will keep their client snapshot. Confirm the client change.",
        { historical_entry_count: historical },
      );
    }
  }
  const client = await c.env.DB.prepare(
    "SELECT status FROM clients WHERE id = ? AND workspace_id = ?",
  )
    .bind(input.client_id, member.workspaceId)
    .first<{ status: string }>();
  if (!client || (client.status !== "active" && existing.client_id !== input.client_id)) {
    throw new ApiError(422, "client_unavailable", "An active client is required.");
  }
  const now = Date.now();
  const assignmentStatements = await replaceProjectMembers(c.env.DB, id, input.member_ids, now);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE projects SET client_id = ?, name = ?, color = ?, billable_default = ?,
           hourly_rate_minor = ?, currency = ?, budget_minutes = ?, visibility = ?, notes = ?,
           updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`,
      ).bind(
        input.client_id,
        input.name,
        input.color,
        input.billable_default ? 1 : 0,
        input.hourly_rate_minor ?? null,
        input.currency,
        input.budget_minutes ?? null,
        input.visibility,
        input.notes ?? null,
        now,
        id,
        input.version,
      ),
      ...optimisticVersionGuard(c.env.DB),
      ...assignmentStatements,
      createAuditStatement(
        c.env.DB,
        member,
        "project.updated",
        "project",
        id,
        existing,
        input,
        null,
        mutationMeta(c),
        now,
      ),
    ]);
  } catch (error) {
    if (isOptimisticVersionMismatch(error)) {
      throw new ApiError(409, "project_conflict", "The project changed.");
    }
    throw error;
  }
  return c.json({
    project: await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first(),
  });
});

api.post("/projects/:id/archive", (c) =>
  setStatus(c, "projects", idSchema.parse(c.req.param("id")), "archived"),
);
api.post("/projects/:id/reactivate", (c) =>
  setStatus(c, "projects", idSchema.parse(c.req.param("id")), "active"),
);

api.get("/tags", async (c) => {
  const member = c.get("member");
  const status = c.req.query("status");
  const conditions = ["workspace_id = ?"];
  const bindings: string[] = [member.workspaceId];
  if (member.role === "member") conditions.push("status = 'active'");
  else if (status === "active" || status === "archived") {
    conditions.push("status = ?");
    bindings.push(status);
  }
  const result = await c.env.DB.prepare(
    `SELECT * FROM tags WHERE ${conditions.join(" AND ")} ORDER BY status, name`,
  )
    .bind(...bindings)
    .all();
  return c.json({ tags: result.results });
});

api.post("/tags", async (c) => {
  const member = c.get("member");
  requireAction(member, "tag:manage");
  const input = await jsonBody(c, tagInputSchema);
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO tags (
            id, workspace_id, name, normalized_name, color, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      ).bind(id, member.workspaceId, input.name, normalizeName(input.name), input.color, now, now),
      createAuditStatement(
        c.env.DB,
        member,
        "tag.created",
        "tag",
        id,
        null,
        input,
        null,
        mutationMeta(c),
        now,
      ),
    ]);
  } catch {
    throw new ApiError(409, "tag_name_exists", "A tag with this name already exists.");
  }
  return c.json(
    { tag: await c.env.DB.prepare("SELECT * FROM tags WHERE id = ?").bind(id).first() },
    201,
  );
});

api.patch("/tags/:id", async (c) => {
  const member = c.get("member");
  requireAction(member, "tag:manage");
  const id = idSchema.parse(c.req.param("id"));
  const input = await jsonBody(c, tagInputSchema.extend({ version: z.number().int().positive() }));
  const existing = await c.env.DB.prepare("SELECT * FROM tags WHERE id = ? AND workspace_id = ?")
    .bind(id, member.workspaceId)
    .first<Record<string, unknown> & { version: number }>();
  if (!existing) throw new ApiError(404, "tag_not_found", "Tag not found.");
  if (existing.version !== input.version)
    throw new ApiError(409, "tag_conflict", "The tag changed.");
  const now = Date.now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE tags SET name = ?, normalized_name = ?, color = ?, updated_at = ?,
           version = version + 1 WHERE id = ? AND version = ?`,
      ).bind(input.name, normalizeName(input.name), input.color, now, id, input.version),
      ...optimisticVersionGuard(c.env.DB),
      createAuditStatement(
        c.env.DB,
        member,
        "tag.updated",
        "tag",
        id,
        existing,
        input,
        null,
        mutationMeta(c),
        now,
      ),
    ]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isOptimisticVersionMismatch(error)) {
      throw new ApiError(409, "tag_conflict", "The tag changed.");
    }
    throw new ApiError(409, "tag_name_exists", "A tag with this name already exists.");
  }
  return c.json({
    tag: await c.env.DB.prepare("SELECT * FROM tags WHERE id = ?").bind(id).first(),
  });
});

api.post("/tags/:id/archive", (c) =>
  setStatus(c, "tags", idSchema.parse(c.req.param("id")), "archived"),
);
api.post("/tags/:id/reactivate", (c) =>
  setStatus(c, "tags", idSchema.parse(c.req.param("id")), "active"),
);

api.get("/members", async (c) => {
  const actor = c.get("member");
  requireAction(actor, "member:view");
  const workspace = await getWorkspace(c.env.DB, actor.workspaceId);
  const now = Date.now();
  const localWeekStart = startOfWeek(toZonedTime(now, workspace.timezone), {
    weekStartsOn: workspace.week_start === "monday" ? 1 : 0,
  });
  const weekStart = fromZonedTime(localWeekStart, workspace.timezone).getTime();
  const weekEnd = fromZonedTime(addDays(localWeekStart, 7), workspace.timezone).getTime();
  const result = await c.env.DB.prepare(
    `SELECT m.*,
              (SELECT e.id FROM time_entries e
               WHERE e.member_id = m.id AND e.stopped_at IS NULL AND e.deleted_at IS NULL LIMIT 1) AS running_entry_id,
              COALESCE((SELECT SUM(min(COALESCE(e.stopped_at, ?), ?) - max(e.started_at, ?))
                        FROM time_entries e
                        WHERE e.member_id = m.id AND e.deleted_at IS NULL
                          AND e.started_at < ? AND COALESCE(e.stopped_at, ?) > ?), 0) AS week_tracked_ms,
              COALESCE((SELECT json_group_array(pm.project_id)
                        FROM project_members pm WHERE pm.member_id = m.id), '[]') AS project_ids_json
       FROM members m
       WHERE m.workspace_id = ?
       ORDER BY CASE m.status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, m.display_name`,
  )
    .bind(now, weekEnd, weekStart, weekEnd, now, weekStart, actor.workspaceId)
    .all();
  return c.json({ members: result.results });
});

api.post("/members", async (c) => {
  const actor = c.get("member");
  requireAction(actor, "member:manage-role");
  const input = await jsonBody(c, memberCreateSchema);
  assertValidTimeZone(input.timezone);
  const workspace = await getWorkspace(c.env.DB, actor.workspaceId);
  const email = normalizeEmail(input.email);
  const domain = email.split("@")[1];
  const allowedDomains = z
    .array(z.string())
    .parse(JSON.parse(workspace.allowed_email_domains_json));
  if (!domain || !allowedDomains.includes(domain)) {
    throw new ApiError(422, "email_domain_forbidden", "The email domain is not allowed.");
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO members (
            id, workspace_id, email, email_normalized, display_name, role, status, timezone,
            weekly_target_minutes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      ).bind(
        id,
        actor.workspaceId,
        email,
        email,
        input.display_name,
        input.role,
        input.timezone,
        input.weekly_target_minutes ?? null,
        now,
        now,
      ),
      createAuditStatement(
        c.env.DB,
        actor,
        "member.created",
        "member",
        id,
        null,
        input,
        null,
        mutationMeta(c),
        now,
      ),
    ]);
  } catch {
    throw new ApiError(409, "member_email_exists", "A member with this email already exists.");
  }
  return c.json(
    { member: await c.env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(id).first() },
    201,
  );
});

api.patch("/members/:id", async (c) => {
  const actor = c.get("member");
  requireAction(actor, "member:view");
  const id = idSchema.parse(c.req.param("id"));
  const input = await jsonBody(c, memberUpdateSchema);
  const existing = await c.env.DB.prepare("SELECT * FROM members WHERE id = ? AND workspace_id = ?")
    .bind(id, actor.workspaceId)
    .first<MemberRow>();
  if (!existing) throw new ApiError(404, "member_not_found", "Member not found.");
  if (existing.version !== input.version)
    throw new ApiError(409, "member_conflict", "The member changed.");
  const sensitive = input.role !== undefined || input.status !== undefined;
  const profile =
    input.display_name !== undefined ||
    input.timezone !== undefined ||
    input.weekly_target_minutes !== undefined;
  if ((sensitive || profile) && !can(actor.role, "member:manage-role")) {
    throw new ApiError(
      403,
      "member_manage_forbidden",
      "Managers can only update project assignments.",
    );
  }
  if (input.timezone) assertValidTimeZone(input.timezone);
  const now = Date.now();
  const status = input.status ?? existing.status;
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE members SET display_name = ?, role = ?, status = ?, timezone = ?,
         weekly_target_minutes = ?, updated_at = ?, version = version + 1
         WHERE id = ? AND workspace_id = ? AND version = ?`,
    ).bind(
      input.display_name ?? existing.display_name,
      input.role ?? existing.role,
      status,
      input.timezone ?? existing.timezone,
      input.weekly_target_minutes === undefined
        ? existing.weekly_target_minutes
        : input.weekly_target_minutes,
      now,
      id,
      actor.workspaceId,
      input.version,
    ),
    c.env.DB.prepare("INSERT INTO member_update_checks (updated_rows) VALUES (changes())"),
    c.env.DB.prepare("DELETE FROM member_update_checks"),
  ];
  if (input.status === "inactive") {
    statements.push(
      c.env.DB.prepare(
        `UPDATE time_entries SET stopped_at = ?, updated_at = ?, updated_by = ?, version = version + 1
           WHERE member_id = ? AND stopped_at IS NULL AND deleted_at IS NULL`,
      ).bind(now, now, actor.id, id),
    );
  }
  if (input.project_ids) {
    const projectIds = [...new Set(input.project_ids)];
    if (projectIds.length > 0) {
      const placeholders = projectIds.map(() => "?").join(",");
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO project_assignment_checks (matched_rows)
           SELECT CASE WHEN (
             SELECT COUNT(*) FROM projects
             WHERE workspace_id = ? AND status = 'active' AND id IN (${placeholders})
           ) = ? THEN 1 ELSE 0 END`,
        ).bind(actor.workspaceId, ...projectIds, projectIds.length),
        c.env.DB.prepare("DELETE FROM project_assignment_checks"),
      );
    }
    statements.push(
      c.env.DB.prepare("DELETE FROM project_members WHERE member_id = ?").bind(id),
      ...projectIds.map((projectId) =>
        c.env.DB.prepare(
          `INSERT INTO project_members (project_id, member_id, created_at)
             SELECT id, ?, ? FROM projects WHERE id = ? AND workspace_id = ? AND status = 'active'`,
        ).bind(id, now, projectId, actor.workspaceId),
      ),
    );
  }
  statements.push(
    createAuditStatement(
      c.env.DB,
      actor,
      input.status === "inactive" ? "member.deactivated" : "member.updated",
      "member",
      id,
      existing,
      input,
      null,
      mutationMeta(c),
      now,
    ),
  );
  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("member_update_version_matches")) {
      throw new ApiError(409, "member_conflict", "The member changed.");
    }
    if (message.includes("project_assignment_ids_match")) {
      throw new ApiError(
        422,
        "project_assignment_invalid",
        "One or more assigned projects are unavailable.",
      );
    }
    if (message.includes("last_admin_protected")) {
      throw new ApiError(
        422,
        "last_admin_protected",
        "The final active administrator cannot be changed.",
      );
    }
    throw error;
  }
  return c.json({
    member: await c.env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(id).first(),
  });
});

api.post("/members/:id/reset-access-binding", async (c) => {
  const actor = c.get("member");
  requireAction(actor, "member:reset-binding");
  const id = idSchema.parse(c.req.param("id"));
  const body = await jsonBody(c, z.object({ confirm_email: z.email() }));
  const existing = await c.env.DB.prepare("SELECT * FROM members WHERE id = ? AND workspace_id = ?")
    .bind(id, actor.workspaceId)
    .first<MemberRow>();
  if (!existing) throw new ApiError(404, "member_not_found", "Member not found.");
  if (normalizeEmail(body.confirm_email) !== existing.email_normalized) {
    throw new ApiError(
      422,
      "binding_reset_confirmation_invalid",
      "The confirmation email does not match.",
    );
  }
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE members SET access_subject = NULL, updated_at = ?, version = version + 1 WHERE id = ?",
    ).bind(now, id),
    createAuditStatement(
      c.env.DB,
      actor,
      "member.access_binding_reset",
      "member",
      id,
      { access_subject: existing.access_subject ? "[bound]" : null },
      { access_subject: null },
      "Explicit email confirmation",
      mutationMeta(c),
      now,
    ),
  ]);
  return c.json({ success: true });
});

api.get("/settings", async (c) => {
  const member = c.get("member");
  requireAction(member, "settings:manage");
  const workspace = await getWorkspace(c.env.DB, member.workspaceId);
  return c.json({
    settings: {
      ...workspace,
      allowed_email_domains: z
        .array(z.string())
        .parse(JSON.parse(workspace.allowed_email_domains_json)),
      allowed_email_domains_json: undefined,
      access: {
        configured: c.env.ACCESS_TEAM_DOMAIN !== "None" && !c.env.ACCESS_AUD.includes("["),
        team_domain: c.env.ACCESS_TEAM_DOMAIN === "None" ? null : c.env.ACCESS_TEAM_DOMAIN,
        audience: c.env.ACCESS_AUD.includes("[") ? null : "[configured]",
        bootstrap_admins_configured: Boolean(c.env.BOOTSTRAP_ADMIN_EMAILS),
      },
    },
  });
});

api.patch("/settings", async (c) => {
  const member = c.get("member");
  requireAction(member, "settings:manage");
  const input = await jsonBody(c, settingsUpdateSchema);
  if (input.timezone) assertValidTimeZone(input.timezone);
  const existing = await getWorkspace(c.env.DB, member.workspaceId);
  if (existing.version !== input.version)
    throw new ApiError(409, "settings_conflict", "Settings changed.");
  const next = {
    app_name: input.app_name ?? existing.app_name,
    company_name: input.company_name ?? existing.company_name,
    company_domain: input.company_domain ?? existing.company_domain,
    timezone: input.timezone ?? existing.timezone,
    currency: input.currency ?? existing.currency,
    week_start: input.week_start ?? existing.week_start,
    allowed_email_domains_json:
      input.allowed_email_domains === undefined
        ? existing.allowed_email_domains_json
        : JSON.stringify(input.allowed_email_domains.map((value) => value.toLowerCase())),
    default_rate_minor:
      input.default_rate_minor === undefined
        ? existing.default_rate_minor
        : input.default_rate_minor,
    members_can_set_billable:
      input.members_can_set_billable === undefined
        ? existing.members_can_set_billable
        : input.members_can_set_billable
          ? 1
          : 0,
    lock_entries_after_days:
      input.lock_entries_after_days === undefined
        ? existing.lock_entries_after_days
        : input.lock_entries_after_days,
    rounding_increment_minutes:
      input.rounding_increment_minutes ?? existing.rounding_increment_minutes,
    rounding_method: input.rounding_method ?? existing.rounding_method,
    report_show_descriptions:
      input.report_show_descriptions === undefined
        ? existing.report_show_descriptions
        : input.report_show_descriptions
          ? 1
          : 0,
    report_show_tags:
      input.report_show_tags === undefined
        ? existing.report_show_tags
        : input.report_show_tags
          ? 1
          : 0,
    report_show_members:
      input.report_show_members === undefined
        ? existing.report_show_members
        : input.report_show_members
          ? 1
          : 0,
  };
  const now = Date.now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE workspaces SET app_name = ?, company_name = ?, company_domain = ?, timezone = ?,
         currency = ?, week_start = ?, allowed_email_domains_json = ?, default_rate_minor = ?,
         members_can_set_billable = ?, lock_entries_after_days = ?, rounding_increment_minutes = ?,
         rounding_method = ?, report_show_descriptions = ?, report_show_tags = ?, report_show_members = ?,
         updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`,
      ).bind(
        next.app_name,
        next.company_name,
        next.company_domain,
        next.timezone,
        next.currency,
        next.week_start,
        next.allowed_email_domains_json,
        next.default_rate_minor,
        next.members_can_set_billable,
        next.lock_entries_after_days,
        next.rounding_increment_minutes,
        next.rounding_method,
        next.report_show_descriptions,
        next.report_show_tags,
        next.report_show_members,
        now,
        member.workspaceId,
        input.version,
      ),
      ...optimisticVersionGuard(c.env.DB),
      createAuditStatement(
        c.env.DB,
        member,
        "workspace.settings_updated",
        "workspace",
        member.workspaceId,
        existing,
        next,
        null,
        mutationMeta(c),
        now,
      ),
    ]);
  } catch (error) {
    if (isOptimisticVersionMismatch(error)) {
      throw new ApiError(409, "settings_conflict", "Settings changed.");
    }
    throw error;
  }
  return c.json({ settings: safeWorkspace(await getWorkspace(c.env.DB, member.workspaceId)) });
});

api.get("/audit-log", async (c) => {
  const member = c.get("member");
  requireAction(member, "audit:view");
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 200);
  const before = Number(c.req.query("before") ?? Date.now() + 1);
  const result = await c.env.DB.prepare(
    `SELECT a.*, m.display_name AS actor_name, m.email AS actor_email
       FROM audit_logs a JOIN members m ON m.id = a.actor_member_id
       WHERE a.workspace_id = ? AND a.created_at < ?
       ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
  )
    .bind(member.workspaceId, before, limit)
    .all();
  return c.json({
    events: result.results,
    next_before:
      result.results.length === limit
        ? (result.results.at(-1) as Record<string, unknown> | undefined)?.created_at
        : null,
  });
});

async function reportData(
  c: Context<AppContext>,
  query: z.infer<typeof reportQuerySchema>,
): Promise<{
  rows: ReportRow[];
  workspace: WorkspaceRow;
  generatedAt: number;
  range: { start: number; end: number };
}> {
  assertValidTimeZone(query.timezone);
  const member = c.get("member");
  const generatedAt = Date.now();
  const range = rangeFrom(query.start, query.end);
  const entries = await listEntries(
    c.env.DB,
    member,
    {
      ...range,
      memberId: query.member_id,
      projectId: query.project_id,
      clientId: query.client_id,
      tagId: query.tag_id,
      billable: query.billable === undefined ? undefined : query.billable === "true",
      running: query.running === undefined ? undefined : query.running === "true",
      search: query.search,
      limit: 5001,
    },
    generatedAt,
  );
  if (entries.length > 5000) {
    throw new ApiError(
      422,
      "report_too_large",
      "The report matches more than 5,000 entries. Use a shorter date range or narrower filters.",
      { max_entries: 5000 },
    );
  }
  const workspace = await getWorkspace(c.env.DB, member.workspaceId);
  return {
    rows: toReportRows(entries, workspace, range.start, range.end, generatedAt, query.timezone),
    workspace,
    generatedAt,
    range,
  };
}

api.get("/reports/summary", async (c) => {
  const query = queryInput(c, reportQuerySchema);
  const { rows, workspace, generatedAt } = await reportData(c, query);
  return c.json(
    buildSummary(
      rows,
      c.get("member"),
      workspace,
      query.group_by as GroupDimension,
      query.secondary_group_by as GroupDimension | undefined,
      query.timezone,
      generatedAt,
    ),
  );
});

function detailedReportRow(row: ReportRow, member: AuthenticatedMember, timezone: string) {
  const base = {
    id: row.id,
    date: row.date,
    member: { id: row.memberId, name: row.memberName },
    client: { id: row.clientId, name: row.clientName },
    project: { id: row.projectId, name: row.projectName, color: row.projectColor },
    description: row.description,
    tags: row.tags,
    start: new Date(row.clippedStart).toISOString(),
    stop: row.running ? null : new Date(row.clippedStop).toISOString(),
    local_start: formatInTimeZone(row.clippedStart, timezone, "yyyy-MM-dd HH:mm"),
    local_stop: row.running
      ? null
      : formatInTimeZone(row.clippedStop, timezone, "yyyy-MM-dd HH:mm"),
    raw_duration_ms: row.rawDurationMs,
    rounded_duration_ms: row.roundedDurationMs,
    billable: row.billable,
    running: row.running,
  };
  return hasFinancialAccess(member.role)
    ? {
        ...base,
        rate_minor: row.rateMinor,
        currency: row.currency,
        amount_minor: row.amountMinor,
      }
    : base;
}

api.get("/reports/detailed", async (c) => {
  const query = queryInput(c, reportQuerySchema);
  const { rows, generatedAt } = await reportData(c, query);
  const sorted = [...rows].sort((left, right) => {
    if (query.sort === "started_asc") return left.clippedStart - right.clippedStart;
    if (query.sort === "duration_desc") return right.rawDurationMs - left.rawDurationMs;
    return right.clippedStart - left.clippedStart;
  });
  const offset = query.cursor ? Number(atob(query.cursor)) : 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ApiError(422, "cursor_invalid", "The report cursor is invalid.");
  }
  const page = sorted.slice(offset, offset + query.page_size);
  return c.json({
    generated_at: new Date(generatedAt).toISOString(),
    timezone: query.timezone,
    entries: page.map((row) => detailedReportRow(row, c.get("member"), query.timezone)),
    next_cursor: offset + page.length < sorted.length ? btoa(String(offset + page.length)) : null,
  });
});

const csvExportSchema = reportQuerySchema.extend({
  mode: z.enum(["detailed", "summary"]).default("detailed"),
});

api.post("/exports/csv", async (c) => {
  const member = c.get("member");
  requireAction(member, "report:export");
  const input = await jsonBody(c, csvExportSchema);
  const { rows, workspace, generatedAt } = await reportData(c, input);
  const content =
    input.mode === "detailed"
      ? detailedCsv(rows, input.timezone)
      : summaryCsv(
          buildSummary(
            rows,
            member,
            workspace,
            input.group_by as GroupDimension,
            input.secondary_group_by as GroupDimension | undefined,
            input.timezone,
            generatedAt,
          ).groups as never,
        );
  return new Response(new TextEncoder().encode(content), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hourlark-${input.mode}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

api.post("/exports/pdf", async (c) => {
  const member = c.get("member");
  requireAction(member, "report:export");
  const input = await jsonBody(c, pdfExportSchema);
  const { rows, generatedAt } = await reportData(c, input);
  const filtered = rows.filter(
    (row) =>
      row.clientId === input.client_id &&
      (input.project_ids.length === 0 ||
        (row.projectId && input.project_ids.includes(row.projectId))),
  );
  if (filtered.length > 2000) {
    throw new ApiError(
      422,
      "pdf_too_large",
      "The PDF contains more than 2,000 detail lines. Use a narrower filter.",
    );
  }
  const client = await c.env.DB.prepare("SELECT * FROM clients WHERE id = ? AND workspace_id = ?")
    .bind(input.client_id, member.workspaceId)
    .first<{ name: string; billing_address: string | null }>();
  if (!client) throw new ApiError(404, "client_not_found", "Client not found.");
  const workspace = await getWorkspace(c.env.DB, member.workspaceId);
  const pdf = await createTimeReportPdf(filtered, {
    title: input.title,
    companyName: workspace.company_name,
    clientName: client.name,
    clientAddress: client.billing_address,
    dateRange: formatInclusivePeriod(input.start, input.end, input.timezone),
    timezone: input.timezone,
    reference: input.reference,
    notes: input.notes,
    showMembers: input.show_members,
    showDescriptions: input.show_descriptions,
    showTags: input.show_tags,
    showRates: input.show_rates,
    grouping: input.pdf_grouping,
  });
  return new Response(new Uint8Array(pdf).buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="time-report-${input.start.slice(0, 10)}-${input.end.slice(0, 10)}.pdf"`,
      "Cache-Control": "no-store",
      "X-Report-Generated-At": new Date(generatedAt).toISOString(),
    },
  });
});

export { api };
