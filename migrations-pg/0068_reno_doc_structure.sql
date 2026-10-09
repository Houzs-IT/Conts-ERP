-- REVERSAL: DROP TABLE scm.reno_doc_instalments, scm.reno_doc_lines, scm.reno_doc_sections;
-- The line structure shared by quotation templates, quotation revisions, sales orders (contracts) and variation
-- orders. scm.mfg_sales_order_items keeps its shape: each priced line of a contract is mirrored there as one row
-- (so_item_id), and these tables hold what the furniture order line cannot: sections with a colour band and an
-- optional lump-sum price, parent / child / dimension / text lines, room, an optional decimal measure with its unit,
-- line discount %, a typed amount override, FOC and supply-by-owner flags, the bound supplier and cost, and the stage
-- override (stage_code) the project uses instead of the product's default stage.
-- Exactly one owner per section. vo_id gets its foreign key in 0070 with the variation order table.
create table scm.reno_doc_sections (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null default 1,
  template_id uuid references scm.reno_quotation_templates(id) on delete cascade,
  revision_id uuid references scm.reno_quotation_revisions(id) on delete cascade,
  so_doc_no text references scm.mfg_sales_orders(doc_no) on delete cascade,
  vo_id uuid,
  heading text not null default '',
  band_color text check (band_color is null or band_color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0,
  lump_sum_sen integer,
  page_break_before boolean not null default false,
  so_item_id uuid references scm.mfg_sales_order_items(id) on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(template_id, revision_id, so_doc_no, vo_id) = 1)
);
create index idx_reno_doc_sections_template on scm.reno_doc_sections (template_id) where template_id is not null;
create index idx_reno_doc_sections_revision on scm.reno_doc_sections (revision_id) where revision_id is not null;
create index idx_reno_doc_sections_so on scm.reno_doc_sections (so_doc_no) where so_doc_no is not null;
create index idx_reno_doc_sections_vo on scm.reno_doc_sections (vo_id) where vo_id is not null;

create table scm.reno_doc_lines (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null default 1,
  section_id uuid not null references scm.reno_doc_sections(id) on delete cascade,
  parent_line_id uuid references scm.reno_doc_lines(id) on delete cascade,
  kind text not null check (kind in ('ITEM', 'CHILD', 'DETAIL', 'TEXT')),
  sort_order integer not null default 0,
  room text not null default '',
  item_code text,
  description text not null default '',
  qty integer not null default 1 check (qty >= 0),
  measure numeric(12, 3) check (measure is null or measure > 0),
  measure_uom text,
  uom text,
  unit_price_sen integer not null default 0,
  list_price_sen integer,
  discount_bp integer not null default 0 check (discount_bp between 0 and 10000),
  amount_override_sen integer,
  is_foc boolean not null default false,
  supply_by_owner boolean not null default false,
  highlight text not null default 'NONE' check (highlight in ('NONE', 'GREY', 'PINK')),
  supplier_id uuid references scm.suppliers(id) on delete set null,
  unit_cost_sen integer not null default 0 check (unit_cost_sen >= 0),
  stage_code text check (stage_code in ('design', 'key_permit', 'defect_check', 'shop_drawings', 'hardware', 'furniture', 'appliances', 'soft_furnishing', 'handover', 'warranty', 'closed')),
  page_break_before boolean not null default false,
  so_item_id uuid references scm.mfg_sales_order_items(id) on delete set null,
  vo_id uuid,
  vo_change text check (vo_change in ('ADD', 'OMIT')),
  omit_target_line_id uuid references scm.reno_doc_lines(id) on delete set null,
  omit_qty integer check (omit_qty is null or omit_qty > 0),
  omitted_by_vo_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'CHILD' or parent_line_id is not null),
  check (kind <> 'ITEM' or parent_line_id is null),
  check ((measure is null) = (measure_uom is null)),
  check (vo_change <> 'OMIT' or omit_target_line_id is not null)
);
create index idx_reno_doc_lines_section on scm.reno_doc_lines (section_id, sort_order);
create index idx_reno_doc_lines_so_item on scm.reno_doc_lines (so_item_id) where so_item_id is not null;
create index idx_reno_doc_lines_parent on scm.reno_doc_lines (parent_line_id) where parent_line_id is not null;

create table scm.reno_doc_instalments (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null default 1,
  template_id uuid references scm.reno_quotation_templates(id) on delete cascade,
  revision_id uuid references scm.reno_quotation_revisions(id) on delete cascade,
  so_doc_no text references scm.mfg_sales_orders(doc_no) on delete cascade,
  seq integer not null check (seq > 0),
  label text not null default '',
  pct_bp integer not null check (pct_bp > 0 and pct_bp <= 10000),
  description text not null default '',
  stage_code text check (stage_code in ('design', 'key_permit', 'defect_check', 'shop_drawings', 'hardware', 'furniture', 'appliances', 'soft_furnishing', 'handover', 'warranty', 'closed')),
  trigger text not null default 'stage_start' check (trigger in ('so_confirmed', 'stage_start', 'stage_done')),
  check (num_nonnulls(template_id, revision_id, so_doc_no) = 1)
);
create unique index uq_reno_doc_instalments_template on scm.reno_doc_instalments (template_id, seq) where template_id is not null;
create unique index uq_reno_doc_instalments_revision on scm.reno_doc_instalments (revision_id, seq) where revision_id is not null;
create unique index uq_reno_doc_instalments_so on scm.reno_doc_instalments (so_doc_no, seq) where so_doc_no is not null;

do $$ declare t text; begin
  foreach t in array array['reno_doc_sections', 'reno_doc_lines', 'reno_doc_instalments'] loop
    execute format('alter table scm.%I owner to scm_engine', t);
    execute format('alter table scm.%I enable row level security', t);
    execute format('grant all on scm.%I to pos_app, service_role', t);
    execute format('revoke all on scm.%I from anon, authenticated', t);
  end loop;
end $$;
