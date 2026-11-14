# Houzs Connect guest messaging — ERP push (2026-11-14)

Send The Conts' Meta-approved WhatsApp templates to guests through **Houzs Connect**
(`chat.houzscentury.com`), triggered from the two manual guest-message surfaces, with the
template variables auto-filled from the reservation + guest + unit access credentials.

**Status: inert.** Nothing is sent until the Connect shared secret is set and the templates +
automations exist in Connect. This PR wires the ERP side so it can be built, reviewed and merged
safely now.

## Why Connect (not the in-app sender)
The app's own WhatsApp path (`functions/_lib/notify.ts`) sends **free text** through the Graph API,
which only works inside the 24-hour customer-service window. The guest journey
(`automationCatalog.ts` `guest.*`) is spec-only — nothing is wired to send. Connect sends
**Meta-approved templates**, which reach the guest outside the 24-hour window. So Connect is the
implementation of the guest journey, not a duplicate sender. The same push already runs in
production for Houzs Century's ERP (1,741 contacts), so the contract is proven.

## The contract (authoritative — do not change)
- `POST https://chat.houzscentury.com/api/webhooks/erp`, header `x-connect-key: <secret>`.
- Body `{ companySlug: "the-conts", phone, name, automation?, attributes }`.
- **`companySlug` must be exactly `the-conts`** (with the hyphen) or the contact lands in the wrong
  company. It is the only reliable selector.
- Connect upserts the contact by (company, phone-digits) and **merges** `attributes`. `name` feeds
  the Full/First/Last-name built-ins. `automation` names the Connect automation to fire, which sends
  the template immediately (Connect has **no scheduler** — the ERP decides when to send).
- Response `{ ok, triggered: [...] }`. **HTTP 200 with `triggered: []` means nothing was sent** —
  treated as a failed send and surfaced to the operator.

## What this PR adds
- **`functions/_lib/connectFields.ts`** — pure helpers (no DB/fetch, so Node can unit-test them):
  the `kind → Connect field` mapping table, attribute assembly, single-line/date formatting, the
  automation-list parser, and the response→delivery-state logic.
- **`functions/_lib/connect.ts`** — `isConnectConfigured`, `postConnectContact` (the webhook call,
  modelled on `channex.ts` + Houzs Century's `connect.ts`; never throws), and
  `assembleConnectContact` (the per-reservation DB read).
- **`functions/api/connect/preview.ts`** (GET) and **`functions/api/connect/send.ts`** (POST) — the
  send path. Same ops/management gate as `/api/messages`.
- **`src/components/ConnectTemplatePanel.tsx`** — a "Send a WhatsApp template" panel embedded in
  both existing guest-message modals: the **Guests** page `MessageModal` and the **Reservations**
  page `MessageGuestModal`. It previews the filled variables, lets the operator pick/type the
  automation, and sends.
- Env wiring (`Env` in `db.ts`, `wrangler.toml`, `.dev.vars.example`) and tests
  (`src/lib/connectTemplate.test.mjs`).

## Attribute assembly — the data is not flat columns
Assembled per reservation by joining `reservations → guests / units / properties` and **pivoting
`access_credentials` rows by `kind`**. The `kind → Connect key` map is one commented constant in
`connectFields.ts` (`CREDENTIAL_FIELD_MAP`). Credentials are filtered to the reservation's unit and
guest-visible rows (`usedBySql(env,'c','guest')`); the `secret` column is read server-side (the same
clear value the audited reveal path returns). Only keys with a real value are sent (an empty value
renders as `-`). Values are flattened to a single line; dates are formatted `YYYY/MM/DD`.

| Connect key | Source | ⚑ needs CS/ops confirmation |
|---|---|---|
| `unit_no` | `properties.name + ' ' + units.unit_number` | |
| `checkin_date` / `checkout_date` | `reservations.check_in` / `check_out` (→ `YYYY/MM/DD`) | |
| `wifi` | `wifi`.secret | |
| `wifi_username` | `wifi`.label | |
| `mailbox_passcode` | `mailbox_pin`.secret | |
| `mailbox_no` | `mailbox_pin`/`mailbox_key`.label | ⚑ which credential gives the number |
| `mailbox` | `mailbox_key`.label | ⚑ which credential gives the name |
| `maindoor` | `main_door_key`/`smartlock_pin`/`smartlock_key`/`room_key`.secret | |
| `maindoor2` | `lift_card`/`lockbox_pin`/`card`.secret | ⚑ per-building second access |

The date format and the ⚑ rows are each isolated to one spot in `connectFields.ts`, so they are
trivial to adjust once the template copy and CS confirm them.

## OTA guests get the template too
The template send routes by **`guests.phone`** — WhatsApp for any guest who has a phone, on any
channel — not by `thread.channel`. This replicates StreamHost. The existing free-text
`deliverMessage` behaviour (direct → WhatsApp, OTA → Channex inbox) is left untouched; the Connect
template path is the new WhatsApp-for-everyone route. The send still records an outbound `messages`
row with its delivery state on the stay's thread, so the conversation shows it.

## Permissions & secret exposure
- Preview + send use the same gate as `/api/messages`: operations and management only (field roles
  and owner blocked).
- Door codes and Wi-Fi passwords are **masked (bullets) in the preview** for everyone — the operator
  confirms a field is populated without the raw code appearing in the new UI. The clear values only
  travel server-side → Connect → the guest. Pushing credentials to Connect is an inherent
  guest-credential disclosure (that is the point of messaging them); it is management-gated at the
  credential source and audited on send (`connect.template_send`).

## Inert / gating
`isConnectConfigured` requires `CONNECT_WEBHOOK_KEY` (and not demo mode). The key is **left unset**,
so `postConnectContact` and `/api/connect/send` refuse before anything is sent, and the UI shows
"Houzs Connect isn't connected yet". The templates list is parameterised via `CONNECT_AUTOMATIONS`
(none hardcoded); empty → the UI offers a free-text automation name.

## Go-live prerequisites (Connect / migration side, not the ERP)
1. **Shared secret**: Nico provides `ERP_WEBHOOK_SECRET`; set it as `CONNECT_WEBHOOK_KEY` with
   `wrangler secret put` on the Pages app. `CONNECT_WEBHOOK_URL` already defaults to prod.
2. **~41 templates built + Meta-approved** in Connect for The Conts (currently 0).
3. **Automations created + enabled** in Connect for each Model-A (fire-on-push) message, named
   exactly what the ERP sends in `automation`; add those names to `CONNECT_AUTOMATIONS`.
4. **CS/ops confirm the ⚑ credential-`kind` → field mapping** (mailbox parts, second door) and the
   date format.

## Not in this PR (future)
- A scheduled cron push (pre-arrival −48h, access-details −2h, checkout −12h). Connect has no
  scheduler, so timing lives on the ERP side (`cronJobs.ts` + `wrangler.cron.toml`); add
  `CONNECT_WEBHOOK_KEY` to the cron Worker's secrets when that job is added.
- Auto-push on booking-create / OTA ingest / lifecycle moves.
- Phone normalisation to strict E.164 (Connect strips non-digits; data-quality of country codes is
  pre-existing).
