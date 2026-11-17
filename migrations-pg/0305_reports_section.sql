-- Portfolio and Performance move from the Home category to Reports, with the menu: Reports holds Portfolio, Overall
-- unit report, Performance, Yearly unit report and YGRR report. Ticking the Reports category sets all of them at once.
--
-- Nobody's level changes. Both areas are pinned, as their own row, to the level they had wherever a Home or Reports
-- baseline would decide them, the same way migration 0182 pinned the areas that changed category. Positions are
-- pinned first, against their department's rows as they were before this file.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0305, dry run first.
-- REVERSAL: DELETE FROM pos.access_rules WHERE updated_by = 'migration 0305';
set local search_path = pos;

WITH moved(area) AS (VALUES ('portfolio'), ('performance'))
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'position', p.id, mv.area, COALESCE(position_home.level, department_home.level, 'none'), 'migration 0305'
FROM positions p
CROSS JOIN moved mv
LEFT JOIN access_rules position_home ON position_home.scope = 'position' AND position_home.scope_id = p.id
  AND position_home.area = 'group:Home' AND position_home.level <> 'inherit'
LEFT JOIN access_rules position_reports ON position_reports.scope = 'position' AND position_reports.scope_id = p.id
  AND position_reports.area = 'group:Reports' AND position_reports.level <> 'inherit'
LEFT JOIN access_rules department_home ON department_home.scope = 'department' AND department_home.scope_id = p.department_id
  AND department_home.area = 'group:Home' AND department_home.level <> 'inherit'
WHERE (position_home.area IS NOT NULL OR position_reports.area IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM access_rules department_area
                   WHERE department_area.scope = 'department' AND department_area.scope_id = p.department_id
                     AND department_area.area = mv.area AND department_area.level <> 'inherit')
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by
  WHERE access_rules.level = 'inherit';

WITH moved(area) AS (VALUES ('portfolio'), ('performance'))
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'department', d.id, mv.area, COALESCE(department_home.level, 'none'), 'migration 0305'
FROM departments d
CROSS JOIN moved mv
LEFT JOIN access_rules department_home ON department_home.scope = 'department' AND department_home.scope_id = d.id
  AND department_home.area = 'group:Home' AND department_home.level <> 'inherit'
LEFT JOIN access_rules department_reports ON department_reports.scope = 'department' AND department_reports.scope_id = d.id
  AND department_reports.area = 'group:Reports' AND department_reports.level <> 'inherit'
WHERE department_home.area IS NOT NULL OR department_reports.area IS NOT NULL
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by
  WHERE access_rules.level = 'inherit';
