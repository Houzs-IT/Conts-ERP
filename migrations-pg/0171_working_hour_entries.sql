-- Working Hours (HR > Employees, owner 26 Oct 2026: "payroll reads the grid, like Hookka"), ported from Hookka's
-- working_hour_entries.
--
--   working_hour_entries   the hours one employee worked on one day in one department (Cleaning, Maintenance). The
--                          office keys or corrects them on the Working Hours tab, starting from the phone punches. A day
--                          split between departments has one row per department. Payroll reads these hours: a day
--                          with rows is paid on their total, a day with only a punch on the punch.
--
-- REVERSAL: DROP TABLE working_hour_entries;  (payroll then reads the punches again)
set local search_path = pos;

CREATE TABLE IF NOT EXISTS working_hour_entries (
  id             TEXT PRIMARY KEY,
  employee_id    TEXT NOT NULL REFERENCES employees(id),
  work_date      TEXT NOT NULL CHECK (work_date ~ '^\d{4}-\d{2}-\d{2}$'),
  department     TEXT NOT NULL CHECK (department IN ('cleaning','maintenance')),
  hours          NUMERIC(5,2) NOT NULL CHECK (hours >= 0 AND hours <= 24),
  notes          TEXT,
  attendance_id  TEXT REFERENCES attendance(id) ON DELETE SET NULL,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (employee_id, work_date, department)
);
-- The grid and payroll read a date range for everyone; employee_id is indexed by the UNIQUE constraint.
CREATE INDEX IF NOT EXISTS working_hour_entries_date_idx ON working_hour_entries(work_date);
CREATE INDEX IF NOT EXISTS working_hour_entries_attendance_idx ON working_hour_entries(attendance_id) WHERE attendance_id IS NOT NULL;

ALTER TABLE working_hour_entries OWNER TO pos_app;
ALTER TABLE working_hour_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON working_hour_entries TO pos_app;
