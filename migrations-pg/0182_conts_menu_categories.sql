-- The Conts' permission categories become its sidebar sections (owner, 30 Oct 2026): Home, Reports, Reservations,
-- Operations, HR, Units, Finance, Growth, System (functions/_lib/access.ts). Workspace is renamed Home, and three areas
-- whose pages sat in two sections are split: Pricing and reviews off Performance, Automations off Messages (was
-- Communication), Reports off Finance. Three areas change category: Performance (Growth to Home), Messages (Growth to
-- Reservations) and Owners (Finance to Units).
--
-- Nobody's level changes. A person's level in an area is the first of: their own row, their position's area row, their
-- department's area row, their position's category baseline, their department's category baseline (resolveFor).
--   1. Each split area gets a copy of the old area's rows, at every scope.
--   2. Each new category gets a copy of the baseline its areas mostly came from: Home from Workspace, Reports from
--      Finance, Reservations and Units from Operations.
--   3. An area that moved away from its old category's baseline is pinned to the level it had, as its own row, wherever
--      the new baseline would otherwise decide it. Positions are pinned first, against their department's rows as they
--      were before this file, so a department's own area row keeps beating a position's baseline.
-- One limit: step 3 reads a position's department from positions.department_id, so a person whose position belongs to
-- another department can resolve differently. Nobody is set up like that today.
--
-- Dream Crafter closes the new categories, as it closed Workspace, Operations and Growth. That does change two areas
-- for a person who works on the Dream Crafter side only: Owners and Reports (the yearly unit report) close, as both now
-- sit in The Conts' sections. Management and people on both sides keep them.
--
-- The old 'group:Workspace' rows stay: the code before this change still reads them, and the new code skips a key it
-- does not know. Delete them once this code is live everywhere:
--   DELETE FROM pos.access_rules WHERE area = 'group:Workspace';
--
-- REVERSAL: DELETE FROM pos.access_rules WHERE updated_by = 'migration 0182';
set local search_path = pos;

-- 1. Split areas.
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT r.scope, r.scope_id, m.new_area, r.level, 'migration 0182'
FROM access_rules r
JOIN (VALUES ('finance', 'reports'), ('performance', 'pricing'), ('comms', 'automations')) AS m(old_area, new_area) ON m.old_area = r.area
ON CONFLICT (scope, scope_id, area) DO NOTHING;

-- 3a. Pins at position scope, before any department pin exists. An 'inherit' row counts as no row.
WITH moved(area, old_group, main_group) AS (
  VALUES ('performance', 'group:Growth', 'group:Workspace'),
         ('comms', 'group:Growth', 'group:Operations'),
         ('owners', 'group:Finance', 'group:Operations')
)
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'position', p.id, mv.area, COALESCE(pg.level, dg.level, 'none'), 'migration 0182'
FROM positions p
CROSS JOIN moved mv
LEFT JOIN access_rules pg ON pg.scope = 'position' AND pg.scope_id = p.id AND pg.area = mv.old_group AND pg.level <> 'inherit'
LEFT JOIN access_rules pm ON pm.scope = 'position' AND pm.scope_id = p.id AND pm.area = mv.main_group AND pm.level <> 'inherit'
LEFT JOIN access_rules dg ON dg.scope = 'department' AND dg.scope_id = p.department_id AND dg.area = mv.old_group AND dg.level <> 'inherit'
WHERE (pg.area IS NOT NULL OR pm.area IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM access_rules da
                   WHERE da.scope = 'department' AND da.scope_id = p.department_id AND da.area = mv.area AND da.level <> 'inherit')
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by
  WHERE access_rules.level = 'inherit';

-- 3b. Pins at department scope.
WITH moved(area, old_group, main_group) AS (
  VALUES ('performance', 'group:Growth', 'group:Workspace'),
         ('comms', 'group:Growth', 'group:Operations'),
         ('owners', 'group:Finance', 'group:Operations')
)
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'department', d.id, mv.area, COALESCE(dg.level, 'none'), 'migration 0182'
FROM departments d
CROSS JOIN moved mv
LEFT JOIN access_rules dg ON dg.scope = 'department' AND dg.scope_id = d.id AND dg.area = mv.old_group AND dg.level <> 'inherit'
LEFT JOIN access_rules dm ON dm.scope = 'department' AND dm.scope_id = d.id AND dm.area = mv.main_group AND dm.level <> 'inherit'
WHERE dg.area IS NOT NULL OR dm.area IS NOT NULL
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by
  WHERE access_rules.level = 'inherit';

-- 2. New category baselines.
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT r.scope, r.scope_id, g.new_group, r.level, 'migration 0182'
FROM access_rules r
JOIN (VALUES ('group:Workspace', 'group:Home'), ('group:Finance', 'group:Reports'),
             ('group:Operations', 'group:Reservations'), ('group:Operations', 'group:Units')) AS g(old_group, new_group) ON g.old_group = r.area
WHERE r.level <> 'inherit'
ON CONFLICT (scope, scope_id, area) DO NOTHING;
