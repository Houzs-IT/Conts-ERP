# The Conts Property OS — frontend handoff package

Design and frontend specification for The Conts Property Management. Built from
The Conts Digital Brand Guide v1.0 (16 September 2026) and the existing Houzs
ERP and Hookka ERP frontends.

## Designs

| File | What it is |
| --- | --- |
| `The Conts Desktop.dc.html` | Desktop product, 1200px and up. Sign in, then the staff PMS: dashboard, operations today, reservation calendar, unit record, owner statements, plus the owner portal. Icon sidebar with L1/L2/L3 depth, collapsible to 68px, profile menu with logout. |
| `The Conts Mobile.dc.html` | Mobile product, 390px. Sign in, then three role apps: staff (home, today, units), field crew (task list with photo gate and offline sync) and owner (statement, property health, approvals). Bottom navigation, 44px targets, bottom-sheet dialogs. |
| `The Conts Design System.dc.html` | Rendered foundations: colour, typography, spacing, radius, elevation, motion, component states, status taxonomy, metric definitions. |
| `The Conts Frontend Spec.dc.html` | Printable specification. Architecture position, permissions, screen-by-screen control tables, backend obligations, outstanding client assets. |

## Implementation files

| File | Consumed by |
| --- | --- |
| `tokens.css` | Theme provider. The only file a brand change touches. |
| `tokens.json` | Figma variables, Storybook, visual regression tests. |
| `routes.json` | Router, permission middleware, QA. Every route, button, request and confirmation string. |
| `permissions.json` | Backend authorisation middleware and the navigation builder. Role × resource × action, deny by default. |
| `schema.sql` | PostgreSQL. Tables, closed status enums, constraints, audit log, metric views. |
| `seed.sql` | Local and staging demo data matching the figures in the designs. |
| `api.md` | Request and response shapes per screen, error codes with exact UI behaviour. |
| `BUTTONS.md` | **Every button in the product** → endpoint → tables written → what the user sees. Start here when implementing a screen. |
| `DEPLOY.md` | GitHub → Cloudflare Pages, D1, R2, KV. Repo layout, migrations, secrets, cron jobs, build order, go-live checklist. |
| `wrangler.toml` | Cloudflare configuration, ready to use once the resource ids are pasted in. |
| `copy.md` | Every visible string, keyed. Status labels, microcopy patterns, formatting rules. |
| `components.md` | Component inventory, states, domain modules, validation contract, keyboard map. |
| `notifications.md` | Every email, WhatsApp, push and in-app message with trigger, timing and payload. |
| `github.md` | Source repositories and open engineering questions. |

## Reading order for a new engineer

1. `README.md` (this file), then the Frontend Spec document for context.
2. `tokens.css` — apply the theme before building anything.
3. `routes.json` and `permissions.json` — the shape of the app.
4. `schema.sql`, then `api.md` — the data contract.
5. `components.md` — what to compose from, what to build.
6. `copy.md` — use the keys, do not retype strings.

## Ground rules

- The Conts is a **theme and domain layer** over the shared ERP frontend, not a
  new frontend. A brand change must be a token change.
- Status vocabulary is closed. No synonyms for one state, in the UI, the API or
  the database.
- Gold is brand and selection only. It never means success, warning or error.
- Status never depends on colour alone.
- Financial data is scoped by role at the payload level, not hidden in the UI.
- Every deduction an owner sees carries a category, date, amount and reference.

## Still required from the client

Tracked in the Frontend Spec, section 10. The two blocking items: the original
vector logo (every logo position is a marked placeholder) and the shared UI font
decision (Houzs ships Tahoma, Hookka ships IBM Plex Sans; the guide requires
one). All figures in the designs are placeholders in a Kuala Lumpur and
Petaling Jaya context.
