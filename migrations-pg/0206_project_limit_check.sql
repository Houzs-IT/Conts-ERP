-- REVERSAL: alter table scm.acc_company_settings drop column project_limit_check;
-- The project limit can be switched off (SOP 3.4, chew 4 Nov 2026). Customer payments are not all in the system yet,
-- so every customer project's limit is nothing and every voucher naming one is refused. Off: nothing is refused or
-- flagged over its limit; the limit left still shows, for reference. Finance switches it on again, and keeps the
-- company's share (project_limit_pct_bp), on Ledger setup.
-- APPLY: by hand, in one transaction with its public.pos_migrations row, after 0205.
set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.acc_company_settings add column if not exists project_limit_check boolean not null default true;
