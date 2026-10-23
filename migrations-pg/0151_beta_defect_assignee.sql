-- REVERSAL: drop index public.project_defects_assignee_idx; alter table public.project_defects drop column assignee_person_id;
-- Beta Defects as a repair ticket (owner, 24 Oct 2026; BRIEF-beta-oct24 section 6): each defect names the person who
-- fixes it, as the rental side's Maintenance names its assignee. The trade stays as the kind of work; the person is
-- one of the company's project_people. No row changes: every existing defect simply has no one named yet.
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
set local search_path = public, extensions;

alter table public.project_defects
  add column assignee_person_id bigint references public.project_people(id) on delete set null;
create index project_defects_assignee_idx on public.project_defects (assignee_person_id) where assignee_person_id is not null;
