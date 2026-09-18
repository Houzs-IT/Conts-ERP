# Known issues and open items

Everything here is deliberate and specific. Nothing in this file is a guess about
what might be wrong — each item is something I verified, could not finish in this
environment, or that needs a decision from The Conts.

Last reviewed: 18 September 2026

---

## 1. The build has never been executed

**Status:** unresolved here. Needs a machine with Node.

I could not run `npm run build` or `tsc --noEmit` — this environment has no Node
runtime. What I did instead was a static audit across all 56 source files and 37
endpoint files, checking each category a typecheck would catch:

| Check | Found | Fixed |
| --- | --- | --- |
| Relative import paths that do not resolve | 0 | — |
| Named imports that do not match a real export | 0 | — |
| Unused imports (fatal under `noUnusedLocals`) | 15 | yes |
| `React.*` type namespace used without importing it | 8 | yes |
| Unused function parameters (fatal under `noUnusedParameters`) | 0 | — |
| Pages missing a default export | 0 | — |
| Routes pointing at files that do not exist | 0 | — |
| Endpoint field names not matching what pages read | 3 | yes |

**What to expect on the first real build:** possibly a handful of residual type
errors — a `string | null` passed where `string` is wanted, or similar. They will be
specific and local. The structural classes of failure are cleared.

Run it first thing:

```bash
npm install
npm run typecheck    # tsc --noEmit, faster than a full build
```

---

## 2. Three integrations are stubs

Each is marked `TODO` in the source. Everything around them — validation,
permission, persistence, audit — is finished.

### 2.1 Mail and WhatsApp delivery
`functions/_lib/notify.ts` writes every send to `notification_log` and respects quiet
hours, but does not call a provider. Without `MAIL_API_KEY` / `WHATSAPP_TOKEN` it
records the send as `queued` and returns without throwing, so a missing provider
never breaks the action that triggered it.

**To finish:** implement the provider call inside `notify()`. Every template, trigger,
timing and payload is specified in `notifications.md`.

### 2.2 Outbound channel push
Replies typed in the Inbox persist to `messages` but do not reach Airbnb or
Booking.com. Inbound sync is also not built — the calendar reads whatever is in the
database.

**To finish:** a channel adapter per provider. `wrangler.cron.toml` already has the
15-minute trigger that should pull.

### 2.3 Statement PDF
`owner_statements` and `statement_lines` compute correctly and the UI shows the full
gross-to-net chain. `GET /api/statements/:id/pdf` is not implemented, so the owner
portal's download button has nothing to fetch.

**To finish:** render from `statement_lines`. Every line already carries a category,
date, amount and reference, which is what the brand guide requires an owner to see.

---

## 3. Waiting on The Conts

### 3.1 Logo
Every logo position in the product renders `src/components/Logo.tsx`. To supply it:

1. Drop the vector at `public/brand/logo.svg` and the symbol at `public/brand/mark.svg`
2. Set `HAS_ARTWORK = true` at the top of `Logo.tsx`

That is the whole change — no page edits. Until then a dashed `SVG` placeholder box
appears, which is intentional: it reads as unfinished rather than as a design choice.

### 3.2 Photography
`public/brand/login-hero.jpg` is referenced as a CSS background, so a missing file
degrades to the blueprint grid rather than a broken-image icon. Drop a file at that
path and it appears.

Unit records have image slots in the design files but not in the React build — photo
upload needs the R2 binding and an upload endpoint, both noted in `wrangler.toml`.

### 3.3 The shared font
The brand guide requires **one** UI font across Houzs ERP, Hookka ERP and The Conts.
Houzs ships Tahoma; Hookka ships IBM Plex Sans. This build uses IBM Plex Sans.

Changing it is one line in `tokens.css` (`--font-sans`) plus the matching line in
`src/theme.ts`. It is a decision, not a task.

### 3.4 Real figures
Every number in `scripts/seed-d1.sql` and in each page's `FALLBACK` constant is
representative placeholder data in a Kuala Lumpur and Petaling Jaya context. It is
there so screens render before the database is populated, and so the payload shape is
self-documenting.

**Before any demo to an owner:** run against real data. The figures are plausible,
which makes them more dangerous than obviously fake ones.

---

## 4. A deviation from the brand guide, on purpose

The guide's §4.2 status colours fail WCAG AA as 11px badge text on their own tints:

| State | Guide value | Measured on its tint | Used instead |
| --- | --- | --- | --- |
| Success | `#16845B` | 4.18:1 | `#11694A` — 5.97:1 |
| Warning | `#B7791F` | 3.32:1 | `#8A5A12` — 5.40:1 |
| Critical | `#C2413B` | 4.45:1 | `#A8352F` — 5.70:1 |

The guide's own §4.3 requires AA for body text and interactive controls, and these are
status labels in dense operational tables — exactly where legibility matters. The
guide's hexes are retained as `-line` for dots, borders and chart series, where the
3:1 non-text threshold applies.

Also: `#C8A46A` is 2.34:1 on white and is **not a text colour**. Gold text uses
`#8A6A2F`. Gold-500 is for fills, borders and accents.

Recorded in `tokens.json` under `semantic.$accessibilityCorrection` with
`takeToClient: true`. **Worth raising with whoever owns the brand guide** — either the
guide gets corrected, or someone consciously accepts failing contrast.

---

## 5. Smaller things a reviewer will notice

| Item | Why it is like this |
| --- | --- |
| Staging D1 id is still `REPLACE_ME_STAGING_D1_ID` | `npm run setup` only creates production. Fill it in only if you want a staging environment. |
| R2 and KV bindings are commented out in `wrangler.toml` | Nothing uses them — sessions are stateless signed cookies, and photo upload is not built. A binding with a placeholder id fails `wrangler deploy` on the spot, so they are off rather than stubbed. |
| Cron is a separate Worker | Pages Functions route by file path, so a scheduled handler in `functions/` would be served as a URL instead of running. It lives in `worker/scheduled.ts`, deployed with `npm run deploy:cron`. |
| Routing is hash-based (`#/reservations/calendar`) | No server rewrites needed for a static Pages build. Swap for react-router with a `_routes.json` if clean URLs matter. |
| `seed.sql` is PostgreSQL, `scripts/seed-d1.sql` is D1 | The original schema was written for Postgres. The D1 versions in `migrations/` are authoritative. |
| No test suite | None was written. The contracts in `api.md` and `BUTTONS.md` are specific enough to generate tests from. |
| Photo upload | The unit record has no image gallery — that needs the R2 binding and an upload endpoint, both noted in `wrangler.toml`. |
