-- Pass key rework (owner, 11 Nov 2026): the office can mark a Pass key job Urgent by hand. The automatic rule (check-in
-- today, tomorrow or missed) adds to it and never lowers a job someone marked Urgent.
--
--   maintenance_issues.urgent_by_hand   true when the office picked Urgent on a Pass key job.
--
-- The code reads and writes it only when it exists (hasColumn), so it can ship before this is applied.
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
-- REVERSAL: alter table maintenance_issues drop column urgent_by_hand; select demo.sync();
set local search_path = pos;

alter table maintenance_issues
  add column if not exists urgent_by_hand boolean not null default false;

select demo.sync();
