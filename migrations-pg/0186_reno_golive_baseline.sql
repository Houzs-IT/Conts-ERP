-- REVERSAL: alter table scm.reno_so_contracts drop column golive_contract_sen;
-- Renovation contracts signed before the ledger start, seeded at go-live (finance, chew 30 Oct 2026; spec
-- docs/superpowers/specs/2026-10-30-renovation-revenue-einvoice-design.md 7.3; plan 2026-10-30-renovation-revenue-ledger.md
-- Task 8). The opening balances carry such a contract's receivable and advance, so nothing re-posts it; this records what
-- the contract stood at when finance seeded it, so a VO after go-live posts only its difference (RVO).
--   scm.reno_so_contracts.golive_contract_sen  the contract amount the opening balances carry (its live SO rows without
--                                              RENO-CREDIT rows, at the seeding). Null = not seeded: a contract signed
--                                              before the ledger start then posts nothing, as before.
-- Numbered 0186: 0185 (renovation_contract_ledger, dc_staff) is the last on production and on every branch.
-- APPLY: by hand, to production before the code merges, in one transaction with its public.pos_migrations row.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.reno_so_contracts add column if not exists golive_contract_sen bigint;

notify pgrst, 'reload schema';
