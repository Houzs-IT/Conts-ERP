-- A bill's month and the statement that takes it, kept apart (owner, 27 Oct 2026: "这个是记录 utility，这样就根据对的月份；
-- owner report 如果这个月没有扣到就下个月扣"). Spec: docs/superpowers/specs/2026-10-27-utility-bills-design.md §3.
--
--   expenses.deduct_month   YYYY-MM of the owner statement that deducts this expense. Equal to the month of incurred_on
--                           unless a utility bill arrived after its month's statement was final: then the next month
--                           whose statement is still open (set by the utilities save, functions/_lib/expenses.ts).
--                           An expense locks when this month's statement is final.
--   expenses.record_only    kept for the unit's records and reports, never on an owner statement (the 2026 backfill of
--                           bills from months already settled with the owner).
--   expenses.rolled         the save moved deduct_month past the bill's month; the statement line reads "(late bill)".
--
-- Every existing row gets deduct_month = its own month, so no statement changes. Inserts that do not name
-- deduct_month get it from incurred_on (trigger), and so does a changed incurred_on while deduct_month still follows
-- the date (not rolled). A deduction month is never earlier than the bill's own month. A one-off data fix that moves
-- incurred_on but must keep deduct_month runs `set local pos.keep_deduct_month = 'on'` first.
-- About 6,000 rows in production on 27 Oct 2026: the table lock is held for well under a second.
--
-- REVERSAL: DROP TRIGGER expenses_deduct_month ON expenses; DROP FUNCTION expenses_deduct_month();
--           DROP INDEX expenses_unit_deduct_idx; ALTER TABLE expenses DROP CONSTRAINT expenses_deduct_month_shape,
--           DROP COLUMN rolled, DROP COLUMN record_only, DROP COLUMN deduct_month;
set local search_path = pos;
set local lock_timeout = '5s';

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deduct_month TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS record_only BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS rolled BOOLEAN NOT NULL DEFAULT false;
UPDATE expenses SET deduct_month = substr(incurred_on, 1, 7) WHERE deduct_month IS NULL;
ALTER TABLE expenses ALTER COLUMN deduct_month SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_deduct_month_shape') THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_deduct_month_shape CHECK (deduct_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS expenses_unit_deduct_idx ON expenses(unit_id, deduct_month);

CREATE OR REPLACE FUNCTION expenses_deduct_month() RETURNS trigger LANGUAGE plpgsql AS $$
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
  RETURN NEW;
END $$;
ALTER FUNCTION expenses_deduct_month() OWNER TO pos_app;

DROP TRIGGER IF EXISTS expenses_deduct_month ON expenses;
CREATE TRIGGER expenses_deduct_month BEFORE INSERT OR UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION expenses_deduct_month();
