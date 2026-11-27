# Mail Center (supply chain engine)

Shared and personal mailboxes inside the ERP: inbound mail lands in threads, staff reply or compose from a mailbox
address rather than from `noreply@`. The code is the engine's (`engine/backend/src`, `engine/frontend/src`), a copy of
Houzs ERP's Mail Center. Property OS opens it as **Mail** (the engine screen inside Property OS; access area `mail`:
View / Edit open the inbox, Full also manages mailboxes, `engine/backend/src/conts/access.ts`).

**Re-synced with Houzs on 26 Nov 2026** (Houzs `origin/main` 8d58d026, `docs/modules/mail-center.md` there). The copy
had been taken at Houzs `c20343f5` (28 Sep 2026); every Mail Center change Houzs made since is in, with the Conts
adaptations listed below. Re-sync next time the same way: three-way merge each file with base = the Houzs commit of
the last sync, ours = Conts, theirs = Houzs, then re-apply the adaptations.

## What Conts runs differently from Houzs

| | Houzs | Conts |
| --- | --- | --- |
| Companies | two (HOUZS, 2990), resolved from the recipient | one. Its internal code stays `HOUZS` (migration 0046); every recipient resolves to it (`RECIPIENT_COMPANY_RULES` lists only theconts.com, unmatched mail goes to the same company) |
| Inbound | Gmail IMAP (`mail-sync`, every 5 min) | Cloudflare Email Routing for theconts.com, one custom address per mailbox, action Send to a Worker `conts-mail-inbound` (`mail-inbound-worker/`). No catch-all |
| Where a new address must be added before it receives mail | Google Workspace, as an alias of hello@ | Cloudflare Email Routing, as a custom address. Team, Mailboxes lists them as "Waiting to be added in Cloudflare Email Routing" until an admin marks them added or the first email arrives |
| Address limit on claim approval | 50 Google aliases (hello@ not counted) | 200 Email Routing addresses (every address counted). `app_settings.mail_alias_limit` overrides; check the zone's real limit in the Cloudflare dashboard |
| Domain fallback when Branding has no email | houzscentury.com | theconts.com (Branding default `help@theconts.com`); unmatched inbound with no recipient goes to the Branding email, not `hello@` |
| Scheduled work (retries, Message-ID backfill, Delivered/Bounced, 48 h ack chase) | the engine's own cron in `index.ts` | the engine has no schedule: Property OS's cron worker calls `POST /api/conts-cron/mail-outbox` every 5 min (`functions/_lib/cronJobs.ts engineMailOutbox` -> `engine/backend/src/conts/mail-cron.ts`), which runs all four. The ack chase is idempotent, so every 5 min instead of 30 only makes it up to 25 min earlier |
| Personal mailbox provisioning | invite, accept-invite, member edit | staff arrive by sign-on from Property OS (`conts/sso.ts`): the first sign-on with Mail access (or Full everywhere) gives first.last@theconts.com, and so does any later sign-on while the person still has none. Invite / accept-invite / member edit also provision, as in Houzs |
| Waiting-for-my-reply count | engine sidebar + phone Profile | the same, plus a line under My mailbox in Mail Center, because Property OS shows its own menu, not the engine sidebar |
| Auto-sent log login links | masked for non-admins | the same (`routes/lib/mail-outbox-mask.ts`, Conts first, now also in Houzs) |

## Statuses and flow

- **Sending** goes through one durable queue: `sendEmail()` writes `email_outbox` first, then tries Resend. A failure
  leaves the row `pending`; the 5-minute retry tries up to 3 times. The row carries the From mailbox, threading
  headers and (written only on failure) the attachments, whose bytes sit in R2 under `mail-outbox/<id>/`. Whoever
  sends a row holds it (`claimed_at`, a 10-minute lease) so no email goes twice.
- **A reply or compose whose first send failed** answers `{ ok: true, queued: true }` (it used to answer 502) and the
  thread shows "Queued, retrying" or "Not delivered". Only a send that cannot be retried answers 502. The AI
  Connector's `confirm_action` email says "Queued" in that case.
