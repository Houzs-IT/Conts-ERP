-- 0391_mail_address_requests: Mail Center re-sync from Houzs (owner, 26 Nov 2026), part 11 of 11.
-- Houzs counterpart: backend/src/db/migrations-pg/20261124T1200_mail_address_requests.sql.
--
-- A member's claim of their own address is a request a Mail Center admin approves (the mailbox is made then) or
-- rejects with a reason (routes/mail-claim.ts). On theconts.com every address is a custom address in Cloudflare Email
-- Routing that an admin adds by hand, and a zone holds a limited number of them, so the claim waits for an admin.
--   status  requested | approved | rejected
-- Additive, idempotent. New table owned by scm_engine, row level security on (as 0342).
-- REVERSAL (revert the code first): drop table if exists public.mail_address_requests;

set local search_path = public, extensions;
set local lock_timeout = '5s';

create table if not exists public.mail_address_requests (
  id                      text primary key,
  company_id              integer not null,
  user_id                 integer not null,
  address                 text not null,
  requested_department_id integer null,
  status                  text not null default 'requested'
                            check (status in ('requested', 'approved', 'rejected')),
  reason                  text null,
  decided_by              integer null,
  decided_at              text null,
  created_at              text not null
);

create index if not exists ix_mail_address_requests_open
  on public.mail_address_requests (company_id, created_at) where status = 'requested';
create index if not exists ix_mail_address_requests_user
  on public.mail_address_requests (user_id, created_at);
-- One open request per person.
create unique index if not exists ux_mail_address_requests_open_user
  on public.mail_address_requests (user_id) where status = 'requested';
alter table public.mail_address_requests owner to scm_engine;
alter table public.mail_address_requests enable row level security;
