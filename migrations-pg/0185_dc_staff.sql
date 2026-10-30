-- Dream Crafter employees (owner, 30 Oct 2026): Dream Crafter's own staff in HR, kept apart from The Conts' two rosters.
--
--   dc_staff    Dream Crafter's roster: name and phone, as cleaners and technicians hold them for The Conts.
--   employees   gains dc_staff_id, so a Dream Crafter person's HR record is the same record The Conts uses. A record
--               belongs to one company: a cleaner and/or a technician (The Conts), or a Dream Crafter staff member.
--
-- The Conts' lists (Employees, Attendance, Payroll, Worker Penalty) are built from cleaners and technicians, so a
-- Dream Crafter record never shows on them. No clock-in yet: dc_staff has no login.
--
-- Optional: the code reads Dream Crafter employees only when employees.dc_staff_id exists; without it the page answers
-- "needs a database update".
--
-- REVERSAL (once no Dream Crafter records are wanted):
--   DELETE FROM employees WHERE dc_staff_id IS NOT NULL;
--   ALTER TABLE employees DROP CONSTRAINT employees_one_company;
--   ALTER TABLE employees ADD CONSTRAINT employees_check CHECK (cleaner_id IS NOT NULL OR technician_id IS NOT NULL);
--   ALTER TABLE employees DROP COLUMN dc_staff_id; DROP TABLE dc_staff;
set local search_path = pos;

CREATE TABLE IF NOT EXISTS dc_staff (
  id          TEXT PRIMARY KEY,
  full_name   TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  phone       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
ALTER TABLE dc_staff OWNER TO pos_app;
ALTER TABLE dc_staff ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON dc_staff TO pos_app;

-- Indexed by its UNIQUE constraint. Dream Crafter staff are marked resigned, never deleted.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS dc_staff_id TEXT UNIQUE REFERENCES dc_staff(id);

-- 0165's "a cleaner or a technician" rule had no name of its own, so it is found by what it says. None found means the
-- table is not what this file expects: stop rather than leave both rules on.
DO $$
DECLARE c text; dropped int := 0;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'employees'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) = 'CHECK (((cleaner_id IS NOT NULL) OR (technician_id IS NOT NULL)))'
  LOOP
    EXECUTE format('ALTER TABLE employees DROP CONSTRAINT %I', c);
    dropped := dropped + 1;
  END LOOP;
  IF dropped = 0 THEN RAISE EXCEPTION 'employees: the cleaner-or-technician check from 0165 was not found'; END IF;
END $$;
ALTER TABLE employees ADD CONSTRAINT employees_one_company CHECK (
  (dc_staff_id IS NULL AND (cleaner_id IS NOT NULL OR technician_id IS NOT NULL))
  OR (dc_staff_id IS NOT NULL AND cleaner_id IS NULL AND technician_id IS NULL));
