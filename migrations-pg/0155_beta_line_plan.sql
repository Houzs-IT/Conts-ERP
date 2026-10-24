-- REVERSAL: drop table scm.reno_beta_line_plans;
-- Beta project PO tab as the line manager (owner, 24 Oct 2026): per sales order line, the processing date (when to
-- place the order), the delivery date while no PO holds the line, and whether the line needs a PO at all. Once a PO
-- holds the line its delivery date is the PO line's, changed on the PO (the existing PO update path); the processing
-- date stays here. One row per SO line, made the first time a date or the PO choice is set.
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
-- Until it is applied the PO tab shows the lines without planned dates and refuses to save one.
set local search_path = scm, public, extensions;

create table scm.reno_beta_line_plans (
  so_item_id uuid primary key references scm.mfg_sales_order_items(id) on delete cascade,
  company_id bigint not null references public.companies(id),
  order_on date,
  deliver_on date,
  no_po boolean not null default false,
  updated_by bigint,
  updated_at timestamptz not null default now()
);
create index reno_beta_line_plans_company_idx on scm.reno_beta_line_plans (company_id);
alter table scm.reno_beta_line_plans owner to scm_engine;
alter table scm.reno_beta_line_plans enable row level security;
