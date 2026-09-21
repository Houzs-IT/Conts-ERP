# Open items

Live site: https://theconts-os.pages.dev (Supabase project cweomoenhsjvsxfsmiiw, schema `pos`, via Hyperdrive e0781ccd...). Staging preview: https://staging-preview.theconts-os.pages.dev (Supabase ecgyrmblqfxvbfjlqkdq).

## Next: connect Airbnb, Booking.com, Agoda through Channex
- Decision made: Channex (WhiteLabel plan, $130/month + $0.50 per unit per month, free staging at staging.channex.io; check current price at signup).
- Owner to do first: create a staging.channex.io account, create an API key, save it in a gitignored file (`.dev.vars.channex`), never in chat. Say how many units and which platform first.
- Stage 1 test connection (fake property) -> 2 rates and availability out -> 3 bookings in -> 4 messages and reviews -> 5 one real listing, then the rest.
- Screens waiting for it: Integrations (sync/connect return 501 today), Calendar and Pricing (rates are saved here, not sent), Inbox.
- Watch: one listing must never be controlled by both the old connection and Channex; plan the import of existing bookings.

## Later
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
