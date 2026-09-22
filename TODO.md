# Open items

Live site: https://theconts-os.pages.dev (Supabase project cweomoenhsjvsxfsmiiw, schema `pos`, via Hyperdrive e0781ccd...). Staging preview: https://staging-preview.theconts-os.pages.dev (Supabase ecgyrmblqfxvbfjlqkdq).

## Next: connect Airbnb, Booking.com, Agoda through Channex
- Decision made: Channex (WhiteLabel plan, $130/month + $0.50 per unit per month, free staging at staging.channex.io; check current price at signup).
- Stages 1-3 are done, tested on staging and merged to main; migrations `0003_channex_mapping.sql` and `0004_channex_bookings_in.sql` are applied on production too. Still inert in production — no `CHANNEX_API_KEY` set there yet.
- Next: stage 4 (messages and reviews) -> 5 (one real listing, real OTA connections, wire the Integrations screen's Reconnect/Retry-sync buttons). Stage 5 needs a paid Channex account first.
- Screens still waiting on it: Integrations (Reconnect still 501 — Retry-sync now works for airbnb/booking_com/agoda once Channex is configured), Inbox (no messages/reviews yet).
- Watch: one listing must never be controlled by both the old connection and Channex; plan the import of existing bookings.

## Later
- Update Wrangler CLI (3.114 -> 4.x, `npm install --save-dev wrangler@4`). Not urgent, do once current work settles.
- Update vulnerable packages (GitHub reports 1 critical, 7 high, 14 moderate, 2 low). Do in its own PR and test.
- Photo and document upload: needs Cloudflare R2 bucket bound as MEDIA (uploads return 501 until then).
- Email delivery: needs MAIL_API_KEY on the preview environment too; production has it.
- Sign-in timeout and lockout settings are saved but not yet enforced by login.
- Deploy the timed background job (theconts-cron, wrangler.cron.toml) for delayed notifications and the overdue-task sweep.
- Calendar rate model (multipliers) and Pricing screen (base + uplift) should be aligned.
- Automatic staging preview deploy from the `staging` branch; keep `staging` level with `main`.
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
3. Make the Settings screen's sign-in timeouts and lockout attempts actually apply at login (saved today, not enforced).
4. Alerts and visibility: email management on a login from a new device, repeated failed logins, or a bank-detail change; a screen for the activity log (already recorded).
5. Restrict the staff sign-in to office addresses or put it behind Cloudflare Access (needs office network details).
6. Data safety: turn on Supabase point-in-time backups and test one restore; limit bulk data exports.
- To discuss later: what "bandwidth" should mean here (blocking floods of requests = item 2, or limiting how much data one user can download = item 6).
