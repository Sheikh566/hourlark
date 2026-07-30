export const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

export const roles = ["member", "manager", "admin"] as const;
export type Role = (typeof roles)[number];

export const memberStatuses = ["pending", "active", "inactive"] as const;
export type MemberStatus = (typeof memberStatuses)[number];

export interface AuthenticatedMember {
  id: string;
  workspaceId: string;
  email: string;
  displayName: string;
  role: Role;
  status: MemberStatus;
  timezone: string;
  accessSubject: string | null;
}

export interface MemberRow {
  id: string;
  workspace_id: string;
  email: string;
  email_normalized: string;
  display_name: string;
  role: Role;
  status: MemberStatus;
  access_subject: string | null;
  timezone: string;
  weekly_target_minutes: number | null;
  last_seen_at: number | null;
  created_at: number;
  updated_at: number;
  version: number;
}

export interface WorkspaceRow {
  id: string;
  app_name: string;
  company_name: string;
  company_domain: string;
  timezone: string;
  currency: string;
  week_start: "monday" | "sunday";
  allowed_email_domains_json: string;
  default_rate_minor: number | null;
  members_can_set_billable: number;
  lock_entries_after_days: number | null;
  rounding_increment_minutes: number;
  rounding_method: "nearest" | "up" | "down";
  report_show_descriptions: number;
  report_show_tags: number;
  report_show_members: number;
  bootstrap_completed_at: number | null;
  created_at: number;
  updated_at: number;
  version: number;
}

export type AppVariables = {
  member: AuthenticatedMember;
  requestId: string;
};

export type AppContext = {
  Bindings: Env;
  Variables: AppVariables;
};

export function toAuthenticatedMember(row: MemberRow): AuthenticatedMember {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    timezone: row.timezone,
    accessSubject: row.access_subject,
  };
}
