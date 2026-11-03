# conts-mail-inbound

Receives email for `theconts.com` and puts it in Mail Center (CONTS-0004). Cloudflare Email Routing hands each
email to this worker, which posts it to the supply chain engine:

```
POST https://conts-scm-engine.conts-erp.workers.dev/api/mail-center/inbound
```

The engine checks the `x-mail-secret` header against its own `MAIL_INBOUND_SECRET` and ignores an email it already
has (same Message-ID), so Cloudflare's retries are safe. Copied from Hookka's `mail-inbound-worker`.

Sign wrangler in to the Conts ERP account (it@houzscentury.com) for every step below.

## 1. Secrets on the engine

From `engine/backend`, one secret per command, each typed at the prompt. Use a new random value of 24 or more
characters for each of the first two, and keep them: the same values go on the worker and the cron worker.

```bash
npx wrangler secret put MAIL_INBOUND_SECRET --config wrangler.production.toml
npx wrangler secret put CONTS_CRON_SECRET --config wrangler.production.toml
npx wrangler secret put RESEND_API_KEY --config wrangler.production.toml
```

`RESEND_API_KEY` lets the engine send every email it writes, not only Mail Center (invites, purchase order emails
and the rest). Each kind has an on/off setting in the engine (`email.enabled` for all of them, then one per kind,
read by `isChannelEnabled` in `engine/backend/src/services/email.ts`): check them before adding the key.

## 2. Deploy this worker

```bash
npm ci
npx wrangler deploy
npx wrangler secret put MAIL_INBOUND_SECRET
```

`FORWARD_TO` (optional) sends a copy of every email to another inbox while you are trying it out. That inbox must
first be a verified destination in Email Routing.

## 3. The cron worker

From the repository root, the same value as the engine's `CONTS_CRON_SECRET`:

```bash
npx wrangler secret put CONTS_CRON_SECRET --config wrangler.cron.toml
```

## 4. Email Routing

Cloudflare dashboard → theconts.com → Email → Email Routing:

1. Turn it on. Cloudflare adds its MX and SPF records. The domain has no MX record today, so no mail is moved away
   from anywhere.
2. Under Routing rules, add one custom address per mailbox (for example `help@theconts.com`) with the action
   **Send to a Worker → conts-mail-inbound**. Avoid the catch-all: only addresses you choose reach the ERP.

## 5. The mailbox in the ERP

In Property OS, open Mail → Mailboxes (Full on Mail Center), add the same address and give people access to it.
Send a test email to it from outside, then reply from Mail Center.
