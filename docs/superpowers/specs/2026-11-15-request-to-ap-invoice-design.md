# Payment request → AP invoice, quotations booked first, balance requests (design)

chew, 15 Nov 2026. Finance SOP 3.2, 3.5, 3.8.

## Why

A payment request to a supplier is paid today by **Make voucher**: the voucher debits the supplier's AP control and
credits the bank, with no bill behind it. The expense is never booked unless finance types the bill again on AP
invoices and then knocks it off on the voucher by hand. The supplier's account sits in debit meanwhile.

From now on a request can become an AP invoice: the bill books the expense and the payable, and the voucher that pays
it (made on the Payment voucher page) knocks it off.

## Decisions (chew, 15 Nov 2026)

1. **Optional.** A request may still be paid by Make voucher as before. Once a request has an AP invoice, it is paid on
   the **Payment voucher page** (pick the supplier, tick the AP invoice), not from the request.
2. **Deposits too.** Work quoted first, a deposit paid, the balance paid when the formal invoice comes.
3. **AP invoice lines keep the unit.** `ap_invoice_lines.unit_id`.
4. **Utility requests too.** A utility request made out to a creditor (TNB…) otherwise books no expense. The 50-line
   limit is lifted for an AP invoice made from a request (up to 500, as a utility request).
5. **A quotation is booked first** (入账先): an AP invoice ticked **Quotation (no formal invoice yet)** is posted like any
   bill. When the formal invoice comes, the same bill is changed to match it (**Replace with formal invoice**): the
   engine reverses the old entry and books the bill as it now reads. The date defaults to the formal invoice's date.
6. **The formal invoice may be more or less.** The AP invoice is what is owed; a request linked to it follows it.
7. **The balance is asked from the deposit request**, with nothing filled in again: **Ask for the balance** on My
   claims makes a balance request with the supplier, lines, projects and units, linked to the deposit request and to
   its AP invoice. The formal invoice may be attached or not.
8. **The request follows the AP invoice automatically**: description, amount, project, unit, and lines added or taken
   off. What was first asked is kept (`asked_lines`, `asked_amount_sen`) and shown as **As first asked**.
9. While a request has a live AP invoice it cannot be withdrawn, rejected or sent again: change the AP invoice, or
   cancel it first.

## Data (migration 0329)

- `scm.payment_requests`
  - `ap_invoice_id uuid` → `scm.ap_invoices`: the bill this request is paid through (several requests may share one:
    a deposit and its balance).
  - `ap_paid_before_sen bigint not null default 0`: what the bill had paid when this request was linked. What the bill
    pays beyond it is this request's.
  - `parent_request_id uuid` → `scm.payment_requests`: a balance request's deposit request.
  - `asked_lines jsonb`, `asked_amount_sen bigint`: the request as first asked, saved the first time the bill changes it.
- `scm.ap_invoices`
  - `payment_request_id uuid` → `scm.payment_requests`: the request the bill was made from (unique while not
    cancelled: one bill per request).
  - `provisional boolean not null default false`: a quotation, no formal invoice yet (SOP 3.8's list).
- `scm.ap_invoice_lines`
  - `unit_id text`, `source_request_line_id uuid`.

## Engine

- `POST /accounting/payment-requests/:id/ap-invoice { debitAccountCode, provisional? }` (raise AP invoices): a DRAFT
  bill from the request: supplier, `wanted_on` as due date, each line (description, amount, department,
  sub-department, project, unit; the line's own account, else the one given), the request's files copied. Only while
  the request is open with no live voucher (a PAYMENT), or once a DEPOSIT is open or paid; the payee must be a listed
  supplier. A DEPOSIT's bill starts as a quotation. The request takes `ap_invoice_id` only if it has none (a second
  click loses and its draft goes).
- AP invoice create/edit takes `provisional`, and per line `unitId` and `sourceRequestLineId`. Saving a bill made from
  a PAYMENT request rewrites that request's lines and amount from the bill (decision 8). A DEPOSIT request is not
  rewritten: it stays the deposit.
- AP invoice cancel lets go of every request linked to it (`ap_invoice_id` null) and settles them again from their own
  vouchers.
- **Request status** of a linked request, from the bill's `paid_sen` (`paidForMe = paid_sen − ap_paid_before_sen`):
  - a DEPOSIT: by its own amount, as before (counting its own posted vouchers too);
  - otherwise: PAID when the bill is PAID; PART_PAID when `paidForMe > 0`; else SUBMITTED.
  Settled again whenever the bill's `paid_sen` can move: a voucher allocating to it posts or is cancelled, an advance
  is applied, the bill is edited or cancelled.
- **Project limit:** a linked request still unpaid reserves its lines in proportion to what it has not had paid yet.
  (A submitted voucher paying the bill also reserves until it posts: for that moment the limit is counted
  conservatively.)
- **Balance:** `POST /requests/:id/balance { files?, note? }` (the requester, on their own DEPOSIT request that is paid
  or part paid and has a live AP invoice): a PAYMENT request for what the bill still owes, lines spread from the bill's
  lines in proportion, `parent_request_id` and `ap_invoice_id` set, `ap_paid_before_sen` = the bill's paid now. One
  open balance request per deposit.
- Guards: withdraw, reject, resubmit (My claims and Utility bills) and Make voucher refuse a request with a live AP
  invoice.

## Screens

- Engine **Payment requests**: **Make AP invoice** (asks the expense account for lines that have none), the AP invoice
  number as a link, no Make voucher / Reject once linked.
- Engine **AP invoice form**: **Quotation (no formal invoice yet)** tick, a Unit column, "From PRQ-…", and on a posted
  quotation **Replace with formal invoice** (unticks Quotation, focuses the invoice number and date).
- Property OS **My claims**: **Ask for the balance** on a paid deposit request; "Updated from the invoice" and
  **As first asked** on a request the bill changed; the AP invoice number.

## Not in this cut

- Splitting one quotation into several separate bills (several formal invoices are recorded on the same bill).
- Moving a reversal out of a locked month (the engine refuses as it does for any bill; finance books the difference
  in an open month).
