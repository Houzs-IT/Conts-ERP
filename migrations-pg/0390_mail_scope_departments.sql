-- 0390_mail_scope_departments: Mail Center re-sync from Houzs (owner, 26 Nov 2026), part 10 of 11.
-- Houzs counterpart: backend/src/db/migrations-pg/20261121T1700_mail_scope_departments.sql.
--
-- Access level L2 "Whole department": besides the person's own Org Chart departments, an admin may tick OTHER
-- departments; each ticked one is opened wholly (its department mailbox and every member's own mailbox).
-- PUT /api/mail-center/scope-departments writes it; leaving L2 clears the ticks.
-- Additive, idempotent. New table owned by scm_engine, row level security on (as 0342).
-- REVERSAL (revert the code first): drop table if exists public.mail_scope_departments;

set local search_path = public, extensions;
set local lock_timeout = '5s';

create table if not exists public.mail_scope_departments (
  user_id       integer not null,
  department_id integer not null,
  company_id    integer,
  created_at    timestamptz not null default now(),
  created_by    integer,
  primary key (user_id, department_id)
);
alter table public.mail_scope_departments owner to scm_engine;
alter table public.mail_scope_departments enable row level security;
