repo: hello-houzs/hookka-erp
branch: master

## Also read
- weisiang329-eng/houzs-erp (branch main) — sibling ERP, read for its login page, auth flow and brand tokens

## Last sync
date: 2026-09-18T16:20:00Z

### Updated in this project
- Closed the last design-to-code gap: built `UnitRecordPage` with all seven tabs from the design files, plus `GET /api/units/detail` which returns the whole record in one request rather than one per tab.
- The Financials tab is driven by the payload, not by CSS: for roles without finance access the endpoint omits `pnl` entirely and the tab disappears from the header. Access codes are never in this payload — revealing one stays a separate audited request.
- Wired unit rows in the Properties tree and the Portfolio table through to the record.

### Previous sync
date: 2026-09-18T15:40:00Z

### Updated in this project
- Found a real inconsistency by comparing every page's response interface against its endpoint's emitted keys: three endpoints (`tasks`, `users`, `reservations`) returned raw snake_case SQL rows while the other twenty-plus mapped to camelCase. The pages read snake_case so nothing was broken, but the next field added would have silently come back undefined. Normalised all three endpoints and their pages, and converted SQLite's 0/1 flags to real booleans.
- Wrote `KNOWN-ISSUES.md`: what the static audit covered and found, the three integration stubs, what is waiting on the client, the deliberate contrast deviation from the brand guide, and the smaller decisions a reviewer will question.

### Previous sync
date: 2026-09-18T15:05:00Z

### Updated in this project
- Audited `wrangler.toml` against what the code actually reads and found three deploy blockers: a `[triggers]` block in a Pages config (Pages has no cron), an R2 `MEDIA` binding with no upload endpoint, and a KV `SESSIONS` binding that nothing uses because auth is stateless signed cookies. A binding left on a placeholder id fails `wrangler deploy` immediately, so the unused two are commented out with a note on when to re-enable them.
- Fixed `npm run setup` writing the D1 id into `wrangler.toml` only — `wrangler.cron.toml` binds the same database and kept the placeholder, so the cron deploy would have failed.
- Corrected DEPLOY.md, which still instructed creating an R2 bucket and KV namespace and replacing "four REPLACE_ME ids".

### Previous sync
date: 2026-09-18T14:20:00Z

### Updated in this project
- Ran a build audit across 56 source and 37 endpoint files rather than assuming the code compiled. Found and fixed 15 unused imports (fatal under `noUnusedLocals`) and 8 uses of the `React.*` type namespace without importing it.
- Fixed two deploy blockers: `functions/scheduled.ts` sat in the Pages routing tree and would have been served as a URL instead of running on a schedule — moved to `worker/scheduled.ts` with its own `wrangler.cron.toml`; and the login hero `<img>` showed a broken-image icon on a clean install — now a CSS background so the panel holds without artwork.
- Added `npm run setup`: one command for database, migrations, admin account, demo data and local secrets. Re-runnable.
- Added `src/components/Logo.tsx` — every logo position renders it, so supplying the vector is one file drop plus one flag.
- Added the field mobile surface: `FieldShell` + `FieldTodayPage`, routed automatically for housekeeper and technician roles.

### Previous sync
date: 2026-09-18T13:00:00Z

### Updated in this project
- Built `functions/_lib/notify.ts`, the delivery adapter every TODO was waiting on: idempotency keyed on {template, entity, hour}, quiet hours 22:00–08:00 MYT with an urgent override, failure recorded as a state rather than thrown, and a graceful path when providers are unconfigured.
- Replaced all 9 notification stubs with real calls — cleaner assignment, damage reports, statement sends, payouts paid and failed, quote decisions, user invitations, password changes and resets, outbound WhatsApp replies.
- Added `functions/scheduled.ts` (queue drain, overdue sweep, unsent-statement flag), `GET /api/statements/pdf` as print-ready HTML with its own @page rules, and `/api/notifications` so failed sends surface instead of dropping.
- Verified: 37 endpoint files, zero TODO markers remaining.

### Previous sync
date: 2026-09-18T12:15:00Z

