-- Need support on a repair (CONTS-0019, FONG, 10 Nov 2026): a technician who started a job and cannot fix it taps
-- Need support and must say what they tried. The office sees those jobs on their own tab and clears the flag once they
-- have helped. Finishing the repair clears it too.
--
--   maintenance_issues.support_requested_at   when the technician asked for help; null when nobody is waiting.
--   maintenance_issues.support_note           what they tried, as they wrote it.
--
-- The code reads and writes these only when they exist (hasColumn), so it can ship before this is applied.
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
-- REVERSAL: alter table maintenance_issues drop column support_requested_at, drop column support_note; select demo.sync();
set local search_path = pos;

alter table maintenance_issues
  add column if not exists support_requested_at text,
  add column if not exists support_note text;

select demo.sync();
