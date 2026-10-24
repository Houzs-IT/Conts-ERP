-- REVERSAL: alter table public.project_design_sheets drop column removed_at, drop column removed_by;
-- Beta Drawings, removing a 2D sheet (owner, 24 Oct 2026; BRIEF-beta-oct24 section 2). A sheet that is no longer part
-- of the set is soft-removed: every file it had (all versions) is marked with when and by whom, and is then left out of
-- the set shown and of the set PDF, but stays listed under "Removed sheets" and can be put back. No row is deleted and
-- no file leaves storage. No existing row changes: every sheet uploaded so far simply stays in its set.
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
set local search_path = public, extensions;

alter table public.project_design_sheets
  add column removed_at timestamptz,
  add column removed_by bigint;