### Updated in this project
- Connected all 28 pages to the API and deleted `src/lib/mock.ts`. Cross-checked: no page imports mock data, and all 24 API paths the pages call resolve to an endpoint file.
- Added the three endpoints the last pages needed — `/users`, `/integrations`, `/settings`, `/owners` — plus `migrations/0003_settings.sql` for organisation defaults as key/value.
- Each page keeps a typed FALLBACK so a failed refresh shows the last figures behind a StaleBanner instead of blanking; the fallback doubles as payload-shape documentation.

### Previous sync
date: 2026-09-18T11:05:00Z

### Updated in this project
- Added `src/lib/useApi.ts` (fetch hook with a fallback so a failed refresh keeps the last figures visible) and `src/components/DataState.tsx` (StaleBanner, TableSkeleton).
- Wired three pages to live data as templates for the rest: Expenses (plain list), Statements (two mutations plus partial-failure handling), Operations today (the 409 ASSIGNEE_BUSY warn-confirm-retry round-trip).
- Documented the three-step conversion in HANDOFF.md and listed which pages remain on mock data.

### Previous sync
date: 2026-09-18T10:30:00Z

### Updated in this project
- Wrote the remaining 17 API endpoints: housekeeping roster and assignment, tasks and completion, maintenance issues and owner approval, inspections, inventory, access credentials, expenses, payouts, statements list and generation, contracts, analytics, pricing, reviews, messages, automations, guests, audit.
- Added `migrations/0002_operations.sql` with the 11 tables those endpoints need, then cross-checked: 28 tables defined, every table referenced by an endpoint is present.
- Kept the established rules throughout — integer sen, role-scoped payloads rather than hidden fields, audit on every financial and destructive mutation, partial failures named individually, and a 409 with the conflicting record where a constraint cannot live in SQLite.

### Previous sync
date: 2026-09-17T09:48:00Z

### Updated in this project
- Built the remaining 15 screens in React: Portfolio, Housekeeping roster, Maintenance, Tasks, Inspections, Inventory, Access and keys, Expenses, Payouts, Contracts, Analytics, Pricing, Reviews, Inbox, Automations.
- Wired all 28 navigation destinations into the router and verified by cross-check: 28 nav paths, 28 routes, 28 page files, no orphans and no dead links.
- Reused the established patterns throughout — integer sen for money, three-part tone tokens with `line` for borders and `fg` for text, closed status vocabulary, masked secrets with an audited reveal.

### Previous sync
date: 2026-09-17T09:12:00Z

### Updated in this project
- Ported the desktop product to real React + TypeScript: `src/theme.ts` (every token typed), `src/lib/navigation.ts` (nav tree + role filtering), `AppShell`/`Sidebar`/`TopBar`, `LoginPage`, and 11 page components.
- Wrote the Cloudflare Pages Functions API: auth (login with lockout, session, logout, forgot, change-password), units, reservations + calendar, statements send, dashboard KPIs.
- Converted `schema.sql` from PostgreSQL to D1 as `migrations/0001_init.sql`: enums became CHECK constraints, money became integer sen, and the EXCLUDE overlap constraint moved into the reservations endpoint as a 409 with the conflicting booking attached.
- Added `scripts/hash-password.mjs` (PBKDF2, same scheme as houzs-erp), `scripts/seed-d1.sql`, build scaffolding, and `HANDOFF.md`.

### Previous sync
date: 2026-09-17T14:46:23Z

### Updated in this project
- Rebuilt the calendar as a channel-manager surface: property dropdown, per-channel checkboxes with select/deselect all, booking-status chips with individual removal and reset, expandable per-unit rate rows (Inventory, Web rate, Airbnb rate, Booking.com rate), cell actions for block/reserve/set-price, and bulk rate and block wizards.
- Replaced the photographic login on both desktop and mobile with a self-drawing architectural floor plan in SVG — on brand, since The Conts designs and furnishes the units it hosts, and it needs no photography from the client.
- Copied 10 more lucide 0.477.0 icons at stroke 1.75.
- Wrote `BUTTONS.md`: every control in the product mapped to its endpoint, the tables it writes, and the resulting UI state, including the automatic writes that have no button (checkout → cleaning task with a window computed from the next arrival).
- Wrote `DEPLOY.md` and `wrangler.toml`: repo layout, Cloudflare Pages + D1 + R2 + KV setup, migrations, secrets, cron triggers, a PostgreSQL-to-D1 conversion table, build order and a go-live checklist.
- Fixed a duplicate `resUnits` declaration introduced by the calendar rebuild that broke the page.

