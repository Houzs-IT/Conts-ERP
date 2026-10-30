-- REVERSAL: alter table scm.reno_so_contracts drop column golive_cost_sen;
-- Cost before go-live for renovation contracts signed before the ledger start (finance, chew 31 Oct 2026: "可以给，我 auto
-- count 有份 project 记录开销的"; plan docs/superpowers/plans/2026-10-31-renovation-completion-dashboard.md Task 4).
--   scm.reno_so_contracts.golive_cost_sen  what AutoCount's project expense record shows spent on the contract up to the
--                                          ledger start. The completion % (acc/reno-completion) adds it to the cost
--                                          booked since. Null = not given: such a contract is flagged on the screens.
-- Numbered 0188: 0187 (einvoice_ready) is the last on production and on every branch.
-- APPLY: by hand, to production before the code merges, in one transaction with its public.pos_migrations row.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.reno_so_contracts add column if not exists golive_cost_sen bigint;

notify pgrst, 'reload schema';
