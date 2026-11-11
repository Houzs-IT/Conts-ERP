-- Test accounts on HR > Employees (owner, 10 Nov 2026): a third status, Test, for logins kept to try the field app.
-- A test person keeps their EMP- sign-in and gets jobs, but is left off payroll, labour cost and Employee Performance.
--
--   employees.status   adds 'test'. Only Resigned needs a last working day.
--
-- Apply before the code ships: saving Test without it fails the old check.
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
-- REVERSAL: update employees set status = 'active' where status = 'test'; alter table employees drop constraint employees_status_check, drop constraint employees_resigned_has_day, add constraint employees_status_check check (status in ('active','resigned')), add constraint employees_check1 check (status = 'active' or resigned_at is not null);
set local search_path = pos;
set local lock_timeout = '5s';

alter table employees drop constraint if exists employees_status_check;
alter table employees add constraint employees_status_check check (status in ('active','resigned','test'));
alter table employees drop constraint if exists employees_check1;
alter table employees drop constraint if exists employees_resigned_has_day;
alter table employees add constraint employees_resigned_has_day check (status <> 'resigned' or resigned_at is not null);
