-- REVERSAL: delete from public.project_design_sheets where r2_key is null; alter table public.project_design_sheets drop constraint project_design_sheets_where_check, drop column external_url, alter column r2_key set not null;
-- Beta Drawings, 3D as a set of named links (owner, live run 24 Oct 2026). Each 3D link used to be its own version,
-- so an approved 3D set held only the last link. A 3D version can now hold several named links, the way a 2D version
-- holds several sheets (0149): a row here per link, with its address instead of a stored file. The set a version
-- stands for is, per name, the newest link up to that version, so approving a version approves all of them.
-- No existing row changes: every 2D sheet keeps its stored file.
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
set local search_path = public, extensions;

alter table public.project_design_sheets
  alter column r2_key drop not null,
  add column external_url text check (external_url is null or (external_url ~* '^https?://' and length(external_url) <= 2000)),
  add constraint project_design_sheets_where_check check (r2_key is not null or external_url is not null);
alter table public.project_design_sheets owner to scm_engine;
