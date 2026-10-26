-- Worker Penalty (HR > Employees, owner 26 Oct 2026), ported from Hookka's worker_penalties and worker_penalty_lines.
-- Hookka raises a penalty against a production order; The Conts against a cleaning job or a repair job (optional, as
-- Hookka's order is).
--
--   worker_penalties        one penalty: number WP-0001, date, the job it is about (kind + id, with its unit and title
--                           kept as written), reason, remarks. draft -> pending (submitted) -> approved -> posted, or
--                           back to draft when rejected (with the reason) or revoked before it is posted.
--   worker_penalty_lines    who pays and how much. Approving sets each line's payroll month: the approval month, or
--                           the next month whose payslip for that person is still open. The line is posted when that
--                           payslip is approved, and unposted if it is reopened; the penalty is posted once all are.
--   payslips.penalty_sen    the month's penalties, taken after statutory and PCB like an advance (Hookka).
--
-- REVERSAL: ALTER TABLE payslips DROP COLUMN penalty_sen; DROP TABLE worker_penalty_lines; DROP TABLE worker_penalties;
--           DROP SEQUENCE worker_penalty_no_seq;
set local search_path = pos;

CREATE SEQUENCE IF NOT EXISTS worker_penalty_no_seq;
ALTER SEQUENCE worker_penalty_no_seq OWNER TO pos_app;

CREATE TABLE IF NOT EXISTS worker_penalties (
  id               TEXT PRIMARY KEY,
  penalty_no       TEXT NOT NULL UNIQUE,
  penalty_date     TEXT NOT NULL CHECK (penalty_date ~ '^\d{4}-\d{2}-\d{2}$'),
  job_kind         TEXT CHECK (job_kind IN ('cleaning','repair')),
  job_id           TEXT,
  job_ref          TEXT,
  reason           TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  remarks          TEXT,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','posted')),
  rejected_reason  TEXT,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at     TEXT,
  approved_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  CHECK ((job_kind IS NULL) = (job_id IS NULL))
);
CREATE INDEX IF NOT EXISTS worker_penalties_status_idx ON worker_penalties(status, penalty_date);

CREATE TABLE IF NOT EXISTS worker_penalty_lines (
  id              TEXT PRIMARY KEY,
  penalty_id      TEXT NOT NULL REFERENCES worker_penalties(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL REFERENCES employees(id),
  amount_sen      INTEGER NOT NULL CHECK (amount_sen > 0),
  payroll_period  TEXT CHECK (payroll_period IS NULL OR payroll_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  payslip_id      TEXT REFERENCES payslips(id) ON DELETE SET NULL,
  posted_at       TEXT,
  UNIQUE (penalty_id, employee_id)
);
-- A penalty's lines are found through the UNIQUE constraint; payroll reads a person's month.
CREATE INDEX IF NOT EXISTS worker_penalty_lines_payroll_idx ON worker_penalty_lines(employee_id, payroll_period);
CREATE INDEX IF NOT EXISTS worker_penalty_lines_payslip_idx ON worker_penalty_lines(payslip_id) WHERE payslip_id IS NOT NULL;

ALTER TABLE payslips ADD COLUMN IF NOT EXISTS penalty_sen INTEGER NOT NULL DEFAULT 0;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['worker_penalties','worker_penalty_lines'] LOOP
    EXECUTE format('ALTER TABLE %I OWNER TO pos_app', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO pos_app', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE worker_penalty_no_seq TO pos_app;
