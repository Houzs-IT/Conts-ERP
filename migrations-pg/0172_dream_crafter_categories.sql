-- Dream Crafter's permission category split into its sidebar sections (owner, 26 Oct 2026): Service cases, Projects and
-- Supply chain, each with its own baseline (functions/_lib/access.ts). Every stored 'group:Dream Crafter' baseline is
-- copied to the three new keys, so nobody's access changes.
--
-- The old 'group:Dream Crafter' rows stay: the code before this change still reads them, and the new code skips a key it
-- does not know (loadRuleBook). Delete them once this code is live everywhere:
--   DELETE FROM pos.access_rules WHERE area = 'group:Dream Crafter';
--
-- REVERSAL: DELETE FROM pos.access_rules WHERE area IN ('group:Service cases', 'group:Projects', 'group:Supply chain');
set local search_path = pos;

INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT r.scope, r.scope_id, g.area, r.level, r.updated_by
FROM access_rules r
CROSS JOIN (VALUES ('group:Service cases'), ('group:Projects'), ('group:Supply chain')) AS g(area)
WHERE r.area = 'group:Dream Crafter'
ON CONFLICT (scope, scope_id, area) DO NOTHING;
