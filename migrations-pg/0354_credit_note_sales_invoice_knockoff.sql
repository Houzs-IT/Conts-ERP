-- 0354_credit_note_sales_invoice_knockoff: a customer's credit note knocks off that customer's SALES INVOICES (ported
-- from Houzs ERP 20261108T1600; engine/backend/src/acc/credit-note-allocations.ts, credit-note-si.ts).
--
-- Until now scm.acc_credit_note_allocations named a purchase invoice or an AP invoice only (a supplier credit note's
-- knock-off), so a posted CN lowered the customer's control account but no invoice owed any less.
--
-- WHY A ROW AND NOT sales_invoices.paid_sen. The knock-off posts nothing: the note's own journal (Dr its lines / Cr the
-- customer's own debtors control, conts/parties resolveDebtorRoles) already carries the credit. The row says which
-- invoice the credit came off and how much (applied_sen); every reader of an invoice's outstanding subtracts it beside
-- the order's deposit (engine/backend/src/scm/lib/si-credit-notes.ts). paid_sen stays receipts only: the overpayment
-- rule and the receipt postings read it.
--
-- WHAT THIS CHANGES. One new nullable column (every existing row reads NULL), the one-target CHECK rewritten to allow
-- exactly one of the three targets (every existing row has exactly one of the two old ones, so it passes), one partial
-- index. No row is written or altered; no function, view or grant. ON DELETE RESTRICT, as for the invoice an AP
-- knock-off names: an invoice a credit came off keeps its record.
--
-- REVERSAL (revert the code first; take every knock-off off the sales invoices — untick on each customer note, or
-- cancel the note — or the old CHECK refuses to come back while an invoice row stands):
--   DROP INDEX IF EXISTS scm.idx_acc_cn_alloc_sales_invoice;
--   ALTER TABLE scm.acc_credit_note_allocations DROP CONSTRAINT IF EXISTS acc_credit_note_allocations_one_target;
--   ALTER TABLE scm.acc_credit_note_allocations ADD CONSTRAINT acc_credit_note_allocations_one_target
--     CHECK ((purchase_invoice_id IS NULL) <> (ap_invoice_id IS NULL));
--   ALTER TABLE scm.acc_credit_note_allocations DROP COLUMN IF EXISTS sales_invoice_id;
--   GRANTS: none — a column on an existing table rides that table's grants.

SET search_path = public, scm;

ALTER TABLE scm.acc_credit_note_allocations
  ADD COLUMN IF NOT EXISTS sales_invoice_id uuid
    REFERENCES scm.sales_invoices (id) ON DELETE RESTRICT;

ALTER TABLE scm.acc_credit_note_allocations DROP CONSTRAINT IF EXISTS acc_credit_note_allocations_one_target;
ALTER TABLE scm.acc_credit_note_allocations ADD CONSTRAINT acc_credit_note_allocations_one_target
  CHECK (num_nonnulls(purchase_invoice_id, ap_invoice_id, sales_invoice_id) = 1);

CREATE INDEX IF NOT EXISTS idx_acc_cn_alloc_sales_invoice
  ON scm.acc_credit_note_allocations (sales_invoice_id)
  WHERE sales_invoice_id IS NOT NULL;
