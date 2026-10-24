-- REVERSAL: alter table public.project_design_sheets owner to postgres;
-- Fix for 0149 (owner, live run 24 Oct 2026): the 2D sheets table was created without handing it to the engine's
-- database role, so every 2D set upload in the Beta Drawings tab failed with "permission denied for table
-- project_design_sheets" (the screen showed "Something went wrong"). Every other Beta table is owned by scm_engine
-- (0146, 0147); this one now is too. The identity sequence moves with the table. No row changes.
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
set local search_path = public, extensions;

alter table public.project_design_sheets owner to scm_engine;
