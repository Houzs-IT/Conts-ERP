-- REVERSAL: alter table scm.payment_request_lines drop column bill_date;
-- The date a utility bill's expense belongs to (chew, 16 Nov 2026: "记费用时是要根据账单的 period，而不是我实际付款的
-- 日子"): the end of the bill's printed period, else its bill date as entered. A utility payment request's line keeps it;
-- when finance's voucher pays the request, the engine books the expense against the accrual on that date
-- (Dr 650-00xx / Cr 420-00xx, conts/utility-accrual.ts), whatever day the payment was made.
--   scm.payment_request_lines.bill_date   null on every other request line
-- The table's grants cover the new column.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0331, dry run first,
-- before the code merges (the engine writes this column).
set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.payment_request_lines add column if not exists bill_date date;

notify pgrst, 'reload schema';