### Previous sync
date: 2026-09-17T11:20:00Z

### Updated in this project
- Corrected a structural mistake: Reservations had been built as a separate page while the desktop app already had its own calendar screen, leaving two versions of the same module. Merged the full Reservations module (calendar, bookings, guests, reservation drawer) into `The Conts Desktop.dc.html` behind the sidebar, and deleted the standalone file.
- Added a matching Bookings module to `The Conts Mobile.dc.html` so both products cover reservations with the same status vocabulary and channel treatment — desktop gets the full grid, mobile gets today's arrivals and departures as cards.
- Recorded the structural rule in routes.json: two products, not many pages. Design System and Frontend Spec are reference, not surfaces.

### Previous sync
date: 2026-09-17T10:04:00Z

### Updated in this project
- Added `icons/image.svg` from lucide 0.477.0 (stroke 1.75) and stopped using `image-slot` below ~120px: its built-in empty-state caption cannot be suppressed and wrapped illegibly inside 44-48px tiles. Small thumbnails are now a neutral square with an image glyph, which also removed the duplicate slot ids. `image-slot` is kept for the drawer hero and other large slots.
- Added the missing `icons/x.svg` from lucide 0.477.0 (stroke 1.75) — the drawer's close control was masked to a 404 and painted as a solid white square.
- Built the Reservations module as `The Conts Reservations.dc.html`: photo-led calendar, full booking records and guest profiles, with a reservation drawer shared by both.
- Calendar rows now carry a unit photograph, unit number, building and nightly rate; blocks print channel and guest name, and non-revenue blocks (maintenance, owner stay) use a dashed or dotted edge so they read without colour.
- Reservation drawer covers the money chain (gross, channel fee, cleaning, tourism tax, collected) and a booking-to-check-in timeline, with Message guest, Change dates and Cancel wired to confirmations.
- Fixed the mobile shell: `font-family:"IBM Plex Sans"` inside the root inline style broke style parsing and collapsed the app shell, pushing the tab bar 771px below the fold. Font moved to the helmet, height changed to 100dvh.
- Recorded all three reservation screens and the drawer in routes.json.

### Previous sync
date: 2026-09-17T09:12:00Z

### Updated in this project
- Dropped the borrowed Hookka visual language from both logins — the concentric rings, drifting gold motes and gold gradient CTA were that product's identity, not The Conts's.
- Rebuilt both logins around the one thing only The Conts has: the property itself. Full-bleed interior photograph on a slow 34s Ken Burns drift, a 60px editorial headline, one gold hairline, and a strip of three REAL units with live readiness dots — the same data the dashboard shows.
- Coordinated login with the app: the form now sits on a warm-white card with the same fields, borders and black primary action used inside the product, so signing in and using it read as one system.
- Merged the mobile login's duplicated three-box rows into a single composition.

### Previous sync
date: 2026-09-16T15:56:30Z

### Updated in this project
- Fixed a contrast regression I introduced on the new dark logins: micro labels were set with white alphas (rgba(255,255,255,0.24–0.42)), which composite to 2.3–4.1:1 and fail AA. Replaced with the published dark-shell tokens #DEDAD3 (13.10:1) and #8A8680 (5.04:1), and added `--color-text-on-dark-muted` so it cannot be reinvented.
- Lifted 26 off-scale font sizes (8.5, 9, 9.5, 10, 10.5px) to the documented 11px micro floor across both apps.

### Previous sync
date: 2026-09-16T15:53:40Z

### Updated in this project
- The client shared screenshots of the DEPLOYED Hookka login, which differs from `hookka-erp/src/app/(auth)/login/page.tsx` in the repo: full warm-black canvas with a faint blueprint grid, a large centred emblem ringed by concentric circles and drifting gold motes, wide-tracked micro labels pinned to all four corners, a dark translucent form card, and a gold gradient CTA with a trailing arrow. Rebuilt both logins in that language.
- Kept the divergences that belong to The Conts: property photography behind the grid at low opacity, a three-slot fit-out strip, and the real metrics the client approved (4.91 rating, 86.2% occupancy, 24 units).
- Added `icons/mail.svg` from lucide 0.477.0 for the field affixes.

