-- 0382_mail_reads_acks: Mail Center re-sync from Houzs (owner, 26 Nov 2026), part 2 of 11.
-- Houzs counterpart: backend/src/db/migrations-pg/20261022T1010_mail_reads_acks.sql.
--
-- Read state per person and "needs acknowledgement" (engine/backend/src/lib/mail-reads.ts, lib/mail-acks.ts):
--   email_thread_reads              one row per (thread, person); read_at NULL = that person marked it unread. Opening a
--                                   thread used to clear email_threads.unread for everyone; now it writes only the
--                                   opener's row. A person with no row still sees the old shared flag (kept in place).
--   email_threads.last_inbound_at   when the newest INBOUND message arrived; unread for a person when this is after
--                                   their read_at, so a colleague's reply does not count. Backfilled below.
--   email_messages.needs_ack / ack_escalated_at   the sender asked for acknowledgement; the 48 h chase ran (once).
--   email_message_acks              one row per staff recipient owed an acknowledgement; acked_at NULL = still owed.
--
-- Additive and idempotent: the backfill only fills NULLs. New tables follow 0342 (owned by scm_engine, row level
-- security on, nothing granted to anon / authenticated).
-- REVERSAL (revert the code first): drop table if exists public.email_message_acks; drop table if exists
--   public.email_thread_reads; alter table public.email_messages drop column if exists needs_ack, drop column if exists
--   ack_escalated_at; alter table public.email_threads drop column if exists last_inbound_at;

set local search_path = public, extensions;
set local lock_timeout = '5s';

alter table public.email_threads
  add column if not exists last_inbound_at text null;

update public.email_threads t
   set last_inbound_at = m.at
  from (select thread_id, max(coalesce(received_at, created_at)) as at
          from public.email_messages
         where direction = 'inbound'
         group by thread_id) m
 where m.thread_id = t.id and t.last_inbound_at is null;

create table if not exists public.email_thread_reads (
  thread_id text not null,
  user_id   integer not null,
  read_at   text null,
  primary key (thread_id, user_id)
);
create index if not exists ix_email_thread_reads_user on public.email_thread_reads (user_id);
alter table public.email_thread_reads owner to scm_engine;
alter table public.email_thread_reads enable row level security;

alter table public.email_messages
  add column if not exists needs_ack integer not null default 0,
  add column if not exists ack_escalated_at text null;

create table if not exists public.email_message_acks (
  message_id   text not null,
  user_id      integer not null,
  requested_at text not null,
  acked_at     text null,
  primary key (message_id, user_id)
);
create index if not exists ix_email_message_acks_owed on public.email_message_acks (user_id) where acked_at is null;
alter table public.email_message_acks owner to scm_engine;
alter table public.email_message_acks enable row level security;
