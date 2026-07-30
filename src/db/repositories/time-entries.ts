import { canViewMemberTime, hasFinancialAccess } from "@/domain/permissions/policy";
import { escapeLike } from "@/domain/normalization";
import type { AuthenticatedMember, WorkspaceRow } from "@/domain/types";
import { ApiError } from "@/worker/errors";

export interface ProjectRow {
  id: string;
  workspace_id: string;
  client_id: string;
  name: string;
  color: string;
  status: "active" | "archived";
  billable_default: number;
  hourly_rate_minor: number | null;
  currency: string;
  budget_minutes: number | null;
  visibility: "all" | "assigned";
  notes: string | null;
  created_at: number;
  updated_at: number;
  version: number;
  client_name?: string;
  client_status?: "active" | "archived";
  client_rate_minor?: number | null;
  client_currency?: string;
}

export interface TagRow {
  id: string;
  workspace_id: string;
  name: string;
  normalized_name: string;
  color: string;
  status: "active" | "archived";
  created_at: number;
  updated_at: number;
  version: number;
}

export interface EntryJoinedRow {
  id: string;
  workspace_id: string;
  member_id: string;
  project_id: string | null;
  client_id: string | null;
  description: string;
  started_at: number;
  stopped_at: number | null;
  billable: number;
  rate_minor: number | null;
  rate_currency: string | null;
  rate_source: "entry" | "project" | "client" | "workspace" | "none";
  deleted_at: number | null;
  deleted_by: string | null;
  created_by: string;
  updated_by: string;
  created_at: number;
  updated_at: number;
  version: number;
  member_name: string;
  member_email: string;
  project_name: string | null;
  project_color: string | null;
  project_budget_minutes: number | null;
  client_name: string | null;
  tags_json: string;
}

const entryProjection = `
  SELECT e.*,
         m.display_name AS member_name,
         m.email AS member_email,
         p.name AS project_name,
         p.color AS project_color,
         p.budget_minutes AS project_budget_minutes,
         c.name AS client_name,
         COALESCE((
           SELECT json_group_array(json_object('id', t.id, 'name', t.name, 'color', t.color, 'status', t.status))
           FROM time_entry_tags et
           JOIN tags t ON t.id = et.tag_id
           WHERE et.time_entry_id = e.id
         ), '[]') AS tags_json
  FROM time_entries e
  JOIN members m ON m.id = e.member_id
  LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN clients c ON c.id = e.client_id
`;

