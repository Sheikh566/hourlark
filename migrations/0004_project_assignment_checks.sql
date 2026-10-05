-- A replacement list that names a missing or inactive project must abort the
-- batch before project_members is deleted. A zero count fails the check.
CREATE TABLE project_assignment_checks (
  matched_rows INTEGER NOT NULL
    CONSTRAINT project_assignment_ids_match CHECK (matched_rows = 1)
);