### Previous sync
date: 2026-09-16T15:46:20Z

### Updated in this project
- Fixed a real clipping defect on the desktop login: the brand stage pinned `height:100%` of an 860px row with `overflow:hidden` while the composition needed 976px, so the bottom location line was cut entirely. The row now has a 980px floor, the stage grows with its content, and only the photo layer clips.
- `./icons/` is preview-only; production imports `lucide-react`. Noted in components.md.

### Previous sync
date: 2026-09-16T15:43:02Z

### Updated in this project
- Copied 36 real lucide 0.477.0 SVGs from `lucide-icons/lucide` at the `0.477.0` tag into `icons/` and set their stroke to 1.75 to match `hookka-erp/src/components/layout/sidebar.tsx`. Icons now load locally instead of from a CDN, so there is no external dependency and the geometry is genuine lucide.
- Corrected `alert-triangle` to `triangle-alert` (renamed in lucide 0.4xx).
- Rebuilt both login screens for presence rather than explanation: full-bleed property photograph, 56px display headline, a single gold hairline, three quiet metrics in wide-tracked small caps, and an inset gold frame. Removed the explanatory paragraph, the fit-out gallery strip and the assurance list.

### Previous sync
date: 2026-09-16T15:35:46Z

### Updated in this project
- Read `houzs-erp/src/pages/LoginPage.tsx` to check the reference: it is a plain centred white card with a 20px title and no imagery, so the liveliness the client recalled is not from there. Kept The Conts login clean rather than decorating it.
- Removed the portal picker from both logins. One sign-in for every role; the account's role decides the landing screen, mirroring `login()` in houzs-erp and the `home` field in `POST /api/auth/login`. Prototype state moved from on-canvas chips into Tweaks props (`accountRole`, `authState`, `startRole`).

### Previous sync
date: 2026-09-16T15:34:10Z

### Updated in this project
- Split the product into two pages as requested: `The Conts Desktop.dc.html` and `The Conts Mobile.dc.html`. Removed the superseded combined file.
- Mobile carries three role apps behind one sign-in — staff, field crew and owner — with bottom navigation, 44px targets, bottom-sheet dialogs and a profile sheet with logout.

### Previous sync
date: 2026-09-16T15:26:40Z

### Updated in this project
- Grounded the icon set in `lucide-react@^0.477.0` after confirming it in both repos' `package.json` and reading `hookka-erp/src/components/layout/sidebar.tsx` (16px, strokeWidth 1.75). Replaced the hand-drawn glyphs with named lucide icons, published the destination-to-icon map in `tokens.json`, and added a `.icon` mask class so HTML surfaces use the real lucide geometry.
- Fixed a genuine accessibility defect: the brand guide's §4.2 status colours fail WCAG AA as 11px badge text on their own tints (success 4.18:1, warning 3.32:1, critical 4.45:1). Split each state into `bg` / `-fg` / `-line`, darkened the text foregrounds to 5.4–6.0:1, kept the guide hexes for non-text use, and recomputed every published ratio with the WCAG formula.

### Previous sync
date: 2026-09-16T15:18:12Z

### Updated in this project
- Rebuilt the token layer to the depth of the sibling ERPs after reading `houzs-erp/src/lib/ui-tokens.ts`, `houzs-erp/src/index.css` and `hookka-erp/src/app/globals.css`: 9-step gold and basalt ramps, a 6-step stone ramp, semantic bg/fg pairs, sidebar/surface/text/border token families, radius and shadow scales, channel colours, chart series, and the texture and animation utility classes.
- Adopted Hookka's conventions directly: `--font-sans`/`--font-mono` split with mono reserved for references and IDs, global `font-feature-settings`, tabular numerals on all tables, hairline utilities, `.bg-blueprint`, `.bg-stone-grid`, `.bg-diagonal`, `.field-input`, `.dot`, `.eyebrow`, `pulse-soft` and `rise` keyframes, and the print block.
- Documented the one deliberate divergence: Hookka inputs are square, the brand guide mandates 8px controls and 12px cards. The Conts follows the brand guide.
- Added a contrast pass/fail table to the design system after finding `#C8A46A` fails AA as text on white (2.1:1) — introduced `gold-700 #8A6A2F` as the text token.
- Rebuilt the app as separate desktop and mobile products with icon-led L1/L2/L3 navigation, a real profile menu and logout, photo slots, dialogs and toasts.

