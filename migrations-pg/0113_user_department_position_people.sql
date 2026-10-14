-- REVERSAL: drop view public.conts_staff; drop index public.project_people_pos_user_unique; alter table public.project_people drop column pos_user_id; alter table pos.users drop constraint users_department_check, drop constraint users_position_check, drop column department, drop column position;
-- Renovation people come from the user accounts (owner, 14 Oct 2026: "People should come straight from my users; no
-- separate contact maintenance. When I register each person I set their department and position").
--
-- * pos.users gains department and position, free text set on the Users and roles page (create and edit).
-- * public.conts_staff: the staff accounts as the supply chain engine may see them: id, name, email, department,
--   position, active. Owner logins are left out. It is the one thing in schema pos the engine's role (scm_engine,
--   migration 0047) can read; it still reads nothing else there (no password hashes, sessions, owners, bank details or
--   bookings). The view runs with its owner's rights, so scm_engine needs no grant on schema pos.
-- * public.project_people gains pos_user_id (pos.users.id is text, so the older bigint user_id, never filled, cannot
--   hold it). The engine keeps one person per account in line with the account when a picker opens
--   (engine/backend/src/services/renovation/peopleSync.ts) and offers only people linked to an active account. People
--   imported from Notion stay as they are for the names on old records; one is linked to an account only when the names
--   are exactly equal ignoring case and spacing.
--
-- APPLY: by hand, local, then staging, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
-- The code reads and writes these columns only once they exist, so either side may deploy first.

alter table pos.users
  add column if not exists department text,
  add column if not exists position text;
alter table pos.users
  add constraint users_department_check check (department is null or length(department) <= 80),
  add constraint users_position_check check (position is null or length(position) <= 80);

alter table public.project_people add column pos_user_id text;
create unique index project_people_pos_user_unique on public.project_people (company_id, pos_user_id) where pos_user_id is not null;

create view public.conts_staff as
  select u.id, u.full_name, u.email, nullif(trim(u.department), '') as department, nullif(trim(u.position), '') as position,
         (u.is_active = 1) as active
    from pos.users u
   where u.role <> 'owner';

revoke all on public.conts_staff from public, anon, authenticated;
grant select on public.conts_staff to scm_engine;
