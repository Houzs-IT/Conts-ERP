-- REVERSAL: alter table public.project_beta_design drop column person_3d_ids, drop column person_2d_ids;
-- Beta Assign: several people can draw the 3D and several the 2D of one project (owner, 24 Oct 2026: "make sure
-- it can multiselect"). The picks are kept in order in the two arrays below. person_3d_id and person_2d_id stay,
-- always equal to the first pick (null when nobody), so code that reads the single columns keeps working.
-- No foreign key on an array element: a person row is never deleted (only made inactive), and the board joins the
-- names, so an id with no row is simply not shown.
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
set local search_path = public, extensions;

alter table public.project_beta_design
  add column person_3d_ids bigint[] not null default '{}',
  add column person_2d_ids bigint[] not null default '{}';

update public.project_beta_design set person_3d_ids = array[person_3d_id] where person_3d_id is not null;
update public.project_beta_design set person_2d_ids = array[person_2d_id] where person_2d_id is not null;
