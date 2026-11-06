-- REVERSAL: UPDATE pos.access_rules SET level = 'none' WHERE scope = 'department' AND area = 'comms' AND updated_by = 'migration 0212';
-- The Admin department counts as operation (owner, 4 Nov 2026), so it gets Messages with customer service, operation and
-- management (see 0207). Its one position stores no comms row, so the department's level applies.
set local search_path = pos;

INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'department', d.id, 'comms', 'edit', 'migration 0212'
FROM departments d WHERE d.name = 'Admin'
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by;
