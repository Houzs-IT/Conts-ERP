-- REVERSAL: ALTER TABLE scm.reno_doc_lines DROP CONSTRAINT reno_doc_lines_vo_fk, DROP CONSTRAINT reno_doc_lines_omitted_by_vo_fk;
--           ALTER TABLE scm.reno_doc_sections DROP CONSTRAINT reno_doc_sections_vo_fk;
--           DROP TABLE scm.reno_po_line_flags, scm.reno_variation_orders;
-- Variation orders: numbered VO-<SO no>-NN, add and omit lines, printed for the customer's signature. Approving one
-- appends its add lines to the contract (tagged with the VO), reduces or cancels the omitted lines, records an
-- so_amendments row (resolution RENOVATION_VO) so the engine's amendment history and audit stay whole, and flags the
-- purchase-order lines that bought the omitted work so procurement amends or cancels them (reno_po_line_flags).
create table scm.reno_variation_orders (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null default 1,
  vo_no text not null unique,
  so_doc_no text not null references scm.mfg_sales_orders(doc_no) on delete cascade,
  seq integer not null check (seq > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SENT', 'APPROVED', 'CANCELLED')),
  title text not null default '',
  doc_date date not null default current_date,
  net_sen integer not null default 0,
  amendment_id uuid references scm.so_amendments(id) on delete set null,
  signed_name text,
  signed_at timestamptz,
  approved_at timestamptz,
  approved_by text,
  cancelled_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  unique (so_doc_no, seq)
);

alter table scm.reno_doc_sections add constraint reno_doc_sections_vo_fk foreign key (vo_id) references scm.reno_variation_orders(id) on delete cascade;
alter table scm.reno_doc_lines add constraint reno_doc_lines_vo_fk foreign key (vo_id) references scm.reno_variation_orders(id) on delete set null;
alter table scm.reno_doc_lines add constraint reno_doc_lines_omitted_by_vo_fk foreign key (omitted_by_vo_id) references scm.reno_variation_orders(id) on delete set null;

create table scm.reno_po_line_flags (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null default 1,
  purchase_order_item_id uuid not null references scm.purchase_order_items(id) on delete cascade,
  so_item_id uuid references scm.mfg_sales_order_items(id) on delete set null,
  vo_id uuid not null references scm.reno_variation_orders(id) on delete cascade,
  action text not null check (action in ('AMEND', 'CANCEL')),
  new_qty integer check (new_qty is null or new_qty >= 0),
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  note text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);
create index idx_reno_po_line_flags_open on scm.reno_po_line_flags (purchase_order_item_id) where status = 'OPEN';

do $$ declare t text; begin
  foreach t in array array['reno_variation_orders', 'reno_po_line_flags'] loop
    execute format('alter table scm.%I owner to scm_engine', t);
    execute format('alter table scm.%I enable row level security', t);
    execute format('grant all on scm.%I to pos_app, service_role', t);
    execute format('revoke all on scm.%I from anon, authenticated', t);
  end loop;
end $$;
