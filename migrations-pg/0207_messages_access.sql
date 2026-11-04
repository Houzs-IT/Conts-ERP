-- REVERSAL: restore access_rules rows with updated_by = 'migration 0207' to level 'none'.
-- Messages is for customer service, operation and management (owner, 4 Nov 2026). Management is always full. The
-- Property Management department is the operation side and its Customer Service position is the customer service side,
-- so the department gets edit, and its Admin position's stored 'none' stops overriding it. Procurement sits in that
-- department but handles no guests, so it stays closed.
set local search_path = pos;

INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'department', d.id, 'comms', 'edit', 'migration 0207'
FROM departments d WHERE d.name = 'Property Management'
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by;

INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'position', p.id, 'comms', CASE WHEN p.name = 'Procurement' THEN 'none' ELSE 'edit' END, 'migration 0207'
FROM positions p JOIN departments d ON d.id = p.department_id
WHERE d.name = 'Property Management' AND p.name IN ('Admin', 'Customer Service', 'Procurement')
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by;
