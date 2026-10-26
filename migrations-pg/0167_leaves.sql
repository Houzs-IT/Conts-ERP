-- Leave (HR phase 3, owner 26 Oct 2026, PLAN-hr-employees.md), ported from Hookka's leaves and leave-entitlement.
-- Cleaners and technicians apply on the portal (Me); the office approves on Workers > Leave.
--
--   leaves   one request. days is the calendar span (weekends included, as on Hookka: there is no rest-day list); the
--            public holidays inside it are taken off when a balance is counted, so changing the holiday list fixes
--            balances without touching requests. A request counts against its start date's calendar year.
--            Annual and medical draw down an allowance; emergency and unpaid are recorded only.
--   settings 'hr.public_holidays'   JSON list of { date, name }, kept on Workers > Leave.
--
-- Optional: the code reads leaves only when the table exists; without it the Me screen and the Leave tab answer
-- "needs a database update".
--
-- REVERSAL: DROP TABLE leaves; DELETE FROM settings WHERE key = 'hr.public_holidays';
set local search_path = pos;

CREATE TABLE IF NOT EXISTS leaves (
  id             TEXT PRIMARY KEY,
  employee_id    TEXT NOT NULL REFERENCES employees(id),
  type           TEXT NOT NULL CHECK (type IN ('annual','medical','emergency','unpaid')),
  start_date     TEXT NOT NULL CHECK (start_date ~ '^\d{4}-\d{2}-\d{2}$'),
  end_date       TEXT NOT NULL CHECK (end_date ~ '^\d{4}-\d{2}-\d{2}$'),
  days           INTEGER NOT NULL CHECK (days BETWEEN 1 AND 60),
  reason         TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_at     TEXT,
  decision_note  TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  CHECK (end_date >= start_date)
);
-- A person's requests (balances, overlap check), and the office's queue of pending ones.
CREATE INDEX IF NOT EXISTS leaves_employee_idx ON leaves(employee_id, start_date);
CREATE INDEX IF NOT EXISTS leaves_pending_idx ON leaves(status, start_date) WHERE status = 'pending';

ALTER TABLE leaves OWNER TO pos_app;
ALTER TABLE leaves ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON leaves TO pos_app;

INSERT INTO settings (key, value, updated_at) VALUES ('hr.public_holidays', '[]', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
ON CONFLICT (key) DO NOTHING;
