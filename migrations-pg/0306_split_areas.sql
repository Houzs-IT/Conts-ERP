-- One permission box per menu page (plan docs/superpowers/plans/2026-11-12-split-permission-areas.md, phase 1).
--   Operations: Operations becomes Today; Cleaning and Maintenance are new.
--   Units: Scheduled changes, Agent to let and Unit settings split off Units; Contracts off Owners; Deductions off
--          Finance, and it moves from the Finance category to Units.
--   Growth: Reviews splits off Pricing.
--
-- Nobody's level changes. Each new area gets a copy of every stored row of the area it came from, at every scope.
-- Deductions also changes category, so it is pinned, as its own row, to the level Finance gave it wherever a
-- Finance or Units baseline would otherwise decide it (positions first, as in migrations 0182 and 0305).
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0306, dry run first,
-- after 0304 and 0305.
-- REVERSAL: DELETE FROM pos.access_rules WHERE updated_by = 'migration 0306';
set local search_path = pos;

INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT r.scope, r.scope_id, split.new_area, r.level, 'migration 0306'
FROM access_rules r
JOIN (VALUES ('operations', 'cleaning'), ('operations', 'maintenance'),
             ('properties', 'scheduledChanges'), ('properties', 'agentToLet'), ('properties', 'unitSettings'),
             ('owners', 'contracts'), ('pricing', 'reviews'), ('finance', 'deductions')) AS split(old_area, new_area)
  ON split.old_area = r.area
ON CONFLICT (scope, scope_id, area) DO NOTHING;

INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'position', p.id, 'deductions', COALESCE(position_finance.level, department_finance.level, 'none'), 'migration 0306'
FROM positions p
LEFT JOIN access_rules position_finance ON position_finance.scope = 'position' AND position_finance.scope_id = p.id
  AND position_finance.area = 'group:Finance' AND position_finance.level <> 'inherit'
LEFT JOIN access_rules position_units ON position_units.scope = 'position' AND position_units.scope_id = p.id
  AND position_units.area = 'group:Units' AND position_units.level <> 'inherit'
LEFT JOIN access_rules department_finance ON department_finance.scope = 'department' AND department_finance.scope_id = p.department_id
  AND department_finance.area = 'group:Finance' AND department_finance.level <> 'inherit'
WHERE (position_finance.area IS NOT NULL OR position_units.area IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM access_rules department_area
                   WHERE department_area.scope = 'department' AND department_area.scope_id = p.department_id
                     AND department_area.area = 'finance' AND department_area.level <> 'inherit')
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by
  WHERE access_rules.level = 'inherit';

INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'department', d.id, 'deductions', COALESCE(department_finance.level, 'none'), 'migration 0306'
FROM departments d
LEFT JOIN access_rules department_finance ON department_finance.scope = 'department' AND department_finance.scope_id = d.id
  AND department_finance.area = 'group:Finance' AND department_finance.level <> 'inherit'
LEFT JOIN access_rules department_units ON department_units.scope = 'department' AND department_units.scope_id = d.id
  AND department_units.area = 'group:Units' AND department_units.level <> 'inherit'
WHERE department_finance.area IS NOT NULL OR department_units.area IS NOT NULL
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by
  WHERE access_rules.level = 'inherit';
