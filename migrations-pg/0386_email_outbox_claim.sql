-- 0386_email_outbox_claim: Mail Center re-sync from Houzs (owner, 26 Nov 2026), part 6 of 11.
-- Houzs counterpart: backend/src/db/migrations-pg/20261110T0100_email_outbox_claim.sql.
--
-- Who is sending this email right now. sendEmail() writes the email_outbox row as 'pending' before it calls Resend, and
-- the 5-minute retry (drainEmailOutbox, called by conts/mail-cron.ts) took every 'pending' row with no claim, so a run
-- landing while a request was still sending could send that same email twice. A lease column fixes it: sendEmail()
-- writes the row claimed, the drain skips a claim younger than EMAIL_CLAIM_LEASE_MS (services/email.ts, 10 minutes)
-- and claims each row with a conditional UPDATE before sending; every outcome clears it. An older claim is treated as
-- abandoned. NULL is the normal state. Not a status: the status CHECK keeps its three values.
-- Additive, nullable, idempotent.
-- REVERSAL (revert the code first): drop index if exists public.email_outbox_claimed_idx;
--   alter table public.email_outbox drop column if exists claimed_at;

set local search_path = public, extensions;
set local lock_timeout = '5s';

alter table public.email_outbox
  add column if not exists claimed_at timestamptz null;

comment on column public.email_outbox.claimed_at is
  'When a sender took this row (sendEmail on insert, or the drain conditional claim), NULL when nobody holds it. A LEASE: older than EMAIL_CLAIM_LEASE_MS in services/email.ts means abandoned and it may be taken again. Cleared on every outcome. Not a status.';

create index if not exists email_outbox_claimed_idx
  on public.email_outbox (claimed_at)
  where claimed_at is not null;
