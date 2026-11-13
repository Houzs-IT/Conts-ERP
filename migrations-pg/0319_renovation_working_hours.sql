-- Renovation staff clock in, take leave and are paid like cleaners and technicians (12 Nov 2026): Attendance, Leave,
-- Working Hours, Payroll and Labor Cost now list the Renovation department beside Cleaning and Maintenance.
--
--   working_hour_entries.department   also allows 'renovation', the department a Renovation person's hours are filed under.
--
-- Optional: until this is applied, saving Working Hours for a Renovation person is refused by the database; their
-- clock-ins, leave and pay work without it.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0319, dry run first.
-- REVERSAL (only once no Renovation hours are wanted):
--   DELETE FROM pos.working_hour_entries WHERE department = 'renovation';
--   ALTER TABLE pos.working_hour_entries DROP CONSTRAINT working_hour_entries_department_check;
--   ALTER TABLE pos.working_hour_entries ADD CONSTRAINT working_hour_entries_department_check
--     CHECK (department IN ('cleaning','maintenance'));
--   select demo.sync();
set local search_path = pos;

ALTER TABLE working_hour_entries DROP CONSTRAINT working_hour_entries_department_check;
ALTER TABLE working_hour_entries ADD CONSTRAINT working_hour_entries_department_check
  CHECK (department IN ('cleaning','maintenance','renovation'));

select demo.sync();
