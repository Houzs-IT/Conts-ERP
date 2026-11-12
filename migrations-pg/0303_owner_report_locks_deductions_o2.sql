-- Owner report stage locks, part 2a: deductions and O2 (spec docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md,
-- plan docs/superpowers/plans/2026-11-11-owner-report-locks-part2a-deductions-o2.md). chew, 12 Nov 2026: "可以，先做 2a".
--
--   access               lockDeductions and lockO2 (the two new powers): closed for every department until management
--                        opens them; chew gives them per person. Unlocking any step stays unlockStep (0302).
--   expenses_deduct_month() (0174's trigger function) also keeps new costs out of a month whose deductions are locked
--                        for the unit: a cost charged to the owner and dated in such a month (or moved into it: another
--                        unit, another month, charged to the owner again) goes on the first later month that is neither
--                        locked for the unit nor final for its owner, as a late bill (rolled). Every path that writes
--                        costs goes through it, including a lock taken between a screen's check and its insert. An
--                        edit that changes only the amount, description or category leaves the month alone: the locked
--                        month keeps what it locked, and the late update posts the difference (functions/_lib/ownerLocks.ts).
--                        A write whose search path has no owner_report_locks (a session outside the app) skips the check.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0303, dry run first.
-- REVERSAL: re-create 0174's expenses_deduct_month() body (the block below marked 0303 removed); the access rules can stay.
set local search_path = pos;
set local lock_timeout = '5s';

select demo.drop_views();

-- Closed for every department until management opens them; a department's own rule wins over its Finance baseline.
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'department', d.id, a.area, 'none', 'migration 0303'
FROM departments d CROSS JOIN (VALUES ('lockDeductions'), ('lockO2')) a(area)
ON CONFLICT (scope, scope_id, area) DO NOTHING;

CREATE OR REPLACE FUNCTION expenses_deduct_month() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  m text;
  owner_of text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deduct_month IS NULL THEN NEW.deduct_month := substr(NEW.incurred_on, 1, 7); END IF;
  ELSIF NEW.incurred_on IS DISTINCT FROM OLD.incurred_on
    AND NEW.deduct_month IS NOT DISTINCT FROM OLD.deduct_month
    AND NOT NEW.rolled
    AND coalesce(current_setting('pos.keep_deduct_month', true), '') <> 'on' THEN
    NEW.deduct_month := substr(NEW.incurred_on, 1, 7);
  END IF;
  -- A bill is never deducted before its own month (a date moved past a rolled deduction month).
  IF NEW.deduct_month < substr(NEW.incurred_on, 1, 7) THEN
    NEW.deduct_month := substr(NEW.incurred_on, 1, 7);
    NEW.rolled := false;
  END IF;
  -- 0303 (owner statement close): a month whose deductions are locked for the unit takes no new cost. It goes on the
  -- first later month that is neither locked for the unit nor final for its owner, as a late bill.
  -- The search path is checked in an outer IF of its own: PL/pgSQL plans a whole condition before it runs it, so a
  -- query on owner_report_locks in the same condition would fail where that table is not on the path.
  IF NEW.charge_to = 'owner' AND NOT NEW.record_only AND NEW.deduct_month >= '2026-10'
     AND (TG_OP = 'INSERT' OR NEW.deduct_month IS DISTINCT FROM OLD.deduct_month OR NEW.unit_id IS DISTINCT FROM OLD.unit_id
          OR NEW.charge_to IS DISTINCT FROM OLD.charge_to OR NEW.record_only IS DISTINCT FROM OLD.record_only)
     AND to_regclass('owner_report_locks') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM owner_report_locks l WHERE l.unit_id = NEW.unit_id AND l.stage = 'deductions' AND l.month = NEW.deduct_month) THEN
      SELECT u.owner_id INTO owner_of FROM units u WHERE u.id = NEW.unit_id;
      m := NEW.deduct_month;
      LOOP
        m := to_char((m || '-01')::date + interval '1 month', 'YYYY-MM');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM owner_report_locks l WHERE l.unit_id = NEW.unit_id AND l.stage = 'deductions' AND l.month = m)
          AND NOT EXISTS (SELECT 1 FROM owner_statements s WHERE s.owner_id = owner_of AND s.period_start = m || '-01' AND s.state IN ('finalised', 'sent', 'paid'));
      END LOOP;
      NEW.deduct_month := m;
      NEW.rolled := true;
    END IF;
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION expenses_deduct_month() OWNER TO pos_app;

-- Rebuild the Demo mode overlay (migration 0203); its expense store runs the same function.
select demo.sync();
