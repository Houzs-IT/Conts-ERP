-- Each HR record says which company it belongs to (owner, 12 Nov 2026). The Conts and Dream Crafter share the employees
-- and attendance tables, and a record's company was only implied by which roster id it holds (cleaner_id or technician_id
-- for The Conts, dc_staff_id for Dream Crafter). A query that forgot to look let one company's punches into the other's
-- screens. Now every HR query names its company: employees.company = 'conts' | 'dream_crafter'.
--
--   employees.company   generated from dc_staff_id, so it can never disagree with the roster the record belongs to
--                       (employees_one_company, migration 0185, already keeps a record on one company's rosters).
--
-- Optional: the code reads employees.company only when it exists, and falls back to dc_staff_id until then.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0313, dry run first.
-- REVERSAL: select demo.drop_views(); ALTER TABLE pos.employees DROP COLUMN company; select demo.sync();
set local search_path = pos;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS company TEXT
  GENERATED ALWAYS AS (CASE WHEN dc_staff_id IS NOT NULL THEN 'dream_crafter' ELSE 'conts' END) STORED;
CREATE INDEX IF NOT EXISTS employees_company_idx ON employees (company);

select demo.sync();
