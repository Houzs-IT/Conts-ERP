-- 0372_reno_commission: sales commission on renovation contracts (owner, 25 Nov 2026).
--
-- 1. scm.reno_commission_schemes: one per brand (branding as on the sales order; null = every brand without its own).
--    A sales manager with a manager rate; the salesperson's rate by tier of their sales in the month
--    (tiers: [{ fromSen, bp }]); the manager earns the manager rate less it. company_pool_bp is kept aside, never paid
--    to a person. stages: when the commission is released, as [{ label, kind: 'collected' | 'instalment', value,
--    releaseBp }] (scm/shared/renovation-commission.ts).
-- 2. scm.reno_commission_payouts: commission paid to a person on one order. Taken back (voided), never deleted.
-- The figures themselves are worked out on each read from the contract, its VOs and the money collected.
--
-- REVERSAL:
--   drop table if exists scm.reno_commission_payouts;
--   drop table if exists scm.reno_commission_schemes;

set local lock_timeout = '5s';

create table if not exists scm.reno_commission_schemes (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null default 1,
  name text not null,
  branding text,
  manager_staff_id uuid references scm.staff(id),
  manager_bp integer not null default 400 check (manager_bp between 0 and 10000),
  company_pool_bp integer not null default 0 check (company_pool_bp between 0 and 10000),
  tiers jsonb not null default '[]'::jsonb,
  stages jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_reno_commission_schemes_brand
  on scm.reno_commission_schemes (company_id, coalesce(branding, '')) where active;

create table if not exists scm.reno_commission_payouts (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null default 1,
  so_doc_no text not null references scm.mfg_sales_orders(doc_no),
  staff_id uuid not null references scm.staff(id),
  amount_sen bigint not null check (amount_sen > 0),
  paid_on date not null,
  note text not null default '',
  created_by text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by text
);
create index if not exists idx_reno_commission_payouts_so on scm.reno_commission_payouts (so_doc_no) where voided_at is null;
create index if not exists idx_reno_commission_payouts_staff on scm.reno_commission_payouts (staff_id) where voided_at is null;

do $$ declare t text; begin
  foreach t in array array['reno_commission_schemes', 'reno_commission_payouts'] loop
    execute format('alter table scm.%I owner to scm_engine', t);
    execute format('alter table scm.%I enable row level security', t);
    execute format('grant all on scm.%I to pos_app, service_role', t);
    execute format('revoke all on scm.%I from anon, authenticated', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
