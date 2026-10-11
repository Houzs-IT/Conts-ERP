-- 0090 created task_checklist_items and maintenance_windows as the migration user and granted nothing, so the API's
-- role (pos_app) cannot read them: on a database built from these files, Today, Cleaning and Maintenance answer 500
-- "permission denied for table maintenance_windows / task_checklist_items" (seen on a fresh local Postgres 16, 11 Oct 2026).
-- 0091 grants its own new tables the same way. Re-running is harmless: a GRANT that is already in place changes nothing.
-- REVERSAL: REVOKE SELECT, INSERT, UPDATE, DELETE ON task_checklist_items, maintenance_windows FROM pos_app;
set local search_path = pos;
GRANT SELECT, INSERT, UPDATE, DELETE ON task_checklist_items, maintenance_windows TO pos_app;
