-- 0389_mail_thread_replying: Mail Center re-sync from Houzs (owner, 26 Nov 2026), part 9 of 11.
-- Houzs counterpart: backend/src/db/migrations-pg/20261121T1500_mail_thread_replying.sql.
--
-- "X is writing a reply": a row per person with text in a thread's reply box, refreshed every 20 s and ignored after
-- 90 s, so a colleague opening the same email sees it and two people do not both answer (routes/mail-reply-guard.ts).
-- Short-lived state only. Additive, idempotent. New table owned by scm_engine, row level security on (as 0342).
-- REVERSAL (revert the code first): drop table if exists public.mail_thread_replying;

set local search_path = public, extensions;
set local lock_timeout = '5s';

create table if not exists public.mail_thread_replying (
  thread_id   text not null,
  user_id     integer not null,
  company_id  integer,
  at          text not null,
  primary key (thread_id, user_id)
);
alter table public.mail_thread_replying owner to scm_engine;
alter table public.mail_thread_replying enable row level security;
