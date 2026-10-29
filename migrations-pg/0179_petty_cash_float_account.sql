-- REVERSAL: drop index scm.petty_cash_floats_account_active; alter table scm.petty_cash_floats drop column account_code;
-- Each department's petty cash float books to its own account in the chart (finance, chew 29 Oct 2026; SOP 6): the
-- chart already keeps one cash-in-hand account per float, named after its keeper (e.g. 315-0101 PETTY CASH - AMIN for
-- Maintenance). A receipt paid from a float credits that account; a top-up debits it. Until a float has its account,
-- its receipts wait unbooked. This replaces the single petty cash rule (PETTY_CASH) of 0178.
--   scm.petty_cash_floats.account_code   the float's account; one active float per account
-- APPLY: by hand, to production before the code merges, in one transaction with its public.pos_migrations row.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.petty_cash_floats add column if not exists account_code text;
create unique index if not exists petty_cash_floats_account_active on scm.petty_cash_floats (company_id, account_code) where active and account_code is not null;
