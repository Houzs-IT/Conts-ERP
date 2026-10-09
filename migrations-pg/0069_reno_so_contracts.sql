-- REVERSAL: DROP TABLE scm.reno_so_contracts; DROP INDEX scm.uq_mfg_so_reno_project; ALTER TABLE scm.mfg_sales_orders DROP COLUMN so_kind;
-- A renovation sales order is the contract of one project. so_kind tells it apart from a furniture order so the
-- allocator, MRP and delivery sync leave it alone (its statuses are terminal for them, see so-terminal-states.ts)
-- and the generic sales-order write routes refuse it (renovation-write-fence.ts). One live renovation SO per project.
-- reno_so_contracts carries the contract header the furniture order has no column for: the source quotation, brand,
-- print header, document discount, promotion lines and the original contract sum (VOs move the revised sum).
alter table scm.mfg_sales_orders
  add column so_kind text not null default 'STANDARD' check (so_kind in ('STANDARD', 'RENOVATION'));

create unique index uq_mfg_so_reno_project on scm.mfg_sales_orders (project_id)
  where so_kind = 'RENOVATION' and status <> 'CANCELLED';

create table scm.reno_so_contracts (
  so_doc_no text primary key references scm.mfg_sales_orders(doc_no) on delete cascade,
  company_id bigint not null default 1,
  project_id bigint not null references public.projects(id) on delete restrict,
  quotation_id uuid references scm.reno_quotations(id) on delete set null,
  quotation_revision_id uuid references scm.reno_quotation_revisions(id) on delete set null,
  quote_doc_no text,
  brand_id bigint references public.project_brands(id) on delete set null,
  print_format text not null default 'AMOUNT' check (print_format in ('AMOUNT', 'UNIT_PRICE', 'DISCOUNT', 'QTY_ONLY', 'PROMO_STANDARD')),
  attention text not null default '',
  customer_name text not null default '',
  building text not null default '',
  unit_no text not null default '',
  prepared_by text not null default '',
  doc_date date not null default current_date,
  last_amended date,
  intro text,
  terms_note text not null default '',
  doc_discount_sen integer not null default 0 check (doc_discount_sen >= 0),
  doc_discount_label text not null default '',
  promo_lines jsonb not null default '[]'::jsonb,
  discount_so_item_id uuid references scm.mfg_sales_order_items(id) on delete set null,
  original_contract_sen integer not null,
  term_template_id uuid references scm.reno_term_templates(id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now()
);
create index idx_reno_so_contracts_project on scm.reno_so_contracts (project_id);

alter table scm.reno_so_contracts owner to scm_engine;
alter table scm.reno_so_contracts enable row level security;
grant all on scm.reno_so_contracts to pos_app, service_role;
revoke all on scm.reno_so_contracts from anon, authenticated;
