-- Part 2b of docs/superpowers/plans/2026-11-12-split-permission-areas-part2.md.
--   Supply chain > Production (production orders, SKU composition, draft delivery) gets its own area, scProduction.
--   It followed Procurement (scProcurement) until now.
--
-- Nobody's level changes on the day it ships: scProduction copies every stored scProcurement row, at every scope.
-- Both sit in the Supply chain category, so a category baseline still reaches both alike. The engine also gives
-- Production the Procurement level when a sign-on from older code leaves it out (engine/backend/src/conts/access.ts).
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0309, dry run first.
-- REVERSAL: DELETE FROM pos.access_rules WHERE updated_by = 'migration 0309';
set local search_path = pos;

INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT r.scope, r.scope_id, 'scProduction', r.level, 'migration 0309'
FROM access_rules r
WHERE r.area = 'scProcurement'
ON CONFLICT (scope, scope_id, area) DO NOTHING;
