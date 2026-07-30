PRAGMA foreign_keys = ON;

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  app_name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  company_domain TEXT NOT NULL,
  timezone TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  week_start TEXT NOT NULL DEFAULT 'monday' CHECK (week_start IN ('monday', 'sunday')),
  allowed_email_domains_json TEXT NOT NULL,
  default_rate_minor INTEGER CHECK (default_rate_minor IS NULL OR default_rate_minor >= 0),
  members_can_set_billable INTEGER NOT NULL DEFAULT 1 CHECK (members_can_set_billable IN (0, 1)),
  lock_entries_after_days INTEGER CHECK (lock_entries_after_days IS NULL OR lock_entries_after_days >= 0),
  rounding_increment_minutes INTEGER NOT NULL DEFAULT 0 CHECK (rounding_increment_minutes IN (0, 1, 5, 6, 10, 15, 30, 60)),
  rounding_method TEXT NOT NULL DEFAULT 'nearest' CHECK (rounding_method IN ('nearest', 'up', 'down')),
  report_show_descriptions INTEGER NOT NULL DEFAULT 1 CHECK (report_show_descriptions IN (0, 1)),
  report_show_tags INTEGER NOT NULL DEFAULT 1 CHECK (report_show_tags IN (0, 1)),
  report_show_members INTEGER NOT NULL DEFAULT 1 CHECK (report_show_members IN (0, 1)),
  bootstrap_completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('member', 'manager', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'inactive')),
  access_subject TEXT,
  timezone TEXT NOT NULL,
  weekly_target_minutes INTEGER CHECK (weekly_target_minutes IS NULL OR weekly_target_minutes >= 0),
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, email_normalized)
);

CREATE UNIQUE INDEX members_access_subject_unique
  ON members(workspace_id, access_subject)
  WHERE access_subject IS NOT NULL;

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  billing_contact_name TEXT,
  billing_email TEXT,
  billing_address TEXT,
  tax_identifier TEXT,
  default_rate_minor INTEGER CHECK (default_rate_minor IS NULL OR default_rate_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX clients_workspace_status_name ON clients(workspace_id, status, name);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  billable_default INTEGER NOT NULL DEFAULT 1 CHECK (billable_default IN (0, 1)),
  hourly_rate_minor INTEGER CHECK (hourly_rate_minor IS NULL OR hourly_rate_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  budget_minutes INTEGER CHECK (budget_minutes IS NULL OR budget_minutes >= 0),
  visibility TEXT NOT NULL DEFAULT 'all' CHECK (visibility IN ('all', 'assigned')),
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX projects_workspace_client_status ON projects(workspace_id, client_id, status, name);

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, member_id)
);

CREATE INDEX project_members_member ON project_members(member_id, project_id);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  color TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, normalized_name)
);

CREATE TABLE time_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  project_id TEXT REFERENCES projects(id),
  client_id TEXT REFERENCES clients(id),
  description TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL,
  stopped_at INTEGER CHECK (stopped_at IS NULL OR stopped_at > started_at),
  billable INTEGER NOT NULL DEFAULT 0 CHECK (billable IN (0, 1)),
  rate_minor INTEGER CHECK (rate_minor IS NULL OR rate_minor >= 0),
  rate_currency TEXT CHECK (rate_currency IS NULL OR length(rate_currency) = 3),
  rate_source TEXT NOT NULL DEFAULT 'none' CHECK (rate_source IN ('entry', 'project', 'client', 'workspace', 'none')),
  deleted_at INTEGER,
  deleted_by TEXT REFERENCES members(id),
  created_by TEXT NOT NULL REFERENCES members(id),
  updated_by TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX one_running_timer_per_member
  ON time_entries(workspace_id, member_id)
  WHERE stopped_at IS NULL AND deleted_at IS NULL;
CREATE INDEX time_entries_member_range ON time_entries(workspace_id, member_id, started_at DESC);
CREATE INDEX time_entries_project_range ON time_entries(workspace_id, project_id, started_at DESC);
CREATE INDEX time_entries_client_range ON time_entries(workspace_id, client_id, started_at DESC);
CREATE INDEX time_entries_report_filters ON time_entries(workspace_id, billable, stopped_at, started_at);

CREATE TABLE time_entry_tags (
  time_entry_id TEXT NOT NULL REFERENCES time_entries(id),
  tag_id TEXT NOT NULL REFERENCES tags(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (time_entry_id, tag_id)
);

CREATE INDEX time_entry_tags_tag ON time_entry_tags(tag_id, time_entry_id);

CREATE TABLE idempotency_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  action TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, member_id, action, idempotency_key)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  actor_member_id TEXT NOT NULL REFERENCES members(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  request_id TEXT NOT NULL,
  cf_ray TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX audit_logs_workspace_created ON audit_logs(workspace_id, created_at DESC, id DESC);
CREATE INDEX audit_logs_target ON audit_logs(workspace_id, target_type, target_id, created_at DESC);

CREATE TRIGGER audit_logs_immutable_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit logs are immutable');
END;

CREATE TRIGGER audit_logs_immutable_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit logs are immutable');
END;

INSERT INTO workspaces (
  id,
  app_name,
  company_name,
  company_domain,
  timezone,
  currency,
  week_start,
  allowed_email_domains_json,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'IOMechs Time',
  'IOMechs',
  'iomechs.com',
  'Asia/Karachi',
  'USD',
  'monday',
  '["iomechs.com"]',
  1785369600000,
  1785369600000
);
