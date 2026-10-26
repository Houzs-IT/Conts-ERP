-- The employee record (HR, owner 26 Oct 2026, PLAN-hr-employees.md phase 1), ported from Hookka's Employee Master.
-- Employees are the company's own field staff only: in-house cleaners and in-house technicians. Outside companies stay
-- on the rosters and are not employees; office staff stay as logins.
--
--   employees   one HR record per person. Name and phone stay on the roster (cleaners / technicians), so there is one
--               place to change them. A person on both rosters (one login, both lists) has one record holding both ids.
--               A row is made the first time someone saves the record; until then the Employees tab shows the roster
--               entry with the defaults below.
--
-- Money is integer sen, as everywhere else. Tax fields are null until declared: there is no safe default (assuming
-- single over-withholds from a married sole earner, assuming resident under-withholds from a non-resident).
-- Statutory deductions start off, as on Hookka (its migration 0136), and are switched on per person.
--
-- Optional: the code reads employees only when the table exists; without it the Employees tab answers "needs a
-- database update".
--
-- REVERSAL: DROP TABLE employees;  (nothing else is changed by this file)
set local search_path = pos;

CREATE TABLE IF NOT EXISTS employees (
  id                      TEXT PRIMARY KEY,
  cleaner_id              TEXT UNIQUE REFERENCES cleaners(id),
  technician_id           TEXT UNIQUE REFERENCES technicians(id),
  ic_number               TEXT,
  passport_number         TEXT,
  nationality             TEXT,
  join_date               TEXT CHECK (join_date IS NULL OR join_date ~ '^\d{4}-\d{2}-\d{2}$'),
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resigned')),
  resigned_at             TEXT CHECK (resigned_at IS NULL OR resigned_at ~ '^\d{4}-\d{2}-\d{2}$'),
  pay_basis               TEXT NOT NULL DEFAULT 'monthly' CHECK (pay_basis IN ('monthly','daily')),
  basic_salary_sen        INTEGER NOT NULL DEFAULT 0 CHECK (basic_salary_sen >= 0),
  daily_rate_sen          INTEGER NOT NULL DEFAULT 0 CHECK (daily_rate_sen >= 0),
  working_days_per_month  INTEGER NOT NULL DEFAULT 26 CHECK (working_days_per_month BETWEEN 1 AND 31),
  working_hours_per_day   NUMERIC(4,2) NOT NULL DEFAULT 8 CHECK (working_hours_per_day > 0 AND working_hours_per_day <= 24),
  ot_multiplier           NUMERIC(3,2) NOT NULL DEFAULT 1.5 CHECK (ot_multiplier >= 1 AND ot_multiplier <= 5),
  payment_method          TEXT NOT NULL DEFAULT 'transfer' CHECK (payment_method IN ('transfer','cash')),
  bank_name               TEXT,
  bank_account            TEXT,
  epf_enabled             INTEGER NOT NULL DEFAULT 0,
  socso_enabled           INTEGER NOT NULL DEFAULT 0,
  eis_enabled             INTEGER NOT NULL DEFAULT 0,
  pcb_enabled             INTEGER NOT NULL DEFAULT 0,
  tax_residency           TEXT CHECK (tax_residency IN ('resident','non_resident')),
  tax_category            TEXT CHECK (tax_category IN ('single','married_spouse_not_working','married_spouse_working')),
  tax_child_relief_sen    INTEGER CHECK (tax_child_relief_sen >= 0),
  annual_leave_days       INTEGER CHECK (annual_leave_days BETWEEN 0 AND 60),
  medical_leave_days      INTEGER CHECK (medical_leave_days BETWEEN 0 AND 60),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  CHECK (cleaner_id IS NOT NULL OR technician_id IS NOT NULL),
  CHECK (status = 'active' OR resigned_at IS NOT NULL)
);
-- cleaner_id and technician_id are indexed by their UNIQUE constraints. Roster entries are switched off, never deleted,
-- so the default (refuse the delete) keeps an HR record from losing its person.

ALTER TABLE employees OWNER TO pos_app;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON employees TO pos_app;
