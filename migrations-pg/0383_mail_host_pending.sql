-- 0383_mail_host_pending: Mail Center re-sync from Houzs (owner, 26 Nov 2026), part 3 of 11.
-- Houzs counterpart: backend/src/db/migrations-pg/20261022T1020_mail_host_pending.sql.
--
-- A personal address the engine provisions (first sign-on from Property OS, an approved claim, the member edit
-- screen) only receives mail once an admin adds it as a custom address in Cloudflare Email Routing for theconts.com,
-- sent to the conts-mail-inbound worker (mail-inbound-worker/README.md step 4; the catch-all stays off). The engine
-- records that step:
--   mail_host_status        NULL     not tracked (shared mailboxes, and personal rows from before this change)
--                           pending  provisioned in the ERP, not yet seen at the mail host
--                           live     confirmed by an admin, or the first inbound mail to the address arrived
--                           removed  turned off here and its routing rule deleted (routes/mail-claim.ts removal list)
--   mail_host_confirmed_at / _by   who marked it, or when mail first arrived (by = NULL).
-- No backfill: existing rows stay NULL so nothing set up before the list appears on it.
-- REVERSAL (revert the code first): drop index if exists public.ix_email_addresses_mail_host_pending;
--   alter table public.email_addresses drop column if exists mail_host_status,
--     drop column if exists mail_host_confirmed_at, drop column if exists mail_host_confirmed_by;

set local search_path = public, extensions;
set local lock_timeout = '5s';

alter table public.email_addresses
  add column if not exists mail_host_status text null,
  add column if not exists mail_host_confirmed_at text null,
  add column if not exists mail_host_confirmed_by integer null;

create index if not exists ix_email_addresses_mail_host_pending
  on public.email_addresses (created_at) where mail_host_status = 'pending';
