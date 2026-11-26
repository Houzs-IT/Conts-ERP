-- 0384_mail_department_link: Mail Center re-sync from Houzs (owner, 26 Nov 2026), part 4 of 11.
-- Houzs counterpart: backend/src/db/migrations-pg/20261027T1100_mail_department_link.sql.
--
-- A department mailbox (no owner) is tied to an Org Chart department by id. Before this the link was the free-text
-- assigned_dept ("Sales") compared with the person's department name ("Sales Department"), which rarely matched.
-- Personal mailboxes keep department_id NULL; the code clears it whenever a mailbox is given an owner, so a department
-- never reaches personal mail.
-- Backfill: an unowned mailbox whose assigned_dept is contained in exactly one department name gets that department.
-- No match or several matches stay NULL for an admin to pick on Team, Mailboxes.
-- Additive and idempotent (the backfill only fills NULLs).
-- REVERSAL (revert the code first): drop index if exists public.ix_email_addresses_department;
--   alter table public.email_addresses drop column if exists department_id;

set local search_path = public, extensions;
set local lock_timeout = '5s';

alter table public.email_addresses
  add column if not exists department_id integer null
    references public.departments(id) on delete set null;

create index if not exists ix_email_addresses_department
  on public.email_addresses (department_id) where department_id is not null;

update public.email_addresses ea
   set department_id = m.department_id
  from (
    select e.id, min(d.id) as department_id, count(*) as matches
      from public.email_addresses e
      join public.departments d
        on strpos(lower(d.name), lower(trim(e.assigned_dept))) > 0
     where e.assigned_user_id is null
       and trim(coalesce(e.assigned_dept, '')) <> ''
     group by e.id
  ) m
 where ea.id = m.id
   and m.matches = 1
   and ea.department_id is null;