export function parseTags(value: string): Array<{
  id: string;
  name: string;
  color: string;
  status: string;
}> {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (tag): tag is { id: string; name: string; color: string; status: string } =>
            typeof tag === "object" &&
            tag !== null &&
            typeof (tag as Record<string, unknown>).id === "string" &&
            typeof (tag as Record<string, unknown>).name === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function serializeEntry(row: EntryJoinedRow, viewer: AuthenticatedMember, now = Date.now()) {
  const financial = hasFinancialAccess(viewer.role);
  const stoppedAt = row.stopped_at ?? now;
  const base = {
    id: row.id,
    member: { id: row.member_id, name: row.member_name, email: row.member_email },
    project: row.project_id
      ? { id: row.project_id, name: row.project_name, color: row.project_color }
      : null,
    client: row.client_id ? { id: row.client_id, name: row.client_name } : null,
    description: row.description,
    tags: parseTags(row.tags_json),
    started_at: new Date(row.started_at).toISOString(),
    stopped_at: row.stopped_at === null ? null : new Date(row.stopped_at).toISOString(),
    duration_ms: Math.max(0, stoppedAt - row.started_at),
    running: row.stopped_at === null,
    billable: row.billable === 1,
    deleted_at: row.deleted_at === null ? null : new Date(row.deleted_at).toISOString(),
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    version: row.version,
  };
  return financial
    ? {
        ...base,
        rate_minor: row.rate_minor,
        rate_currency: row.rate_currency,
        rate_source: row.rate_source,
      }
    : base;
}

export async function loadEntry(db: D1Database, entryId: string): Promise<EntryJoinedRow | null> {
  return db.prepare(`${entryProjection} WHERE e.id = ?`).bind(entryId).first<EntryJoinedRow>();
}

export async function loadActiveTimer(
  db: D1Database,
  memberId: string,
): Promise<EntryJoinedRow | null> {
  return db
    .prepare(
      `${entryProjection} WHERE e.member_id = ? AND e.stopped_at IS NULL AND e.deleted_at IS NULL`,
    )
    .bind(memberId)
    .first<EntryJoinedRow>();
}

export interface EntryListFilters {
  start: number;
  end: number;
  memberId?: string;
  projectId?: string;
  clientId?: string;
  tagId?: string;
  billable?: boolean;
  running?: boolean;
  search?: string;
  includeDeleted?: boolean;
  limit?: number;
}

export async function listEntries(
  db: D1Database,
  viewer: AuthenticatedMember,
  filters: EntryListFilters,
  generatedAt: number,
): Promise<EntryJoinedRow[]> {
  if (filters.memberId && !canViewMemberTime(viewer, filters.memberId)) {
    throw new ApiError(403, "member_time_forbidden", "You cannot view this member's time.");
  }
  const effectiveMemberId = viewer.role === "member" ? viewer.id : filters.memberId;
  const conditions = ["e.workspace_id = ?", "e.started_at < ?", "COALESCE(e.stopped_at, ?) > ?"];
  const bindings: Array<string | number> = [
    viewer.workspaceId,
    filters.end,
    generatedAt,
    filters.start,
  ];
  if (!filters.includeDeleted) conditions.push("e.deleted_at IS NULL");
  if (effectiveMemberId) {
    conditions.push("e.member_id = ?");
    bindings.push(effectiveMemberId);
  }
  if (filters.projectId) {
    conditions.push("e.project_id = ?");
    bindings.push(filters.projectId);
  }
  if (filters.clientId) {
    conditions.push("e.client_id = ?");
    bindings.push(filters.clientId);
  }
  if (filters.tagId) {
    conditions.push(
      "EXISTS (SELECT 1 FROM time_entry_tags filter_tag WHERE filter_tag.time_entry_id = e.id AND filter_tag.tag_id = ?)",
    );
    bindings.push(filters.tagId);
  }
  if (filters.billable !== undefined) {
    conditions.push("e.billable = ?");
    bindings.push(filters.billable ? 1 : 0);
  }
  if (filters.running !== undefined) {
    conditions.push(filters.running ? "e.stopped_at IS NULL" : "e.stopped_at IS NOT NULL");
  }
  if (filters.search) {
    conditions.push("e.description LIKE ? ESCAPE '\\' COLLATE NOCASE");
    bindings.push(`%${escapeLike(filters.search)}%`);
  }
  const limit = Math.min(Math.max(filters.limit ?? 1000, 1), 5000);
  bindings.push(limit);
  const result = await db
    .prepare(
      `${entryProjection}
       WHERE ${conditions.join(" AND ")}
       ORDER BY (e.stopped_at IS NULL) DESC, e.started_at DESC, e.id DESC
       LIMIT ?`,
    )
    .bind(...bindings)
    .all<EntryJoinedRow>();
  return result.results;
}

export async function getWorkspace(db: D1Database, workspaceId: string): Promise<WorkspaceRow> {
  const workspace = await db
    .prepare("SELECT * FROM workspaces WHERE id = ?")
    .bind(workspaceId)
    .first<WorkspaceRow>();
  if (!workspace) throw new ApiError(500, "workspace_missing", "The workspace is not configured.");
  return workspace;
}

export async function getProjectForMember(
  db: D1Database,
  viewer: AuthenticatedMember,
  projectId: string,
  allowArchived = false,
): Promise<ProjectRow> {
  const project = await db
    .prepare(
      `SELECT p.*, c.name AS client_name, c.status AS client_status,
              c.default_rate_minor AS client_rate_minor, c.currency AS client_currency
       FROM projects p
       JOIN clients c ON c.id = p.client_id
       WHERE p.id = ? AND p.workspace_id = ?`,
    )
    .bind(projectId, viewer.workspaceId)
    .first<ProjectRow>();
  if (!project) throw new ApiError(404, "project_not_found", "Project not found.");
  if (!allowArchived && (project.status !== "active" || project.client_status !== "active")) {
    throw new ApiError(422, "project_archived", "Archived projects cannot be used for new time.");
  }
  if (viewer.role === "member" && project.visibility === "assigned") {
    const assignment = await db
      .prepare("SELECT 1 AS allowed FROM project_members WHERE project_id = ? AND member_id = ?")
      .bind(project.id, viewer.id)
      .first<{ allowed: number }>();
    if (!assignment) {
      throw new ApiError(403, "project_not_assigned", "This project is not assigned to you.");
    }
  }
  return project;
}

export async function validateActiveTags(
  db: D1Database,
  workspaceId: string,
  tagIds: string[],
): Promise<TagRow[]> {
  const uniqueIds = [...new Set(tagIds)];
  if (uniqueIds.length === 0) return [];
  const placeholders = uniqueIds.map(() => "?").join(",");
  const result = await db
    .prepare(
      `SELECT * FROM tags WHERE workspace_id = ? AND status = 'active' AND id IN (${placeholders})`,
    )
    .bind(workspaceId, ...uniqueIds)
    .all<TagRow>();
  if (result.results.length !== uniqueIds.length) {
    throw new ApiError(422, "tag_invalid", "One or more tags are unavailable.");
  }
  return result.results;
}

export interface RateSnapshot {
  rateMinor: number | null;
  currency: string | null;
  source: "project" | "client" | "workspace" | "none";
}

export async function resolveRate(
  db: D1Database,
  workspaceId: string,
  project: ProjectRow | null,
): Promise<RateSnapshot> {
  if (project?.hourly_rate_minor !== null && project?.hourly_rate_minor !== undefined) {
    return { rateMinor: project.hourly_rate_minor, currency: project.currency, source: "project" };
  }
  if (project?.client_rate_minor !== null && project?.client_rate_minor !== undefined) {
    return {
      rateMinor: project.client_rate_minor,
      currency: project.client_currency ?? project.currency,
      source: "client",
    };
  }
  const workspace = await getWorkspace(db, workspaceId);
  if (workspace.default_rate_minor !== null) {
    return {
      rateMinor: workspace.default_rate_minor,
      currency: workspace.currency,
      source: "workspace",
    };
  }
  return { rateMinor: null, currency: null, source: "none" };
}

export async function hasOverlap(
  db: D1Database,
  memberId: string,
  startedAt: number,
  stoppedAt: number,
  excludeEntryId?: string,
): Promise<boolean> {
  const condition = excludeEntryId ? "AND id <> ?" : "";
  const result = await db
    .prepare(
      `SELECT 1 AS overlap
       FROM time_entries
       WHERE member_id = ? AND deleted_at IS NULL
         AND started_at < ? AND COALESCE(stopped_at, ?) > ?
         ${condition}
       LIMIT 1`,
    )
    .bind(memberId, stoppedAt, stoppedAt, startedAt, ...(excludeEntryId ? [excludeEntryId] : []))
    .first<{ overlap: number }>();
  return result !== null;
}
