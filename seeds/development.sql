INSERT OR IGNORE INTO members (
  id, workspace_id, email, email_normalized, display_name, role, status, timezone, created_at, updated_at
) VALUES
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'sheikh.abdullah@iomechs.com', 'sheikh.abdullah@iomechs.com', 'Sheikh Abdullah', 'admin', 'active', 'Asia/Karachi', 1785369600000, 1785369600000),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'manager@iomechs.com', 'manager@iomechs.com', 'IOMechs Manager', 'manager', 'active', 'Asia/Karachi', 1785369600000, 1785369600000),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', 'member@iomechs.com', 'member@iomechs.com', 'IOMechs Member', 'member', 'active', 'Asia/Karachi', 1785369600000, 1785369600000);

INSERT OR IGNORE INTO clients (
  id, workspace_id, name, status, currency, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000001',
  'Internal',
  'active',
  'USD',
  1785369600000,
  1785369600000
);

INSERT OR IGNORE INTO projects (
  id, workspace_id, client_id, name, color, status, billable_default, currency, visibility, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'Internal operations',
  '#14852b',
  'active',
  0,
  'USD',
  'all',
  1785369600000,
  1785369600000
);

UPDATE projects
SET color = '#14852b'
WHERE id = '00000000-0000-4000-8000-000000000301'
  AND color = '#0f766e';
