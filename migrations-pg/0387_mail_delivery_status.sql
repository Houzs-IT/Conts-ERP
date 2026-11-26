-- 0387_mail_delivery_status: Mail Center re-sync from Houzs (owner, 26 Nov 2026), part 7 of 11.
-- Houzs counterpart: backend/src/db/migrations-pg/20261119T1600_mail_delivery_status.sql.
--
-- Did the email arrive. The 5-minute cron (conts/mail-cron.ts -> refreshOutboundDelivery, lib/mail-delivery.ts) asks
-- Resend for each recent outbound message's last event and stores it here; the thread shows "Delivered" or "Bounced",
-- and the sender gets a bell notice on a bounce. delivery_status holds the Resend last_event as given (sent, delivered,
-- delivery_delayed, bounced, complained, ...); NULL = not asked yet.
-- Additive, nullable, idempotent.
-- REVERSAL (revert the code first): drop index if exists public.ix_email_messages_outbound_created;
--   alter table public.email_messages drop column if exists delivery_status_at, drop column if exists delivery_status;

set local search_path = public, extensions;
set local lock_timeout = '5s';

alter table public.email_messages
  add column if not exists delivery_status text null,
  add column if not exists delivery_status_at timestamptz null;

create index if not exists ix_email_messages_outbound_created
  on public.email_messages (created_at)
  where direction = 'outbound';

comment on column public.email_messages.delivery_status is
  'Resend last_event for an outbound message (delivered, bounced, ...), NULL until the cron has asked. Read by deliveryStatus() in lib/mail-delivery.ts.';
