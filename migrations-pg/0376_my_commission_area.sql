-- 0376_my_commission_area: the My commission screen is for salespeople (owner, 25 Nov 2026: "sales 才有这个").
--
-- A new permission area, myCommission (functions/_lib/access.ts). Open (view) for the Sales department, closed for every
-- other department; management departments always have every area. Whatever the menu shows, the engine answers each
-- person with only their own commission (engine/backend/src/scm/routes/renovation-commission.ts).
--
-- REVERSAL: delete from pos.access_rules where area = 'myCommission';
set local search_path = pos;
set local lock_timeout = '5s';

INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'department', d.id, 'myCommission', CASE WHEN lower(d.name) = 'sales' THEN 'view' ELSE 'none' END, 'migration 0376'
FROM departments d
ON CONFLICT (scope, scope_id, area) DO NOTHING;
