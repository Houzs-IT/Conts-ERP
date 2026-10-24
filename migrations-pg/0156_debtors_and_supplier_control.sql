-- REVERSAL: drop table scm.debtors; alter table scm.suppliers drop column if exists control_account;
-- Customers and suppliers under their control (finance, 22-24 Oct 2026; docs/superpowers/specs/
-- 2026-10-23-finance-debtors-contracts-design.md section 2; SOP 2.1):
--  * scm.debtors: one row per customer, coded like AutoCount (control prefix + letter + running number, e.g.
--    301-M001) and bound to the control account the ledger posts its receivables to (301-0000 renovation,
--    302-0000 inhouse renovation, 303-0000 rental). AutoCount keeps each customer as a sub-account of its control;
--    here the control is the only account and the customer is named on the line, so a control never has children.
--    customer_id links the order-side customer (scm.customers) the row was opened for, when there is one.
--  * scm.suppliers.control_account: the payables control of a supplier; empty keeps today's rule (a 405- code posts
--    to 405-0000, any other to 400-0000).
-- APPLY: by hand, to production before the code merges (no staging: finance, 21 Oct 2026); one transaction with its
--   public.pos_migrations row, as scripts/migrate-pg.mjs writes it.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

create table scm.debtors (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id),
  code text not null,
  name text not null,
  control_account text not null,
  customer_id uuid references scm.customers(id) on delete set null,
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint debtors_code_check check (code ~ '^[0-9]{3}-[A-Za-z0-9]+$'),
  constraint debtors_name_check check (length(btrim(name)) > 0)
);
create unique index debtors_company_code_uq on scm.debtors (company_id, code);
create index debtors_control_idx on scm.debtors (company_id, control_account);
create index debtors_customer_idx on scm.debtors (company_id, customer_id) where customer_id is not null;

alter table scm.debtors owner to scm_engine;
alter table scm.debtors enable row level security;
revoke all on scm.debtors from anon, authenticated;

alter table scm.suppliers add column if not exists control_account text;

-- PostgREST reads the new table and column only after its schema cache reloads.
notify pgrst, 'reload schema';
