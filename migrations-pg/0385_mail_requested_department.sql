-- 0385_mail_requested_department: Mail Center re-sync from Houzs (owner, 26 Nov 2026), part 5 of 11.
-- Houzs counterpart: backend/src/db/migrations-pg/20261027T1110_mail_requested_department.sql.
--
-- A member with no company address asks for one in Mail Center and, when the Org Chart has no department for them yet,
-- says which department they work in. Kept here and shown to the admin on Team, Mailboxes next to "Mark added"; the
-- admin puts the person in the department through the member screen. Nothing reads it for access. No backfill.
-- REVERSAL (revert the code first): alter table public.email_addresses drop column if exists requested_department_id;

set local search_path = public, extensions;
set local lock_timeout = '5s';

alter table public.email_addresses
  add column if not exists requested_department_id integer null
    references public.departments(id) on delete set null;
