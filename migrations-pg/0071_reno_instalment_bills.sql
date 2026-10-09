-- REVERSAL: DROP TABLE scm.reno_instalment_bills; DELETE FROM scm.acc_item_groups WHERE code = 'RENOVATION' AND NOT EXISTS (SELECT 1 FROM scm.acc_item_group_accounts WHERE group_code = 'RENOVATION');
-- Progress billing of a renovation contract. Each customer instalment is billed once, lowest number first:
-- amount = cumulative % x revised contract sum - already billed. A positive amount raises a sales invoice from the
-- sales order (the engine otherwise invoices only from delivery orders), a negative one a credit note to the
-- RENOVATION group's sales-return account, zero closes the instalment with no document. The row keeps the figures
-- the amount was worked from, so a later VO never rewrites history.
-- The RENOVATION item group is what renovation invoice and order lines carry; Accounting -> Item Groups binds it to
-- the sales / sales-return accounts before revenue can post.
create table scm.reno_instalment_bills (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null default 1,
  so_doc_no text not null references scm.mfg_sales_orders(doc_no) on delete cascade,
  instalment_id uuid not null unique references scm.reno_doc_instalments(id) on delete restrict,
  seq integer not null,
  kind text not null check (kind in ('INVOICE', 'CREDIT_NOTE', 'ZERO')),
  amount_sen integer not null,
  cum_bp integer not null,
  revised_contract_sen integer not null,
  billed_before_sen integer not null,
  invoice_date date not null,
  sales_invoice_id uuid references scm.sales_invoices(id) on delete set null,
  invoice_number text,
  credit_note_id uuid references scm.acc_credit_notes(id) on delete set null,
  note_number text,
  created_at timestamptz not null default now(),
  created_by text,
  check ((kind = 'INVOICE') = (amount_sen > 0)),
  check ((kind = 'CREDIT_NOTE') = (amount_sen < 0))
);
create index idx_reno_instalment_bills_so on scm.reno_instalment_bills (so_doc_no, seq);

alter table scm.reno_instalment_bills owner to scm_engine;
alter table scm.reno_instalment_bills enable row level security;
grant all on scm.reno_instalment_bills to pos_app, service_role;
revoke all on scm.reno_instalment_bills from anon, authenticated;

insert into scm.acc_item_groups (code, name) values ('RENOVATION', 'Renovation') on conflict (code) do nothing;
