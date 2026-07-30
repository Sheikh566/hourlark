export type Role = "member" | "manager" | "admin";

export interface MeResponse {
  member: {
    id: string;
    workspaceId: string;
    email: string;
    displayName: string;
    role: Role;
    status: string;
    timezone: string;
  };
  workspace: {
    id: string;
    app_name: string;
    company_name: string;
    company_domain: string;
    timezone: string;
    currency: string;
    week_start: "monday" | "sunday";
    members_can_set_billable: boolean;
    lock_entries_after_days: number | null;
    rounding_increment_minutes: number;
    rounding_method: string;
    version: number;
  };
  permissions: {
    view_team: boolean;
    financial: boolean;
    export: boolean;
    manage_workspace: boolean;
    manage_members: boolean;
    view_audit: boolean;
  };
  active_timer: TimeEntry | null;
  csrf_token: string;
  server_now: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  status: string;
  version?: number;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  client_id: string;
  client_name: string;
  client_status?: string;
  status?: string;
  billable_default: boolean | number;
  hourly_rate_minor?: number | null;
  currency?: string;
  budget_minutes?: number | null;
  visibility?: "all" | "assigned";
  notes?: string | null;
  tracked_ms?: number;
  member_ids_json?: string;
  version?: number;
}

export interface Client {
  id: string;
  name: string;
  status: "active" | "archived";
  billing_contact_name?: string | null;
  billing_email?: string | null;
  billing_address?: string | null;
  tax_identifier?: string | null;
  default_rate_minor?: number | null;
  currency?: string;
  notes?: string | null;
  project_count?: number;
  tracked_ms?: number;
  version?: number;
}

export interface TimeEntry {
  id: string;
  member: { id: string; name: string; email?: string };
  project: { id: string; name: string | null; color: string | null } | null;
  client: { id: string; name: string | null } | null;
  description: string;
  tags: Tag[];
  started_at: string;
  stopped_at: string | null;
  duration_ms: number;
  running: boolean;
  billable: boolean;
  rate_minor?: number | null;
  rate_currency?: string | null;
  rate_source?: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface Member {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  status: "pending" | "active" | "inactive";
  timezone: string;
  weekly_target_minutes: number | null;
  last_seen_at: number | null;
  running_entry_id: string | null;
  week_tracked_ms: number;
  project_ids_json: string;
  access_subject?: string | null;
  version: number;
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    request_id: string;
    fields?: Array<{ path: string; message: string }>;
    authoritative?: unknown;
  };
}
