# Deploy Conts ERP

From an empty GitHub repository to a working system on Cloudflare. Every command
here is meant to be run as written. Target stack matches `houzs-erp`: Cloudflare
Pages for the frontend, Pages Functions for the API, D1 for the database, R2 for
photographs and documents.

---

## 0. What you need first

| Thing | Where it comes from |
| --- | --- |
| Cloudflare account | dash.cloudflare.com, free tier is enough to start |
| Node 20+ and npm | nodejs.org |
| Wrangler CLI | `npm install -D wrangler` (do not install globally) |
| GitHub repository | empty is fine |
| Channel API keys | Airbnb, Booking.com, Agoda partner dashboards |
| WhatsApp Business token | Meta Business Manager |

---

## 1. Repository layout

```
the-conts-os/
├─ functions/                  Cloudflare Pages Functions = the whole API
│  └─ api/
│     ├─ auth/
│     │  ├─ login.ts           POST /api/auth/login
│     │  ├─ logout.ts          POST /api/auth/logout
│     │  ├─ session.ts         GET  /api/auth/session
│     │  ├─ forgot-password.ts
│     │  ├─ reset-password.ts
│     │  └─ change-password.ts
│     ├─ dashboard/
│     │  ├─ kpis.ts            GET  /api/dashboard/kpis
│     │  ├─ trend.ts
│     │  ├─ today.ts
│     │  └─ exceptions.ts
│     ├─ reservations/
│     │  ├─ index.ts           GET/POST /api/reservations
│     │  ├─ calendar.ts        GET  /api/reservations/calendar
│     │  └─ [id]/
│     │     ├─ index.ts        GET/PATCH /api/reservations/:id
│     │     ├─ dates.ts        PATCH
│     │     ├─ cancel.ts       POST
│     │     └─ duplicate.ts    POST
│     ├─ rates/
│     │  ├─ index.ts           GET/PUT /api/rates
│     │  └─ bulk.ts            POST /api/rates/bulk
│     ├─ blocks/index.ts       POST /api/blocks
│     ├─ properties/…          buildings, units, fields, API keys
│     ├─ expenses/…            monthly utilities
│     ├─ housekeeping/…        tasks, assign, complete
│     ├─ maintenance/…         issues, approve, complete
│     ├─ statements/…          generate, send, pdf
│     ├─ payouts/…
│     ├─ owners/…
│     ├─ guests/…
│     ├─ users/…               invite, roles, org chart
│     ├─ integrations/…        connect, refresh, status
│     ├─ settings/index.ts
│     ├─ webhooks/
│     │  ├─ airbnb.ts          POST /api/webhooks/airbnb
│     │  ├─ booking-com.ts
│     │  └─ agoda.ts
│     └─ _middleware.ts        session, permissions, audit, CORS
├─ migrations/                 D1 SQL, applied in order
│  ├─ 0001_schema.sql          ← schema.sql from this package
│  └─ 0002_seed.sql            ← seed.sql, staging only
├─ src/                        React frontend
│  ├─ styles/tokens.css        ← tokens.css from this package, unchanged
│  ├─ lib/
│  │  ├─ api.ts                typed fetch wrapper
│  │  ├─ copy.ts               ← generated from copy.md
│  │  └─ permissions.ts        ← generated from permissions.json
│  ├─ components/              shared primitives, from Houzs/Hookka
│  ├─ modules/                 one folder per screen in routes.json
│  └─ routes.tsx               ← built from routes.json
├─ public/icons/               ← icons/ from this package (or import lucide-react)
├─ wrangler.toml
├─ package.json
└─ .dev.vars                   local secrets, never committed
```

**The files in this design package map straight in:**

