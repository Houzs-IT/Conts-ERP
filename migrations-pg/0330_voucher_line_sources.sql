-- REVERSAL: drop index scm.payment_voucher_lines_payment_request; drop index scm.payment_voucher_lines_staff_receipt;
--   alter table scm.payment_voucher_lines drop column payment_request_id, drop column staff_receipt_id;
-- One payment voucher for several payment requests and staff claims (chew, 16 Nov 2026: tick several, "combine 几个
-- payment request 去一张 voucher"; a person's claims handed in separately, paid back at once). Each voucher line names
-- the request or the claim it pays, so each settles by its own lines when the voucher posts or is cancelled. A voucher
-- for one request (or one claim) still names it on the voucher too (payment_vouchers.payment_request_id /
-- staff_receipt_id, 0178), as before.
--   scm.payment_voucher_lines.payment_request_id   the payment request this line pays
--   scm.payment_voucher_lines.staff_receipt_id     the staff claim (receipt) this line pays back
-- The table's grants cover the new columns.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0330, dry run first,
-- before the code merges (the engine reads and writes these columns).
set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.payment_voucher_lines
  add column if not exists payment_request_id uuid references scm.payment_requests(id),
  add column if not exists staff_receipt_id uuid references scm.staff_receipts(id);
create index if not exists payment_voucher_lines_payment_request on scm.payment_voucher_lines (payment_request_id) where payment_request_id is not null;
create index if not exists payment_voucher_lines_staff_receipt on scm.payment_voucher_lines (staff_receipt_id) where staff_receipt_id is not null;

notify pgrst, 'reload schema';
