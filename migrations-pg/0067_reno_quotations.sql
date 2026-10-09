-- REVERSAL: DROP TABLE scm.reno_quotation_revisions, scm.reno_quotations, scm.reno_quotation_templates;
-- Renovation quotations. A quotation belongs to a project, is numbered QT-YYMM-NNN and is revised as R2, R3 ...;
-- only the newest revision can be edited, older ones are frozen. The accepted revision converts to the sales order
-- in one step and the quotation then locks. Package templates (e.g. "Skyline Embassy Type A Classic") hold the same
-- sections and lines and are cloned into new quotations. Sections, lines and instalments live in 0068.
-- print_format is the default chosen at print: AMOUNT (amount only), UNIT_PRICE, DISCOUNT (disc price / disc %),
-- QTY_ONLY (one package total), PROMO_STANDARD (promotion vs standard price).
create table scm.reno_quotation_templates (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null default 1,
  name text not null check (length(trim(name)) > 0),
  brand_id bigint references public.project_brands(id) on delete set null,
  description text not null default '',
  print_format text not null default 'AMOUNT' check (print_format in ('AMOUNT', 'UNIT_PRICE', 'DISCOUNT', 'QTY_ONLY', 'PROMO_STANDARD')),
  term_template_id uuid references scm.reno_term_templates(id) on delete set null,
  doc_discount_sen integer not null default 0 check (doc_discount_sen >= 0),
  doc_discount_label text not null default '',
  promo_lines jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table scm.reno_quotations (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null default 1,
  quote_no text not null unique,
  project_id bigint not null references public.projects(id) on delete restrict,
  brand_id bigint references public.project_brands(id) on delete set null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED')),
  current_rev integer not null default 1 check (current_rev >= 1),
  accepted_rev integer,
  converted_so_doc_no text,
  locked_at timestamptz,
  template_id uuid references scm.reno_quotation_templates(id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  check ((status = 'ACCEPTED') = (accepted_rev is not null))
);
create index idx_reno_quotations_project on scm.reno_quotations (project_id);

create table scm.reno_quotation_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null default 1,
  quotation_id uuid not null references scm.reno_quotations(id) on delete cascade,
  rev_no integer not null check (rev_no >= 1),
  doc_no text not null unique,
  print_format text not null default 'AMOUNT' check (print_format in ('AMOUNT', 'UNIT_PRICE', 'DISCOUNT', 'QTY_ONLY', 'PROMO_STANDARD')),
  attention text not null default '',
  customer_name text not null default '',
  customer_phone text not null default '',
  customer_email text not null default '',
  customer_id uuid references scm.customers(id) on delete set null,
  building text not null default '',
  unit_no text not null default '',
  prepared_by text not null default '',
  doc_date date not null default current_date,
  last_amended date,
  valid_until date,
  intro text,
  terms_note text not null default '',
  term_template_id uuid references scm.reno_term_templates(id) on delete set null,
  doc_discount_sen integer not null default 0 check (doc_discount_sen >= 0),
  doc_discount_label text not null default '',
  promo_lines jsonb not null default '[]'::jsonb,
  frozen_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  unique (quotation_id, rev_no)
);

do $$ declare t text; begin
  foreach t in array array['reno_quotation_templates', 'reno_quotations', 'reno_quotation_revisions'] loop
    execute format('alter table scm.%I owner to scm_engine', t);
    execute format('alter table scm.%I enable row level security', t);
    execute format('grant all on scm.%I to pos_app, service_role', t);
    execute format('revoke all on scm.%I from anon, authenticated', t);
  end loop;
end $$;
