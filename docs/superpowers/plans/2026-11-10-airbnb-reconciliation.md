# Airbnb reconciliation — build plan (10 Nov 2026)

Source: chew's spec `airbnb-reconciliation-spec.md` (10 Nov 2026) and chew's answers the same day. The page is
Finance > **Airbnb reconciliation**. This is Airbnb paying the company, not the payout to owners.

## Decisions (chew, 10 Nov 2026)

- Upload one or more Airbnb transaction CSVs for a month. The same transaction is never recorded twice. The key is
  Date + Type + Confirmation code + Amount + Paid out + Reference code.
- Match by Confirmation code = `reservations.external_ref` across ALL Airbnb bookings, not only the month's. One code
  can cover several units, so its bookings are added together.
- System net = `gross_booking_value − channel_fee`, which is what the owner statement uses from Oct 2026
  (`ownerStatement.ts`). It is compared with the CSV `Amount`; under RM 0.05 counts as equal.
- Rules, the first that fits wins:
  - R1 equal.
  - R2 the extra charge is inside the booking. **Split it**: the booking keeps the room, the extra goes to company income.
  - R3 cancelled and fully refunded.
  - R4 money won back. The booking is reservation + adjustment; the resolution payout goes to company income.
  - R5 equal after the adjustment.
  - R6 long stay (28+ nights). Compare the whole booking. Only "not fully paid yet" when Airbnb really paid part.
  - R7 extend paid in parts: set the booking to Airbnb's total. "Likely" when the system equals the first payment.
  - R8 extended before check-in: set it to Airbnb's amount.
  - Not in the system:
    - R9: the stay started before the month; label it as last month's.
    - R11: the stay is not over; check the system.
    - R10: cancelled but still paid; company income, confirm each.
  - R12 in the system, not paid in these files.
  - R99 unknown.
- Company income is kept apart by kind, never on an owner statement:
  - extra charge (e.g. airport pickup);
  - money won back;
  - cancelled but paid;
  - AirCover reimbursement.

  Who gets each kind is a setting. Default company.
- A month whose owner statement is final gets the difference next month: an `owner_adjustments` row dated in the
  next open month.
- Access: a new area `airbnbRecon`, closed for every department until chew grants it. Management always has it.
- Only flag. Every change waits for finance to press Confirm, which records who, when, the action and a note.

## Step 1 — upload, match, classify, look (no data changed)

1. Migration 0258:
   - `airbnb_recon_files`, `airbnb_transactions` (unique dedupe key), `airbnb_recon_decisions` and
     `airbnb_company_income`, so one migration run covers both steps.
   - Access rules `none` for every department.
   - `demo.sync()`.
2. `functions/_lib/airbnbCsv.ts`: rows parsed in the browser (`src/lib/sheets.ts` `csvObjects`) → transactions.
   Dates MM/DD/YYYY become ISO; amounts become sen; plus the dedupe key.
3. `functions/_lib/airbnbRecon.ts`: group by code and classify (pure). Tests use the spec's 11 October bookings.
4. API:
   - `POST /api/airbnb-recon/upload {month, files:[{name, rows}]}`;
   - `GET /api/airbnb-recon?month=YYYY-MM` returns summary, bookings with rule and suggestion, company income by
     kind, and bank transfers.
5. `access.ts` area, RBAC matrix rows and `access.test.mjs`.
6. Page `src/pages/finance/AirbnbReconPage.tsx`, from the agreed mockup:
   - header, upload, figures;
   - tabs: Needs confirming, All bookings, Company income, Bank transfers;
   - Excel export (`src/lib/export.ts`).
   - Finance menu entry.
7. Verify with October's two CSVs.

### As built (11 Nov 2026)

- A reservation is compared whole: every uploaded line for its code, in any month, against the system. A line belongs
  to the month of its own Date; the month's page shows every code with a line dated in it.
- Two identical lines in one file are both kept (the second keyed "#2"); a line in two files of one upload, or
  uploaded before, is recorded once.
- R13 "Paid before these files": a code with no Reservation line in any uploaded file, only AirCover, resolution or
  refund lines. The spec has no rule for it; October had 14. AirCover and resolution money are company income; a
  refund is looked at by hand. chew, 11 Nov 2026: "可以，标 R13".
