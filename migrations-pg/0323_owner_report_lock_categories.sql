-- Unit report click-to-lock (spec docs/superpowers/specs/2026-11-13-unit-report-click-locks-design.md, plan
-- docs/superpowers/plans/2026-11-13-unit-report-click-locks.md). chew, 13 Nov 2026: the deductions lock is split, so
-- Cleaning, Utilities, Add. ded. and Misc are each locked on their own ("这个我想要分开", "这个也分开可以吗").
--
--   owner_report_locks.stage   'income', 'cleaning', 'utilities', 'additional', 'misc', 'o2' ('deductions' retired).
--                              Refused while a 'deductions' lock exists: unlock those first (production had none on
--                              13 Nov 2026), since their posted late differences name the old lock.
--   expenses_deduct_month()    (0174, 0303) keeps a new cost out of a month only when the cost's own category is locked
--                              for the unit there: cleaning (cleaning, housekeeping), utilities (electricity, water,
--                              internet, sewerage, or utilities with Indah Water in the description), or other deductions
--                              (anything else) — the same split as ownerStatement.ts classifyCost / stageLocks.ts
--                              costStageOf. The cost goes on the first later month whose same category is neither
--                              locked for the unit nor final for its owner, as a late bill. Everything else as 0303.
--   access                     no change: Lock deductions covers Cleaning, Utilities, Add. ded. and Misc.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0323, dry run first.
-- REVERSAL: once no cleaning, utilities, additional or misc lock exists, put 0302's stage list back and 0303's function
-- body (the lock lookups on stage 'deductions').
set local search_path = pos;
set local lock_timeout = '5s';

select demo.drop_views();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM owner_report_locks WHERE stage = 'deductions') THEN
    RAISE EXCEPTION 'Unlock every deductions lock (Owner statement close) before migration 0323 splits them.';
  END IF;
END $$;

ALTER TABLE owner_report_locks DROP CONSTRAINT IF EXISTS owner_report_locks_stage_check;
ALTER TABLE owner_report_locks ADD CONSTRAINT owner_report_locks_stage_check
  CHECK (stage IN ('income', 'cleaning', 'utilities', 'additional', 'misc', 'o2'));

CREATE OR REPLACE FUNCTION expenses_deduct_month() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  m text;
  owner_of text;
  stage_of text;
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
  -- 0303, by category since 0323: a month whose category is locked for the unit takes no new cost of that category. It
  -- goes on the first later month that is neither locked for that category on the unit nor final for its owner.
  -- The search path is checked in an outer IF of its own: PL/pgSQL plans a whole condition before it runs it, so a
  -- query on owner_report_locks in the same condition would fail where that table is not on the path.
  IF NEW.charge_to = 'owner' AND NOT NEW.record_only AND NEW.deduct_month >= '2026-10'
     AND (TG_OP = 'INSERT' OR NEW.deduct_month IS DISTINCT FROM OLD.deduct_month OR NEW.unit_id IS DISTINCT FROM OLD.unit_id
          OR NEW.charge_to IS DISTINCT FROM OLD.charge_to OR NEW.record_only IS DISTINCT FROM OLD.record_only)
     AND to_regclass('owner_report_locks') IS NOT NULL THEN
    stage_of := CASE
      WHEN NEW.category IN ('cleaning', 'housekeeping') THEN 'cleaning'
      WHEN NEW.category IN ('electricity', 'water', 'internet', 'sewerage')
        OR (NEW.category = 'utilities' AND coalesce(NEW.description, '') ~* 'indah|sewer|iwk') THEN 'utilities'
      ELSE 'additional' END;
    IF EXISTS (SELECT 1 FROM owner_report_locks l WHERE l.unit_id = NEW.unit_id AND l.stage = stage_of AND l.month = NEW.deduct_month) THEN
      SELECT u.owner_id INTO owner_of FROM units u WHERE u.id = NEW.unit_id;
      m := NEW.deduct_month;
      LOOP
        m := to_char((m || '-01')::date + interval '1 month', 'YYYY-MM');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM owner_report_locks l WHERE l.unit_id = NEW.unit_id AND l.stage = stage_of AND l.month = m)
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
