-- REVERSAL: alter table public.projects drop column finance_kind; alter table public.project_brands drop column finance_kind;
-- Which customer control a renovation contract's customer is opened under (finance phase 1.5, 24 Oct 2026; SOP 2.1):
-- a renovation → 301-0000, an inhouse renovation → 302-0000 (scm.acc_debtor_control_map, 0159). The kind follows the
-- quotation's brand — The Conts is inhouse renovation, Dream Crafter is renovation (chew, 24 Oct 2026) — unless the
-- project names its own. projects.finance_kind null = follow the brand.
-- APPLY: by hand, to production before the code merges (no staging: finance, 21 Oct 2026); one transaction with its
--   public.pos_migrations row, as scripts/migrate-pg.mjs writes it.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table public.project_brands
  add column finance_kind text check (finance_kind is null or finance_kind in ('RENOVATION', 'INHOUSE_RENOVATION'));
alter table public.projects
  add column finance_kind text check (finance_kind is null or finance_kind in ('RENOVATION', 'INHOUSE_RENOVATION'));

update public.project_brands set finance_kind = 'INHOUSE_RENOVATION' where company_id = 1 and upper(btrim(name)) = 'THE CONTS';
update public.project_brands set finance_kind = 'RENOVATION' where company_id = 1 and upper(btrim(name)) = 'DREAM CRAFTER';

notify pgrst, 'reload schema';
