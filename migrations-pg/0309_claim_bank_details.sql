-- REVERSAL: alter table scm.staff_receipts drop column payee_bank_name, drop column payee_account_no, drop column payee_account_name;
-- The bank a Direct Claim to Me is paid to (plan docs/superpowers/plans/2026-11-12-maintenance-claim-and-receipt-options.md;
-- chew, 12 Nov 2026: "他确认时可以更改，但不要碰我这里保存的银行记录"). A person who asks finance to pay a receipt back by
-- transfer confirms the bank on the claim itself: it is prefilled from their saved details (finance's
-- scm.staff_bank_details, else HR's public.conts_employee_bank) and can be changed there. The claim keeps what was
-- confirmed; the saved records are only read. The columns are null on a receipt paid from a float, and on every receipt
-- from before this migration (finance then pays to the saved details, as before).
--   scm.staff_receipts.payee_bank_name      the bank, from the Malaysian bank list
--   scm.staff_receipts.payee_account_no     digits only, 5 to 30
--   scm.staff_receipts.payee_account_name   the name on the account
-- The table's grants (all, to service_role and pos_app: 0178) cover the new columns.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0309, dry run first,
-- before the code merges (the engine writes these columns on a direct claim).
set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.staff_receipts
  add column if not exists payee_bank_name text,
  add column if not exists payee_account_no text,
  add column if not exists payee_account_name text;

notify pgrst, 'reload schema';