### Previous sync
date: 2026-09-16T13:41:05Z

### Updated in this project
- Consolidated 7 design pages into 3: sign-in folded into The Conts Property OS as a context in the header; superseded login versions and the old OS draft removed.
- Added `permissions.json` (role × resource × action, deny by default), `components.md` (component inventory, states, validation contract, keyboard map), `notifications.md` (every message with trigger, timing, payload) and `seed.sql` (demo data reproducing the designs' figures).
- Extended the Frontend Spec with data-format, notification and still-to-specify sections, plus a README indexing the package.

### Previously
- Built the full frontend handoff package: `tokens.css`, `tokens.json`, `routes.json`, `schema.sql`, `api.md`, `copy.md`, a rendered design-system page and a printable frontend specification.
- Tokenised the brand guide into semantic CSS variables matching the guide's §21.3 theme contract, so The Conts is a theme over the shared Houzs/Hookka React foundation rather than a separate frontend.
- Mapped the guide's 9-group IA to concrete routes, role allowances, button targets, request shapes and confirmation copy.
- Derived the database status enums directly from the guide's §11 closed status taxonomy (reservation, unit readiness, task/issue) so UI, API and DB share one vocabulary.

## Screen map
| File (this project) | Built from |
| --- | --- |
| The Conts Property OS.dc.html | Sign-in from hookka-erp `src/app/(auth)/login/page.tsx`, `src/app/globals.css`, `src/app/layout.tsx` and houzs-erp `src/pages/LoginPage.tsx`, `src/index.css`; app screens from brand guide §13–14 |
| The Conts Design System.dc.html | Brand guide §4–12, 20 |
| The Conts Frontend Spec.dc.html | Brand guide §13–24; auth flow from both repos' real routes |
| tokens.css / tokens.json | Brand guide §4, 5, 6, 7, 20, 21.3; structure and conventions from hookka-erp `src/app/globals.css` and houzs-erp `src/lib/ui-tokens.ts` |
| The Conts Desktop.dc.html | Sidebar depth pattern from the Houzs ERP shell; lucide icons per hookka-erp `src/components/layout/sidebar.tsx`; brand guide §13–14 |
| The Conts Mobile.dc.html | Brand guide §16 responsive rules and §16.1 field screens; same lucide set and token layer |
| routes.json | Brand guide §13, 14, 15, 16; auth routes from both repos |
| schema.sql | Brand guide §11 status taxonomy, §12 metric definitions, §15.2 transparency rules, §19 audit requirements |
| api.md | Brand guide §9.3, 10, 12, 15.2, 16.1, 19 |
| copy.md | Brand guide §5.3, 5.4, 11, 18 |
| permissions.json | Brand guide §13.1, 16.1, 19 |
| components.md | Brand guide §8, 9, 10; shared component layers from §21.2 |
| notifications.md | Brand guide §18 voice rules; operational triggers from §14, 15, 16.1 |
| seed.sql | Figures shown in the designs |

## Open items for engineering
- **Shared UI font unresolved.** Guide §5.1 mandates one shared production font across Houzs, Hookka and The Conts. Houzs ERP ships Tahoma; Hookka ERP ships IBM Plex Sans. Built on IBM Plex Sans via `--font-ui`; normalise per guide §21.5 step 2 and change the single token.
- **Radius conflict.** Hookka inputs are square; the guide mandates 8px controls and 12px cards. Followed the guide.
- **Auth backends differ.** houzs-erp uses Cloudflare Pages Functions + PBKDF2 + JWT cookie; hookka-erp uses next-auth credentials. `api.md` specifies behaviour, not implementation.
- **Step 1 of the guide's rollout sequence is unstarted:** audit the exact React, styling, component, icon, form, table, chart and data-fetching libraries in both ERPs before composing The Conts modules.
