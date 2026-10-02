# Open items

Live site: https://theconts-os.pages.dev (Supabase project cweomoenhsjvsxfsmiiw, schema `pos`, via Hyperdrive e0781ccd...). Staging preview: https://staging-preview.theconts-os.pages.dev (Supabase ecgyrmblqfxvbfjlqkdq).

## Next: connect Airbnb, Booking.com, Agoda through Channex
- Decision made: Channex (WhiteLabel plan, $130/month + $0.50 per unit per month, free staging at staging.channex.io; check current price at signup).
- Stages 1-4 are done, tested and merged to main; migrations `0003`-`0005` are applied on production too. Still inert in production — no `CHANNEX_API_KEY` set there yet.
- Stage 4 (messages and reviews) could not get a live end-to-end test: Channex's sandbox has no way to fake an inbound message or review (unlike bookings' "Booking CRS" tool), and the shared pool of test Booking.com hotel IDs stayed occupied throughout testing. Verified instead against real staging data with Channex's API calls stubbed — see PR #8. Worth a real look once an actual guest message/review comes in, or once stage 5 connects a real listing.
- Stage 5 built (feat/channex-stage5): CHANNEX_BASE_URL per environment (wrangler.toml), "Set up in Channex" on a unit creates its listing (apartment, MYR, one room, standard rate) and opens a year of dates; "Connect channels" opens Channex's channel screen for that unit. Tested on the sandbox: scripts/api-checks/channex-stage5.mjs.
- Channex reply (Evan, 30 Sep): the headless /channels iframe is deprecated; build connect and mapping on the Channel API. Certification = run the PMS certification tests on staging from the Conts UI, submit the form, then live verification (screenshare or recorded video of the ops lead using Conts; no code review, no developer needed).
- Certification build (feat/channex-cert): outbox queue (channexQueue.ts) with one call per property and kind, 10/min per property budget, 429/5xx backoff, quiet-period batching, full sync 500 days in two calls, min stay and stop sell per night (Calendar), Channex panel on Integrations with task ids. Tested on the sandbox: scripts/api-checks/channex-queue.mjs.
- Certification form submitted 30 Sep (task ids in the owner's notes); waiting for Channex's review and live verification. Keep staging unit T-01 ("Test Property - Conts") for it.
- Channel connect screens built (feat/channex-channel-connect): unit Channels card connects Booking.com / Agoda by Hotel ID (rooms and rates looked up, one picked) and Airbnb by sign-in link and listing pick (#/channex/airbnb-return). Full Booking.com connect not yet proven on the sandbox: all shared test hotels (5868189, 6519420, 4372137, 10484818) were held by other testers; ask support@channex.io to free one. Airbnb needs a real Airbnb account to test.
- Channex is live on production (2 Oct): certification passed, Whitelabel subscribed, production key and webhook secret set, booking notifications on. No real unit connected yet.
- Per-channel prices (feat/channex-per-channel-prices): each linked unit has four Channex rate plans (Direct, Airbnb, Booking.com, Agoda); one pricing rule in functions/_lib/channelPrice.ts (night's own price, else base + uplift, weekend x1.22; default uplift 12/18/16% of base) shared by Pricing, Calendar and Channex. Needs migration 0041 on production before merge.
- Production still holds the seeded example data (3 sample units, 5 owners, 5 bookings ...). Owner chose to clear it before real data: scripts/clear-example-data.mjs (listing by default; --apply --confirm=<ref>; keeps users, settings, integrations, automations, audit trail). Then enter the real owner, building and unit, and connect Airbnb first (Booking.com after; Agoda not used yet).
- Four seeded staff accounts exist on production (management@, finance@, aina@, nurul@theconts.com); owner to confirm whether they are used or switch them off.
- Still off: the cron worker (wrangler.cron.toml, needs CHANNEX_API_KEY set on it) that retries the Channex outbox every minute; deploying it also starts the notification drain and overdue-task sweep.
- Watch: one listing must never be controlled by both the old connection and Channex; plan the import of existing bookings.

## Paused: Supply Chain as a copy of Houzs (decision: option B)
- Plan: copy Houzs's supply chain screens and server code into Conts, re-coloured gold and black, instead of re-drawing each screen. Rental side untouched.
- Needs Houzs's `scm` tables (177) in a separate schema, a bridge from Conts sessions to Houzs's code, and Supabase's data service (service key as a Cloudflare secret, set by the owner).
- Waiting on: schema-only dump of Houzs `scm` (pg_dump --schema-only --schema=scm, command given to the owner), and whether Conts needs AutoCount.
- First step when resumed: pilot the Houzs sales order list inside Conts on staging.

## Later
- Update Wrangler CLI (3.114 -> 4.x, `npm install --save-dev wrangler@4`). Not urgent, do once current work settles.
- Update vulnerable packages (GitHub reports 1 critical, 7 high, 14 moderate, 2 low). Do in its own PR and test.
- Email delivery: needs MAIL_API_KEY on the preview environment too; production has it.
- Deploy the timed background job (theconts-cron, wrangler.cron.toml) for delayed notifications and the overdue-task sweep.
- Remove leftovers from the old Cloudflare database (scripts/d1-source.toml, D1 setup scripts) once the old D1 is retired.

## Future (planning only, not started): guests pay online for direct bookings
- Only direct bookings need it. Airbnb, Booking.com and Agoda collect the guest's money themselves.
- Flow: reservation -> "Send payment link" (WhatsApp/email) -> guest pays on the gateway's own page -> gateway calls our webhook -> reservation marked paid -> amount feeds the owner statement. Refunds and failures show on the reservation. Card numbers never touch our system.
- Gateway candidates for Malaysia (compare fees and sign-up rules at the time): Billplz or Toyyibpay (FPX, simple), HitPay (FPX, DuitNow QR, cards), Stripe (best tooling and foreign cards, more setup for local banks). Leaning Billplz or HitPay for mostly local guests.
- Decisions needed first: deposit vs full payment vs damage deposit; local vs foreign guests; which company account and documents the gateway needs.
- Build order when the time comes: payment link + webhook + paid status -> refunds -> deposits -> optional guest booking page.
- Owner payouts stay separate (bank transfers from the Payouts screen); the gateway only collects.

## Future (planning only, not started): Anthropic API key
- Not needed for development help. Only needed for the two items below.
- AI inside the system: suggested replies to guest messages (start here, so the value can be judged first), draft replies to reviews, plain-language summary of each owner statement, daily "what needs attention" summary. The server calls Claude with the key stored as a Cloudflare secret (`wrangler pages secret put ANTHROPIC_API_KEY`), never in the browser. Pay per use.
- Optional: automatic Claude review of every pull request on GitHub (key stored as a GitHub Actions secret).
- Do after Channex, when there are real bookings and messages to work with. Key never pasted in chat.

## Future (planning only, not started): security hardening
Suggested order. Items 1-3 together are about 2 days and close the biggest gaps.
1. Two-step login (2FA) with an authenticator app. Required for management and finance, optional for others. Backup codes, and an admin reset that is logged.
2. Login protection through Cloudflare: Turnstile on the login page, rate limiting on login, password reset and other sensitive endpoints. Check which Cloudflare plan includes each feature.
3. Alerts: email management on a login from a new device, repeated failed logins, or a bank-detail change.
5. Restrict the staff sign-in to office addresses or put it behind Cloudflare Access (needs office network details).
6. Data safety: turn on Supabase point-in-time backups and test one restore; limit bulk data exports.
- To discuss later: what "bandwidth" should mean here (blocking floods of requests = item 2, or limiting how much data one user can download = item 6).
