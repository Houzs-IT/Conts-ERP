-- Payroll (HR phase 4, owner 26 Oct 2026, PLAN-hr-employees.md), ported from Hookka's payslips, salary history and
-- employee advances. Rules as Hookka has them (owner: "leave the rules"), kept in one setting the office can change.
--
--   employee_salary_history   basic salary by the date it takes effect. A month is paid on the salary in force on its
--                             last day. Written by the Employees form when basic salary changes.
--   employee_advances         money paid out ahead of payday. Taken back in full by the payslip of the advance's own
--                             month (no carry-forward, as on Hookka); settled when that payslip is approved.
--   payslips                  one per employee per month. Draft while the office checks it (regenerated freely), then
--                             approved, then paid. Every figure is stored in sen with the rules used, so a later rule
--                             change never rewrites a slip already given out. pcb_status says whether PCB was really
--                             worked out (COMPUTED / ZERO_PROVEN) or not (UNKNOWN / DISABLED): only the first two print
--                             an amount.
--   settings 'hr.pay_rules'   EPF %, SOCSO and EIS amounts, overtime block, Sunday and public-holiday rates, whether
--                             emergency leave is paid. Hookka's defaults until the office changes them.
--
-- Optional: the code reads these only when payslips exists; without it the Payroll tab and the Pay screen answer
-- "needs a database update".
--
-- REVERSAL: DROP TABLE payslips; DROP TABLE employee_advances; DROP TABLE employee_salary_history;
--           DELETE FROM settings WHERE key = 'hr.pay_rules';
set local search_path = pos;

CREATE TABLE IF NOT EXISTS employee_salary_history (
  id                TEXT PRIMARY KEY,
  employee_id       TEXT NOT NULL REFERENCES employees(id),
  basic_salary_sen  INTEGER NOT NULL CHECK (basic_salary_sen >= 0),
  effective_from    TEXT NOT NULL CHECK (effective_from ~ '^\d{4}-\d{2}-\d{2}$'),
  note              TEXT,
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  UNIQUE (employee_id, effective_from)
);

CREATE TABLE IF NOT EXISTS employee_advances (
  id              TEXT PRIMARY KEY,
  employee_id     TEXT NOT NULL REFERENCES employees(id),
  advance_date    TEXT NOT NULL CHECK (advance_date ~ '^\d{4}-\d{2}-\d{2}$'),
  amount_sen      INTEGER NOT NULL CHECK (amount_sen > 0),
  note            TEXT,
  status          TEXT NOT NULL DEFAULT 'unsettled' CHECK (status IN ('unsettled','settled')),
  settled_period  TEXT CHECK (settled_period IS NULL OR settled_period ~ '^\d{4}-\d{2}$'),
  entered_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS employee_advances_employee_idx ON employee_advances(employee_id, advance_date);

CREATE TABLE IF NOT EXISTS payslips (
  id                     TEXT PRIMARY KEY,
  employee_id            TEXT NOT NULL REFERENCES employees(id),
  period                 TEXT NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid')),
  -- Who and how, as they were when the slip was made.
  employee_name          TEXT NOT NULL,
  employee_no            TEXT,
  pay_basis              TEXT NOT NULL CHECK (pay_basis IN ('monthly','daily')),
  payment_method         TEXT NOT NULL CHECK (payment_method IN ('transfer','cash')),
  bank_name              TEXT,
  bank_account           TEXT,
  -- Earnings.
  basic_salary_sen       INTEGER NOT NULL,
  day_rate_sen           INTEGER NOT NULL,
  hour_rate_sen          INTEGER NOT NULL,
  working_days           INTEGER NOT NULL,
  days_worked            INTEGER NOT NULL,
  paid_leave_days        INTEGER NOT NULL,
  absent_days            INTEGER NOT NULL,
  absence_deduction_sen  INTEGER NOT NULL,
  ot_hours               NUMERIC(6,2) NOT NULL,
  ot_sen                 INTEGER NOT NULL,
  sunday_hours           NUMERIC(6,2) NOT NULL,
  sunday_sen             INTEGER NOT NULL,
  holiday_hours          NUMERIC(6,2) NOT NULL,
  holiday_sen            INTEGER NOT NULL,
  gross_sen              INTEGER NOT NULL,
  -- Statutory, employee and employer shares.
  epf_employee_sen       INTEGER NOT NULL,
  epf_employer_sen       INTEGER NOT NULL,
  socso_employee_sen     INTEGER NOT NULL,
  socso_employer_sen     INTEGER NOT NULL,
  eis_employee_sen       INTEGER NOT NULL,
  eis_employer_sen       INTEGER NOT NULL,
  pcb_sen                INTEGER NOT NULL,
  pcb_status             TEXT NOT NULL CHECK (pcb_status IN ('DISABLED','COMPUTED','ZERO_PROVEN','UNKNOWN')),
  pcb_note               TEXT NOT NULL,
  advance_sen            INTEGER NOT NULL,
  total_deductions_sen   INTEGER NOT NULL,
  net_sen                INTEGER NOT NULL,    -- not clamped: an advance bigger than the month shows as owed
  rules                  JSONB NOT NULL,
  generated_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
  generated_at           TEXT NOT NULL,
  approved_by            TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at            TEXT,
  paid_by                TEXT REFERENCES users(id) ON DELETE SET NULL,
  paid_at                TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  UNIQUE (employee_id, period)
);
-- The month's run; employee_id + period is indexed by the UNIQUE constraint.
CREATE INDEX IF NOT EXISTS payslips_period_idx ON payslips(period, status);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['employee_salary_history','employee_advances','payslips'] LOOP
    EXECUTE format('ALTER TABLE %I OWNER TO pos_app', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO pos_app', t);
  END LOOP;
END $$;

-- Each employee's current salary becomes their first history row, from the day they joined (or the start of this month).
INSERT INTO employee_salary_history (id, employee_id, basic_salary_sen, effective_from, note, created_at)
SELECT 'sh-' || e.id, e.id, e.basic_salary_sen, COALESCE(e.join_date, to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-01')),
       'Salary when payroll started', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
FROM employees e WHERE e.basic_salary_sen > 0
ON CONFLICT DO NOTHING;