| Package file | Goes to | Purpose |
| --- | --- | --- |
| `schema.sql` | `migrations/0001_schema.sql` | Creates every table and enum |
| `seed.sql` | `migrations/0002_seed.sql` | Demo data, staging only |
| `tokens.css` | `src/styles/tokens.css` | The entire visual theme |
| `tokens.json` | design tooling, visual regression tests | Same contract as data |
| `routes.json` | drives `src/routes.tsx` and the nav builder | Every route and button |
| `permissions.json` | `functions/api/_middleware.ts` | Role × resource × action |
| `api.md` | the contract each function implements | Request and response shapes |
| `copy.md` | `src/lib/copy.ts` | Every visible string, keyed |
| `components.md` | frontend build reference | Component inventory and states |
| `notifications.md` | notification worker | Triggers, timing, payloads |
| `registry.js` | replaced by real D1 data | Demo registry only |

---

## 2. Create the Cloudflare resources

**The short way.** This does the whole section, and is safe to re-run:

```bash
npm install
npx wrangler login
npm run setup
```

`npm run setup` creates the database, applies every migration, asks for an admin
email and password, seeds demo data, and writes the `database_id` into **both**
`wrangler.toml` and `wrangler.cron.toml`. Then `npm run dev`.

**By hand**, if you would rather see each step:

```bash
npx wrangler d1 create theconts-prod
npx wrangler d1 create theconts-staging   # only if you want a staging env
```

Each prints an `id`. Paste the production one into `wrangler.toml` **and**
`wrangler.cron.toml` — both bind the same database, and a placeholder left in
either one fails that deploy.

No R2 bucket or KV namespace is needed. Sessions are stateless signed cookies, and
the photo-upload endpoint is not built yet. Both bindings are present in
`wrangler.toml` but commented out, with a note on what to uncomment when uploads
land. **A binding with a placeholder id fails `wrangler deploy` on the spot**, which
is why they are off rather than stubbed.

---

## 3. wrangler.toml

Already in this package. Only the D1 `database_id` needs filling — `npm run setup`
does it for you.

Cron is **not** in this file. Pages Functions route by file path, so a scheduled
handler in `functions/` would be served as a URL instead of running on a schedule.
It lives in `worker/scheduled.ts` with its own `wrangler.cron.toml`, deployed
separately with `npm run deploy:cron`.

---

## 4. Secrets

Never commit these. Local development uses `.dev.vars`; production uses `wrangler secret`.

```bash
npx wrangler pages secret put SESSION_SECRET      # openssl rand -base64 32
npx wrangler pages secret put AIRBNB_API_KEY
npx wrangler pages secret put AIRBNB_WEBHOOK_SECRET
npx wrangler pages secret put BOOKING_COM_API_KEY
npx wrangler pages secret put AGODA_API_KEY
npx wrangler pages secret put WHATSAPP_TOKEN
npx wrangler pages secret put RESEND_API_KEY      # transactional email
```

`.dev.vars` for local work:

```
SESSION_SECRET="local-dev-only-not-a-real-secret"
AIRBNB_API_KEY="sandbox-key"
BOOKING_COM_API_KEY="sandbox-key"
AGODA_API_KEY="sandbox-key"
WHATSAPP_TOKEN="sandbox-token"
RESEND_API_KEY="sandbox-key"
```

---

## 5. Database

```bash
# local, for development
npx wrangler d1 execute theconts-staging --local --file=./migrations/0001_schema.sql
npx wrangler d1 execute theconts-staging --local --file=./migrations/0002_seed.sql

# staging
npx wrangler d1 execute theconts-staging --remote --file=./migrations/0001_schema.sql
npx wrangler d1 execute theconts-staging --remote --file=./migrations/0002_seed.sql

# production: schema only, never the seed
npx wrangler d1 execute theconts-prod --remote --file=./migrations/0001_schema.sql
```

**Two notes on `schema.sql` for D1.** D1 is SQLite, not PostgreSQL. Either run
Postgres (Hyperdrive or Supabase) and use the file as-is, or convert for D1:

