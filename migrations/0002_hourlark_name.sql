-- Rename the original workspace branding while preserving customized names.
UPDATE workspaces
SET app_name = 'Hourlark',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE app_name = 'IOMechs Time';
