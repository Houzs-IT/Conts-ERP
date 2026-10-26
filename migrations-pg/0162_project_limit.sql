-- REVERSAL: drop table scm.project_limit_requests; alter table public.projects drop column funding, drop column limit_pct_bp, drop column budget_sen, drop column internal_department; alter table scm.acc_company_settings drop column project_limit_pct_bp; alter table scm.accounts drop column everyday_expense;
-- The project limit (finance phase 1.5; SOP 3.4, chew 20-25 Oct 2026). A payment voucher for a project must stay within
-- its limit: a customer project may spend up to a share (default 70%) of what the customer has paid; an internal
-- project (the company's own money: a Master-lease unit to rent out, the showroom) spends against a budget. Over the
-- limit, a voucher cannot be submitted; extra limit is asked for and approved by someone else.
--   public.projects.funding           'customer' (sold to a customer) or 'internal' (the company's own money)
--   public.projects.limit_pct_bp      the project's own share, in basis points (null: the company's)
--   public.projects.budget_sen        an internal project's budget
--   public.projects.internal_department  which department an internal project counts to: rental or supply
--   scm.acc_company_settings.project_limit_pct_bp   the company's share, default 7000 (70%)
--   scm.accounts.everyday_expense     rent, utilities and the like: paid as usual, outside a project's budget
--   scm.project_limit_requests        extra limit asked for and its answer
-- APPLY: by hand, to production before the code merges (no staging: finance, 21 Oct 2026); one transaction with its
--   public.pos_migrations row, as scripts/migrate-pg.mjs writes it.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table public.projects
  add column if not exists funding text not null default 'customer' check (funding in ('customer', 'internal')),
  add column if not exists limit_pct_bp integer check (limit_pct_bp is null or limit_pct_bp between 0 and 10000),
  add column if not exists budget_sen bigint check (budget_sen is null or budget_sen >= 0),
  add column if not exists internal_department text check (internal_department is null or internal_department in ('rental', 'supply'));

alter table scm.acc_company_settings
  add column if not exists project_limit_pct_bp integer not null default 7000 check (project_limit_pct_bp between 0 and 10000);

alter table scm.accounts add column if not exists everyday_expense boolean not null default false;

create table scm.project_limit_requests (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id),
  project_id bigint not null references public.projects(id),
  kind text not null check (kind in ('amount', 'pct', 'budget')),
  amount_sen bigint check (amount_sen is null or amount_sen > 0),
  pct_bp integer check (pct_bp is null or pct_bp between 0 and 10000),
  reason text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  requested_by text not null,
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index project_limit_requests_project_idx on scm.project_limit_requests (company_id, project_id);
alter table scm.project_limit_requests owner to scm_engine;
alter table scm.project_limit_requests enable row level security;
revoke all on scm.project_limit_requests from anon, authenticated;
-- The engine reaches it through the Supabase REST client (service_role).
grant all on scm.project_limit_requests to service_role, pos_app;

notify pgrst, 'reload schema';
