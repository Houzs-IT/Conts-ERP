# Competitive Positioning — for an STR Management Operator

## Read this first: what Conts is (and is not)

Conts is the **back office for a short-term-rental / homestay management operator**
in Malaysia. The company manages **other people's units** on their behalf and lists
them across OTAs (Airbnb, Booking.com, Agoda).

Conts is **not a booking platform** and is **not competing with Airbnb as a
marketplace**. It does not chase guest demand; it serves owners and runs operations.
Every capability below is judged from the **operator's** point of view — "does this
help us manage units and pay owners correctly?" — not "does this help a guest find a
place to stay?". Any competitive analysis that ranks Conts against Airbnb/Booking as
a consumer product is asking the wrong question and its priorities must be inverted.

## The crown jewel: the owner-of-record core

This is where Conts already **out-designs the market**, and it is the one area worth
building natively. It is the reason a property owner signs with this operator instead
of another.

- **Ownership chain of record:** State → Building → Unit → Owner. The structural
  spine most STR tools lack, because most tools were built for a host who owns their
  own listings, not a manager holding a portfolio for many owners.
- **Owner statements** with two computation models:
  - **GRR (guaranteed rental return):** owner is paid a fixed guarantee.
  - **Gross − management fee − split expenses:** revenue-share, with expenses
    apportioned per the owner's agreement.
- **Multi-unit combined payouts** for an owner holding several units, plus full
  **statement history**.
- **Owner portal** (desktop **and** mobile) so owners self-serve statements and
  performance without a phone call.
- **Expense drill-down** at L1 / L2 / L3, so a line on a statement can be traced to
  its source.

Channel management is **real**, not a mock: via **Channex** — `unit_channels`
mapping, rate push (`/api/rates/bulk`), webhook sync, and **409 double-booking
prevention**. Operations already **feed the money loop**: per-checkout housekeeping,
maintenance work-order → unit expense → owner statement, inspections, and a
field-crew mobile app. A **unified inbox** and **cron automations** are scaffolded.

## Re-ranked gaps — for an operator

Priorities are ordered for a **management company**, not a platform. "Buy" means
integrate a proven external tool; "Build" means spend the scarce native-build budget.

| Capability | What good operators / tools do | Conts today | Priority | Buy vs build |
| --- | --- | --- | --- | --- |
| **Dynamic pricing** | PriceLabs / Wheelhouse set nightly rates from demand, seasonality, events — the single biggest revenue lever on managed units | Rates pushed to Channex manually / statically | **HIGH** | **Buy** — PriceLabs. Conts already pushes rates to Channex, so this is a webhook in + a table write. |
| **Accounting export** | Push revenue, fees, and owner payouts into Xero / QuickBooks for the operator's real books | Statements computed natively, no accounting hand-off | **HIGH** | **Buy** — Xero. Keep native statement computation; only **push journal lines**. Do not move statement math into the accounting tool. |
| **Guest-comms automation + AI-assisted replies** | Auto-respond to enquiries and routine guest messages; draft replies for staff | Unified inbox scaffolded, no automation | **HIGH** | **Buy/reuse** — Houzs Connect (WhatsApp + inbox). **Draft-only first**, human sends. |
| **Guest self-check-in + foreign-guest registration + refundable deposit** | Chekin / Enso handle ID capture, self-check-in, and the deposit hold | Access-code reveal + WhatsApp delivery exist | **MEDIUM** | **Buy** — Chekin/Enso. This is a **Malaysian legal/ops duty** (foreign-guest registration), not a platform play. Reuse the existing access-code reveal + WhatsApp delivery. |
| **Time-anchored templates + auto guest-review** | Scheduled pre-arrival / check-out / review-request messages | `scheduled_jobs` scaffolding exists | **MEDIUM** | **Build (extend)** — extend existing `scheduled_jobs`; small, close to the metal. |
| **Direct-booking website + Stripe checkout** | A 0%-commission channel the operator controls | — | **LOW / optional** | Buy later. A **bonus** channel, **not table-stakes** for a manager. |
| **Guest upsells / digital guidebook / guest CRM** | Marketplace-style guest experience & monetisation | — | **LOW / optional** | Demoted — these are **platform** features; Conts is not a platform. |
| **Multi-currency** | Consumer-facing FX for international guests | MYR | **LOW / optional** | OTAs already handle guest FX; operator books in MYR. |

**Tax note (statement math, not a platform feature):** Malaysia's **tourism tax
(RM10/night, foreign guests)** and **SST** should eventually appear as computed lines
in owner statements / operator revenue. Track as a statement-math backlog item, not a
guest-checkout feature.

## Guiding principle

**Buy commodity capabilities; build only the owner-of-record core.**

Pricing, accounting, check-in, and payments are solved problems with mature vendors —
integrating them is cheaper and better than reimplementing them. The one thing no
vendor sells, and the one thing that makes this operator's owners stay, is a correct,
transparent **owner-statement / management-of-record** engine. That is where the
scarce native-build budget belongs.

## Recommended next 5, in order

1. **PriceLabs** — dynamic pricing (biggest revenue lever; near-trivial given the
   existing Channex rate-push path).
2. **Xero export** — push journal lines; keep native statement computation.
3. **Guest-comms automations + AI reply via Houzs Connect** — draft-only first.
4. **Self-check-in + foreign-guest registration** (Chekin/Enso) — legal/ops duty;
   reuse access-code reveal + WhatsApp delivery.
5. **Direct-booking + Stripe** — **last / optional**; a bonus 0%-commission channel,
   not a manager's table-stakes.
