-- REVERSAL: alter table scm.purchase_invoice_items drop column if exists account_code;
-- A purchase invoice line keyed by account (chew, 18 Nov 2026: stock codes are not complete yet, so a line may name the
-- purchase account instead of an item). Posting debits this account; a line without one still books by its stock group's
-- purchase account (Item group accounts). No FK, like the bindings: the API checks the account against the chart.
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0339, dry run first.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.purchase_invoice_items add column if not exists account_code text;

notify pgrst, 'reload schema';
