# Conts ERP — React application

Production source. The `.dc.html` files in the project root are the design
reference; this folder is what ships.

## Run locally

```bash
npm install
npm install
npm run setup      # database, migrations, admin account, demo data, secrets
npm run dev        # http://localhost:8788
```

Owner portal: open http://owner.localhost:8788 (owners only; staff are refused there).
Local owner demo data is `scripts/seed-owner-demo.sql` (local only, never `--remote`);
the access checks are `node scripts/check-owner-portal.mjs` with the dev server running.

Forgot/reset password: `node scripts/check-reset-password.mjs` with the dev server
running. Covers single-use enforcement, expiry, the per-door refusal rule, and a
regression for a real bug — `notify()`'s same-hour dedup was keyed on the user, so a
second "resend" within the hour silently sent nothing.

## Deploy

```bash
npm run db:migrate                              # applies migrations/ to theconts-prod
npx wrangler pages secret put SESSION_SECRET    # any long random string
npx wrangler pages secret put MAIL_API_KEY      # Resend API key, domain verified in Resend first
npm run deploy
npx wrangler deploy --config wrangler.cron.toml # the scheduled worker
```

A secret set with `wrangler pages secret put` only attaches to the *next* deployment,
not to one already running — run `npm run deploy` once after setting or changing any
secret, or it silently keeps using the old value (or none).

## Layout

| Path | What |
| --- | --- |
| `src/theme.ts` | Every token as TypeScript. Mirrors `tokens.css`. Nothing else holds a brand hex. |
| `src/lib/navigation.ts` | Nav tree, role filtering, landing routes. Mirrors `routes.json`. |
| `src/lib/types.ts` | Enums mirroring `migrations/0001_init.sql`. No synonyms. |
| `src/components/` | Button, Badge, Field, Dialog, Toast, States, Icon, ChannelMark, Card, Sidebar, TopBar, AppShell |
| `src/pages/` | One file per screen |
| `functions/api/` | Cloudflare Pages Functions. Auth, units, reservations, statements, dashboard. |
| `migrations/` | D1 schema, converted from `schema.sql` |

## Rules this code keeps

- **Money is integer sen.** `RM 12,450.00` is `1245000`. No floats, no REAL columns.
- **Status never relies on colour.** Every badge carries its label; `tone.line` is for
  dots and borders, `tone.fg` for text, because the brand guide's base hexes fail AA
  as badge text.
- **Gold is never a status.** It marks brand, selection and The Conts' own channel.
- **Role decides the payload, not the CSS.** Field roles receive no financial fields at all.
- **Every financial or destructive mutation writes `audit_log`** with before and after.
- **The overlap rule lives in the API.** D1 has no `EXCLUDE` constraint, so
  `functions/api/reservations/index.ts` returns `409 DATE_CONFLICT` with the
  conflicting reservation attached.

## What is left

Every screen, every endpoint, every page-to-API connection, and notification delivery
all exist. No `TODO` markers remain in `functions/`.

**Before the first real send**, set the provider secrets:

```bash
npx wrangler secret put MAIL_API_KEY
npx wrangler secret put WHATSAPP_TOKEN
npx wrangler secret put WHATSAPP_PHONE_ID
```

Without them the system still runs: `notify()` records each send as queued and returns
without throwing, so a half-configured environment never breaks the action that
triggered it.

**Two things are genuinely outside the code**, both waiting on the client:

1. **The vector logo.** Every logo position renders a marked placeholder.
2. **The shared font.** The brand guide requires one face across Houzs, Hookka and
   The Conts. Houzs ships Tahoma, Hookka ships IBM Plex Sans. This build uses IBM Plex
   Sans; changing it is one line in `tokens.css`.

**One deliberate limitation:** outbound replies reach guests on WhatsApp for direct
bookings only. Airbnb and Booking.com threads stay inside each channel's own inbox —
those platforms do not accept arbitrary outbound messages through their APIs.

## Two things still needed from the client

1. The vector logo. Every logo position is a marked placeholder.
2. The shared font decision — Houzs ships Tahoma, Hookka ships IBM Plex Sans, and the
   brand guide requires one. This code uses IBM Plex Sans via `--font-sans`.
