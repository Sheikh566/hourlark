-- A zero-row optimistic update is not a SQL error. Check changes() immediately
-- after that update so D1 rolls back the batch before any dependent writes.
CREATE TABLE member_update_checks (
  updated_rows INTEGER NOT NULL
    CONSTRAINT member_update_version_matches CHECK (updated_rows = 1)
);

CREATE TRIGGER members_last_active_admin
BEFORE UPDATE OF role, status, workspace_id ON members
WHEN OLD.role = 'admin' AND OLD.status = 'active'
  AND (NEW.role != 'admin' OR NEW.status != 'active' OR NEW.workspace_id != OLD.workspace_id)
  AND NOT EXISTS (
    SELECT 1 FROM members
    WHERE workspace_id = OLD.workspace_id AND id != OLD.id
      AND role = 'admin' AND status = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'last_admin_protected');
END;