- **Delivered / Bounced**: the 5-minute job asks Resend for up to 20 recent outbound messages and stores
  `email_messages.delivery_status`; a bounce posts a bell notice (`mail_bounce`) to the sender.
- **Threading**: replies carry `In-Reply-To` / `References` (`lib/mail-threading.ts`); the outbound row gets Resend's
  Message-ID afterwards, so the customer's answer joins the thread.
- **Read state per person** (`email_thread_reads`): opening a thread changes only the opener's row; the thread shows
  "Read by 2 of 3". People with no row yet still see the old shared unread flag.
- **Needs acknowledgement**: compose / reply with "Needs acknowledgement" writes one `email_message_acks` row per staff
  member on To / Cc, posts a bell notice (`mail_ack`), lists it under `GET /acks/pending`; after 48 h the people still
  owing and their manager are told once.
- **Reply guard**: "X is writing a reply" (`mail_thread_replying`, 20 s heartbeat, 90 s fresh); a reply sent after a
  colleague's answer gets 409 `already_replied` until resent with `force`. Whoever replies to an unassigned thread
  becomes its assignee. `GET /waiting-count` counts open threads whose last message is inbound and that are assigned
  to the caller, or unassigned in the caller's own mailbox.
- **Personal mailboxes and claims**: a new personal address is `mail_host_status = 'pending'` until an admin marks it
  added (`POST /mail-host/:id/confirm`) or mail arrives. A member with no address asks for one (`POST /claim`); a Mail
  Center admin approves (refused at the limit) or rejects with a reason on Team, Mailboxes. A turned-off address that
  is still routed is listed under "Turned off here, still in Email Routing" until marked removed.
- **Disabling a member** in the engine (member edit or Disable) closes their personal mailbox and removes their grants
  (`closePersonalMailOnDisable`); re-enabling opens only their own mailbox again.

## Access

- `mail_user_scope.level`, no row = L1. **L1 Personal**: own + granted mailboxes only; a department never opens its
  mailbox by itself. **L2 Department** (`department_all`): the department mailboxes and every member's own mailbox in
  the person's departments and in the departments ticked for them (`mail_scope_departments`). **L3 Company**: every
  active mailbox. A member of the department named Management is always L3. The old `personal` value reads as L1.
- A department mailbox is linked by `email_addresses.department_id` (not by name); giving a mailbox an owner clears it.
- Every level change and grant / revoke is written to `mail_access_changes` (`GET /access/changes`); sharing someone's
  own mailbox posts a bell notice to its owner (`mail_access`).
- Team, Mail Center has three subpages: Mailboxes, Inbound mail (`GET /sync-status`: newest mail each mailbox
  received; the ERP cannot see Email Routing itself), Access.
- `canSendFrom()`: a non-admin sends only from a mailbox in scope or their own alias.

## Database

Applied by hand (no runtime self-apply in the engine): Actions > **Apply migrations to production**, dry run first,
in this order, **before** deploying the engine that carries this code (the new code reads every one of them):

| File | What |
| --- | --- |
| `0381_mail_threading_outbox_retry.sql` | outbox retry payload columns, `email_messages.outbox_id` |
| `0382_mail_reads_acks.sql` | per-person read state, acknowledgement rows, `last_inbound_at` (backfilled) |
| `0383_mail_host_pending.sql` | `email_addresses.mail_host_status` and who confirmed it |
| `0384_mail_department_link.sql` | `email_addresses.department_id` (backfilled where the name matches one department) |
| `0385_mail_requested_department.sql` | the department a claimant asked for |
| `0386_email_outbox_claim.sql` | the send lease `email_outbox.claimed_at` |
| `0387_mail_delivery_status.sql` | Resend delivery status on outbound messages |
| `0388_mail_access_changes.sql` | access change log |
| `0389_mail_thread_replying.sql` | "is writing a reply" |
| `0390_mail_scope_departments.sql` | L2 ticked departments |
| `0391_mail_address_requests.sql` | address claims waiting for approval |

