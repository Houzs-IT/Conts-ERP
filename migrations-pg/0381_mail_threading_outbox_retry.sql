-- 0381_mail_threading_outbox_retry: Mail Center re-sync from Houzs (owner, 26 Nov 2026), part 1 of 11.
-- Houzs counterpart: backend/src/db/migrations-pg/20261022T0300_mail_threading_outbox_retry.sql.
--
-- The engine's email queue (email_outbox) now keeps everything a retry needs, so a Mail Center reply whose first send
-- failed is queued and retried by the 5-minute cron (engine/backend/src/conts/mail-cron.ts) instead of answering 502:
--   email_outbox.from_address  the mailbox it was sent from (a retry used to go out from noreply@)
--   email_outbox.headers       JSON In-Reply-To / References, so a retried reply still threads at the customer
--   email_outbox.attachments   JSON [{filename, key}]; the bytes sit in R2 under mail-outbox/<id>/ (written on failure only)
--   email_outbox.provider_id   the Resend id once delivered
--   email_messages.outbox_id   the outbox row behind a queued Mail Center send ("Queued, retrying" / "Not delivered")
-- plus a partial index for the job that copies the Resend Message-ID onto outbound rows still missing one
-- (lib/mail-threading.ts backfillOutboundMessageIds).
--
-- Additive, nullable, idempotent. Existing rows read NULL = old behaviour.
-- APPLY: production through the GitHub workflow "Apply migrations to production", 0381 to 0391 in order, dry run first,
--        BEFORE the engine deploy that carries the re-synced Mail Center (the engine has no runtime self-apply).
-- REVERSAL (revert the code first):
--   alter table public.email_outbox drop column if exists from_address, drop column if exists headers,
--     drop column if exists attachments, drop column if exists provider_id;
--   drop index if exists public.ix_email_messages_outbound_no_msgid;
--   alter table public.email_messages drop column if exists outbox_id;
-- GRANTS: none; columns and the index ride their table's owner (scm_engine).

set local search_path = public, extensions;
set local lock_timeout = '5s';

alter table public.email_outbox
  add column if not exists from_address text null,
  add column if not exists headers      text null,
  add column if not exists attachments  text null,
  add column if not exists provider_id  text null;

alter table public.email_messages
  add column if not exists outbox_id text null;

create index if not exists ix_email_messages_outbound_no_msgid
  on public.email_messages (created_at)
  where direction = 'outbound' and message_id is null;
