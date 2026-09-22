# Conts Property OS — Handoff

_Last updated: 2026-09-22_

Conts is the back office for a **short-term-rental / homestay management operator**
in Malaysia (manages other owners' units, lists across OTAs). Not a booking platform.

## Current state

- **PR #9 — scrollable calendar:** open, browser-verified.
- **Date-format hardening:** in flight on branch `fix/date-format-conventions`. Adds
  helpers `monthLabel`, `year`, `dateTime`, `dateShort`, `weekdayDay`, `relative`,
  `dateInputValue`, `fileStamp` to `src/lib/format.ts`.
- **This branch (`docs/conventions-and-positioning`):** docs only —
  `docs/DATE-FORMAT.md` (the target date/time convention) and
  `docs/COMPETITIVE-POSITIONING.md` (operator-framed competitive analysis).

## Outstanding / blocked

- **⚠️ Supabase DB password rotation (OWNER ACTION):** the database password was
  leaked in git history earlier and **must be rotated by the owner**. Not something
  an agent can do — rotate in the Supabase dashboard and update the deployment
  secret. Until then, treat the exposed credential as live.

## Next up (operator priorities — see COMPETITIVE-POSITIONING.md)

1. PriceLabs (dynamic pricing) — 2. Xero export — 3. Guest-comms automations + AI
   reply via Houzs Connect — 4. Self-check-in + foreign-guest registration
   (Chekin/Enso) — 5. Direct-booking + Stripe (last/optional).