All additive and idempotent (`if not exists`); new tables owned by `scm_engine` with row level security on, as 0342.

## Tests

- Engine workers suite (`engine/backend`, `npx vitest run tests/mail*.test.ts tests/emailOutbox.test.ts`), ported from
  Houzs: access levels, alias revocation, by-id company scope, claims, delivery, department scope, directory, disable,
  inbound (rewritten for one company), personal mailboxes, reads and acks, recipient history, reply guard, threading,
  the outbox lease.
- Engine frontend (`engine/frontend`, vitest): the Mail Center component tests under `src/pages/MailCenter`,
  `src/pages/team/MailHostPending.test.tsx`, `src/pages/mail-access-parts.test.ts`, `src/mobile/MobileMailCenter*.test.tsx`.

## Where the code is

- `engine/backend/src/routes/mail-center.ts` (threads, compose, reply, inbound ingest), `mail-inbound.ts` (pre-auth
  webhook), `mail-personal.ts` (`/visibility`, `/directory`, `/recipients/history`, `/mail-host/pending|confirm`),
  `mail-claim.ts`, `mail-acks.ts`, `mail-access-log.ts` (`/access/changes`, `/scope-departments`, `/sync-status`),
  `mail-reply-guard.ts` (routes; its helpers are in `lib/mail-reply-guard.ts`, Conts only, to avoid an import cycle),
  `mail-senders.ts`, `lib/mail-outbox-mask.ts`.
- `engine/backend/src/lib/mail-*.ts` (threading, reads, acks, access, delivery, provision, recipient history,
  attachments), `services/email.ts` (queue), `conts/mail-cron.ts` (scheduled work), `conts/sso.ts` (provisioning).
- `engine/frontend/src/pages/MailCenter/`, `pages/MailboxesTab.tsx`, `pages/mail-access-levels.tsx`,
  `pages/mail-access-parts.tsx`, `pages/team/Mail*.tsx`, `mobile/MobileMail*.tsx`.
- Inbound worker: `mail-inbound-worker/` (README: secrets, Email Routing rules).

## Known gaps

- Disabling a person in **Property OS** does not reach the engine: their engine account stays active (they simply can
  no longer sign on), so their personal mailbox stays open and their grants stay until an admin disables the engine
  account on Team, Members. A Property OS deactivation hook into the engine is not built.
- Meeting emails are still sent by Property OS (`functions/_lib/meetingMail.ts`), not through the engine's `email_log`.
- The Property OS menu shows no waiting-for-reply badge on Mail (its badges come from `/api/nav/badges`, which does not
  ask the engine); the count shows inside Mail Center. The same count is readable server to server at
  `GET /api/supply-chain/mail-waiting` (Mail access only; engine `POST /api/conts-mail-waiting` with an `aud:
  'mail-waiting'` statement, read-only: no account, session or mailbox is made; `count: null` = not opened yet),
  which the AI Connector's daily brief uses. The menu does not call it (it would sign on to the engine every minute).
- **AI Connector replies (round 4b, 27 Nov 2026).** `GET /api/supply-chain/mail-waiting?list=1` (engine
  `POST /api/conts-mail-waiting?list=1`, still read-only) also returns the waiting threads themselves (at most 10, longest
  waiting first: subject, mailbox, from, last snippet, newest message id). `propose_mail_reply` answers only those, and
  its confirmation signs on (`engine-session`) and calls Mail Center's own `POST /threads/:id/reply` with
  `{ text, afterMessageId }`: never `force`, so the reply guard refuses when a colleague replied after the person saw the
  email. Someone whose Mail Center was never opened is told to open it first; the connector never signs them on, so it
  never makes their mailbox. Behind its own switch on System > AI Connector (default off) and migration 0396.
  `functions/_lib/mcpWrite.ts`.
