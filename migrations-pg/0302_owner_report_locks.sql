-- Owner report stage locks, part 1 (spec docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md,
-- plan docs/superpowers/plans/2026-11-11-owner-report-locks-part1-income.md). chew, 11 Nov 2026: each month's owner
-- report is checked in stages (income, deductions, O2) and every stage, once checked, is locked unit by unit.
--
--   owner_report_locks   one row per unit, month and stage: who locked it and when. For income, `frozen` keeps the
--                        stays (and a long-term let's rent) the month was worked out from, so the locked figures never
--                        change; a later change reaches the owner as an owner adjustment on the next open month.
--   owner_adjustments    source 'stage_lock': that difference, and the balancing line when a month is unlocked after
--                        its difference was already settled on a final statement.
--   access               ownerClose (the page), lockIncome and unlockStep: closed for every department until
--                        management opens them (chew gives them per person).
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0302, dry run first
-- (the Demo overlay views over these tables are rebuilt at the end, as in 0258 and 0259).
-- REVERSAL: nothing reads the table until the code ships; leave it empty, or remove it together with a redeploy.
set local search_path = pos;
set local lock_timeout = '5s';

select demo.drop_views();

CREATE TABLE IF NOT EXISTS owner_report_locks (
  id              TEXT PRIMARY KEY,
  month           TEXT NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$' AND month >= '2026-10'),
  unit_id         TEXT NOT NULL REFERENCES units(id),
  stage           TEXT NOT NULL CHECK (stage IN ('income', 'deductions', 'o2')),
  frozen          JSONB NOT NULL DEFAULT '{}'::jsonb,
  locked_by       TEXT NOT NULL,
  locked_by_name  TEXT NOT NULL,
  locked_at       TEXT NOT NULL,
  UNIQUE (month, unit_id, stage)
);
CREATE INDEX IF NOT EXISTS owner_report_locks_unit ON owner_report_locks (unit_id, stage, month);
ALTER TABLE owner_report_locks OWNER TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON owner_report_locks TO pos_app;

ALTER TABLE owner_adjustments DROP CONSTRAINT IF EXISTS owner_adjustments_source_check;
ALTER TABLE owner_adjustments ADD CONSTRAINT owner_adjustments_source_check
  CHECK (source IN ('manual', 'owner_workbook', 'airbnb_recon', 'stage_lock'));

-- Closed for every department until management opens them; a department's own rule wins over its Finance baseline.
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'department', d.id, a.area, 'none', 'migration 0302'
FROM departments d CROSS JOIN (VALUES ('ownerClose'), ('lockIncome'), ('unlockStep')) a(area)
ON CONFLICT (scope, scope_id, area) DO NOTHING;

-- Rebuild the Demo mode overlay (migration 0203) so demo_pos has the new table too.
select demo.sync();
