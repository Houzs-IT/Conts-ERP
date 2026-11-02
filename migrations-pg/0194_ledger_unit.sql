-- REVERSAL: alter table scm.journal_entry_lines remove the unit_id column and its index.
-- The Rental unit on a ledger line (finance, chew 2 Nov 2026; SOP 3.2; plan
-- docs/superpowers/plans/2026-11-02-voucher-purpose-unit-project-pickers.md Task 1).
--   scm.journal_entry_lines.unit_id  the Property OS unit (public.conts_units.id) a Rental expense was paid for. A
--                                    payment voucher line's unit_id is carried here when it posts; the Rental costs
--                                    by unit report reads it. Finance only: never charged to the owner.
-- Numbered 0194: 0193 (scm_job_progress_pod) is on main; 0192 is the last on production.
-- APPLY: by hand, to production before the code merges, in one transaction with its public.pos_migrations row.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.journal_entry_lines add column if not exists unit_id text;
create index if not exists idx_jel_unit on scm.journal_entry_lines (company_id, unit_id) where unit_id is not null;

notify pgrst, 'reload schema';
