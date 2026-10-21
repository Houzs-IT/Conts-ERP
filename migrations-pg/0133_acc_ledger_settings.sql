-- REVERSAL: alter table scm.acc_company_settings drop column if exists ledger_start_date, drop column if exists fiscal_year_end_month;
-- Ledger settings for the Conts books in the engine (finance, 21 Oct 2026; docs/superpowers/specs/2026-10-20-finance-phase1-ledger-design.md 3.7, 3.8):
--  * ledger_start_date: the day the books start in the engine. Everything dated before it is already in the AutoCount
--    opening balances, so the engine posts and reverses nothing dated before it (only the OPENING journal is). Null =
--    no start set, posting as before.
--  * fiscal_year_end_month: the month the fiscal year ends; Conts is FYE August (8).
-- The table's grants are already in place (0044, 0047).
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).

set local search_path = scm, public, extensions;

alter table scm.acc_company_settings
  add column if not exists ledger_start_date date,
  add column if not exists fiscal_year_end_month smallint not null default 8 check (fiscal_year_end_month between 1 and 12);