| PostgreSQL | D1 / SQLite replacement |
| --- | --- |
| `CREATE TYPE … AS ENUM` | `TEXT` + `CHECK (col IN ('a','b',…))` |
| `uuid DEFAULT gen_random_uuid()` | `TEXT PRIMARY KEY`, generate with `crypto.randomUUID()` |
| `timestamptz` | `TEXT` in ISO 8601 UTC |
| `numeric(12,2)` | `INTEGER` in **sen** (cents). RM 12,450.00 = 1245000 |
| `jsonb` | `TEXT` holding JSON |
| `EXCLUDE USING gist` (no double-booking) | Enforce in the API inside a transaction, plus a `UNIQUE` guard |
| `citext` | `TEXT COLLATE NOCASE` |

Storing money as integer sen is the safer choice on SQLite either way — it removes
float rounding from statements entirely. Format at the edge using the rules in
`copy.md` section 13.

---

## 6. Run locally

```bash
npm run dev          # vite + wrangler pages dev, http://localhost:8788
```

Sign in with a seeded account. Every seeded user has
`must_change_password = true`, so the first sign-in lands on
`/change-password` — that is correct behaviour, not a bug.

---

## 7. Deploy

**Connect the repo once**, in the Cloudflare dashboard:
Workers and Pages → Create → Pages → Connect to Git → pick the repository.

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` |
| Node version | 20 |

Bind the resources under Settings → Functions:

| Binding | Type | Value |
| --- | --- | --- |
| `DB` | D1 | theconts-prod |

After that, **every push to `main` deploys production** and every pull request gets
its own preview URL. Manual deploy if you need it:

```bash
npm run build
npx wrangler pages deploy dist
```

---

## 8. Scheduled jobs

Channel sync and the monthly cycle run on Cron Triggers, configured in
`wrangler.toml` and implemented in `functions/scheduled.ts`:

| Schedule | Job | What it does |
| --- | --- | --- |
| `*/15 * * * *` | Channel pull | Fetch new and changed reservations; auto-create the housekeeping task on each new checkout |
| `0 * * * *` | SLA sweep | Recompute `riskRank`, move breached tasks to Overdue, fire check-in-risk alerts |
| `0 1 1 * *` | Statement generation | Build provisional statements for the closed month |
| `0 2 * * *` | Notification queue | Send anything held by quiet hours |
| `0 3 * * *` | Integration health | Flag expired or degraded channel connections |

---

## 9. Order of build

Do not build all of it at once. This order keeps each step testable:

1. `_middleware.ts` — session, role loading, permission check, audit write
2. `/api/auth/*` — sign in, change password, session. Nothing else works without it
3. `/api/properties/*` — buildings and units. Everything references a unit
4. `/api/owners/*` — owners and contracts
5. `/api/reservations/*` + the channel webhooks — the heart of the system
6. `/api/housekeeping/*` — auto-created from checkouts in step 5
7. `/api/maintenance/*`
8. `/api/expenses/*` — monthly utilities
9. `/api/statements/*` and `/api/payouts/*` — needs 5, 7 and 8 to be correct
10. `/api/users/*`, `/api/integrations/*`, `/api/settings`

---

## 10. Before going live

- [ ] `seed.sql` has **not** been run against production
- [ ] Every seeded password replaced; `REPLACE_WITH_HASH` appears nowhere
- [ ] `SESSION_SECRET` is a real 32-byte random value
- [ ] Session cookie is `httpOnly`, `Secure`, `SameSite=Lax`
- [ ] Rate limit on `/api/auth/login` (Cloudflare WAF rule, 10 per minute per IP)
- [ ] Channel webhook signatures verified before the payload is trusted
- [ ] `access_credentials.secret` and `owners.bank_account_ref` encrypted at rest
- [ ] R2 objects served through signed URLs, never public
- [ ] Daily D1 backup (`wrangler d1 export`) to R2
- [ ] Owner queries scoped by session `owner_id`, verified with a test account
- [ ] Field-role responses contain no financial fields, verified with a test account
- [ ] The logo placeholder replaced with the real SVG
- [ ] `--font-sans` resolved across Houzs, Hookka and The Conts
