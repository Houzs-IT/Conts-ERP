-- Renovation department (owner, 12 Nov 2026): the companies are no longer kept apart, so Employee Master has one more
-- department beside Cleaning and Maintenance. Like them, a department is a roster and the HR record links to it.
--
--   renovators            the Renovation roster: name, phone, switched on or off, and the login it may later get,
--                         as cleaners and technicians have.
--   employees             gains renovator_id. employees_one_company (migration 0185) now also allows a record on the
--                         renovators roster, and on that roster alone.
--
-- Only Employee Master reads the renovators roster. Attendance, Working Hours, Payroll, Leave and Penalties stay built
-- from cleaners and technicians.
--
-- Optional: the code reads the Renovation department only when employees.renovator_id exists.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0315, dry run first.
-- REVERSAL (only once no Renovation records are wanted):
--   DELETE FROM pos.employees WHERE renovator_id IS NOT NULL;
--   select demo.drop_views();
--   ALTER TABLE pos.employees DROP CONSTRAINT employees_one_company;
--   ALTER TABLE pos.employees ADD CONSTRAINT employees_one_company CHECK (
--     (dc_staff_id IS NULL AND (cleaner_id IS NOT NULL OR technician_id IS NOT NULL))
--     OR (dc_staff_id IS NOT NULL AND cleaner_id IS NULL AND technician_id IS NULL));
--   ALTER TABLE pos.employees DROP COLUMN renovator_id; DROP TABLE pos.renovators;
--   select demo.sync();
set local search_path = pos;

CREATE TABLE IF NOT EXISTS renovators (
  id          TEXT PRIMARY KEY,
  full_name   TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  phone       TEXT,
  user_id     TEXT UNIQUE REFERENCES users(id),
  is_active   SMALLINT NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
ALTER TABLE renovators OWNER TO pos_app;
ALTER TABLE renovators ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON renovators TO pos_app;

-- Indexed by its UNIQUE constraint. Renovation staff are marked resigned, never deleted.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS renovator_id TEXT UNIQUE REFERENCES renovators(id);

ALTER TABLE employees DROP CONSTRAINT employees_one_company;
ALTER TABLE employees ADD CONSTRAINT employees_one_company CHECK (
  (dc_staff_id IS NULL AND renovator_id IS NULL AND (cleaner_id IS NOT NULL OR technician_id IS NOT NULL))
  OR (renovator_id IS NOT NULL AND dc_staff_id IS NULL AND cleaner_id IS NULL AND technician_id IS NULL)
  OR (dc_staff_id IS NOT NULL AND renovator_id IS NULL AND cleaner_id IS NULL AND technician_id IS NULL));

select demo.sync();
