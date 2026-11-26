-- 0388_mail_access_changes: Mail Center re-sync from Houzs (owner, 26 Nov 2026), part 8 of 11.
-- Houzs counterpart: backend/src/db/migrations-pg/20261121T1200_mail_access_changes.sql.
--
-- Mail Center access change log: every view-level change and every mailbox grant / revoke, with who made it and for
-- whom (lib/mail-access.ts recordAccessChange; GET /api/mail-center/access/changes, newest 50).
-- Additive, idempotent. New table owned by scm_engine, row level security on (as 0342).
-- REVERSAL (revert the code first): drop table if exists public.mail_access_changes;

set local search_path = public, extensions;
set local lock_timeout = '5s';

create table if not exists public.mail_access_changes (
  id          text primary key,
  company_id  integer,
  changed_at  timestamptz not null default now(),
  by_user_id  integer,
  user_id     integer not null,
  change      text not null
);
create index if not exists mail_access_changes_company_at_idx on public.mail_access_changes (company_id, changed_at desc);
alter table public.mail_access_changes owner to scm_engine;
alter table public.mail_access_changes enable row level security;