- Airbnb paid the system's amount, then took part back for the guest: R99, finance decides each one with the amount
  after the refund shown (chew, 11 Nov 2026: "每笔自己看"; October had 6).
- "Difference" on screen is system − what Airbnb kept (Reservation lines + adjustments). The spec's 差额 leaves the
  adjustments out, which showed 0.00 beside a refund. The rules use both figures as the spec says.
- "To confirm" is every line with something to write (an amount, a cancellation, company income), something to look
  at, or R5 (the spec's "confirm only"). R1 with no company income, R6 and R12 wait.
- October check (both CSVs against production): 883 lines, 723 reservations, 625 equal, 81 to confirm. Bank
  transfers RM 477,155.02 equal the month's coded lines. Company income RM 8,805.71.

## Step 2 — confirm and write

8. Confirm per booking: record the decision and apply it.
   - Booking amount: `gross_booking_value` so the statement follows.
   - Cancel: state `cancelled`.
   - Company income rows.
   - Next-month owner adjustment when the month is final.
9. The "who gets the money" setting.
10. Owner statements never show company income. It sits in its own table, so nothing to subtract.

### Decisions (chew, 11 Nov 2026)

- A confirm window, not ticks: it lists what changes (the reservation, the owner statement, the company income) and
  has two buttons, Keep as it is and Confirm. Each company income line has a type to choose.
- Income types, kept by finance on the page: Additional charge (sub-types Early check-in / late checkout, Pickup,
  Others), Compensation, AirCover, Recovered from Airbnb (not "money won back"), Cancelled but paid. Any type can be
  renamed or made inactive, never deleted; an inactive type is left for finance to choose. Words in Airbnb's Details
  pick a type ("reconciliation 认的字眼"); chew sends new ones as they come.
- Six defaults chew agreed:
  1. A new amount moves the guest total (`gross_booking_value`) so the net is Airbnb's; Airbnb's fee stays.
  2. A month whose owner statement is already final: the owner's share by contract goes on the next open month's
     statement as an open owner adjustment (source `airbnb_recon`). Fixed rent, master lease and long-term let get
     nothing (their income does not follow the stay).
  3. Undo while the statements it touched are open.
  4. Confirming needs edit access to Airbnb reconciliation; changing the income types needs full access.
  5. Lines that only record company income are confirmed together; R10 and anything that changes a reservation one
     by one.
  6. All company income is the company's; no setting page for now.

### As built (11 Nov 2026)

- Migration 0259: `airbnb_income_types` (two levels, `system_key` for the four the rules pick, `match_words`,
  `active`), company income by `type_id` / `sub_type_id` and the `decision_id` that wrote it (ON DELETE CASCADE),
  `owner_adjustments.source` may be `airbnb_recon`. The page only shows until it runs.
- `functions/_lib/airbnbConfirm.ts` (pure, tested in `src/lib/airbnbConfirm.test.mjs`): the plan for a line —
  reservations to change (a code over several units shares the new net by their nets now), the owner's share for
  final months (by nights, from Oct 2026 only, as earlier statements read collected revenue), the open month it goes
  on — and why an undo is refused.
- `POST /api/airbnb-recon/decisions` plans again from fresh figures and writes everything in one transaction:
  the decision with what it wrote (`applied`), the reservation updates (only from the figures planned on, else the
  whole confirmation stops), the company income rows, the owner adjustments, the audit rows.
- `POST /api/airbnb-recon/undo` puts the reservations back, removes the owner adjustments and the decision (its
  company income goes with it). Refused when the reservation changed since, a statement that has the change is final
  now, or the owner adjustment is on a final statement, held or settled.
- Refused when confirming: cancelling a stay still to come (cancel it on the reservation, so its nights open again),
  cancelling a stay with nights before Oct 2026, setting an amount of RM 0.00 or less.
- A line to check whose reservation Airbnb paid in these files (R99) offers Airbnb's figure in the window: leave the
  reservation, or set it to what Airbnb kept (chew on the refund-after-payment cases: "每笔自己看").
- Not handled: a share contract with a minimum guarantee whose minimum was paid that month (the window says to check
  by hand); Channex may later overwrite a corrected guest total if Airbnb sends a change to that reservation.
- `scripts/api-checks/airbnb-recon.mjs` (in CI) covers confirm, together, keep, undo, the final-statement refusal and
  the income types.
