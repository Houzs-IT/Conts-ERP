-- REVERSAL: drop table scm.acc_einvoice_outbox; alter table scm.debtors drop column tin, drop column id_type, drop column id_number,
--   drop column sst_no, drop column city, drop column postcode, drop column state, drop column country; alter table scm.acc_company_settings drop column einvoice_active, ... (every column added below).
-- Renovation e-invoice ready, switched off (finance, chew 30 Oct 2026; spec
-- docs/superpowers/specs/2026-10-30-renovation-revenue-einvoice-design.md goal 7, 7.4, 7.7; plan
-- docs/superpowers/plans/2026-10-30-renovation-einvoice-ready.md Task 1).
--   scm.acc_company_settings  the e-invoice switch (off), classification code (022), tax type (06 Not applicable), the SST
--                             switch kept for later (stored only), the renovation invoice description template, and the
--                             seller's details. Dream Crafter and The Conts are one company, so one seller (chew).
--   scm.debtors               the buyer's tax identity on each project account: TIN, ID type and number, SST number, and
--                             the address's city, postcode, state and country (a renovation contract carries only two
--                             address lines, and an e-invoice needs the state).
--   scm.acc_einvoice_outbox   one e-invoice record per renovation invoice / credit note, prepared when it posts. Nothing
--                             sends it until a connector exists.
-- Numbered 0187: 0186 (reno_golive_baseline, unit_price_effective_from) is the last on production and on every branch.
-- APPLY: by hand, to production before the code merges, in one transaction with its public.pos_migrations row.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.acc_company_settings
  add column if not exists einvoice_active boolean not null default false,
  add column if not exists einvoice_classification text not null default '022',
  add column if not exists einvoice_tax_type text not null default '06',
  add column if not exists sst_enabled boolean not null default false,
  add column if not exists sst_mode text,
  add column if not exists sst_output_account text,
  add column if not exists reno_invoice_description text,
  add column if not exists seller_tin text,
  add column if not exists seller_brn text,
  add column if not exists seller_sst_no text,
  add column if not exists seller_msic text,
  add column if not exists seller_activity text,
  add column if not exists seller_address1 text,
  add column if not exists seller_address2 text,
  add column if not exists seller_city text,
  add column if not exists seller_postcode text,
  add column if not exists seller_state_code text,
  add column if not exists seller_phone text,
  add column if not exists seller_email text;

alter table scm.debtors
  add column if not exists tin text,
  add column if not exists id_type text,
  add column if not exists id_number text,
  add column if not exists sst_no text,
  add column if not exists city text,
  add column if not exists postcode text,
  add column if not exists state text,
  add column if not exists country text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'debtors_id_type_check') then
    alter table scm.debtors add constraint debtors_id_type_check check (id_type is null or id_type in ('NRIC', 'BRN', 'PASSPORT', 'ARMY'));
  end if;
end $$;

create table if not exists scm.acc_einvoice_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null,
  doc_kind text not null check (doc_kind in ('INVOICE', 'CREDIT_NOTE')),
  sales_invoice_id uuid,
  credit_note_id uuid,
  doc_number text not null,
  debtor_code text,
  status text not null check (status in ('NOT_READY', 'READY', 'SUBMITTED', 'VALID', 'REJECTED', 'CANCELLED')),
  missing text[] not null default '{}',
  payload jsonb,
  prepared_at timestamptz not null default now(),
  submitted_at timestamptz,
  lhdn_uuid text,
  lhdn_long_id text,
  error text,
  unique (company_id, doc_kind, doc_number)
);
create index if not exists acc_einvoice_outbox_debtor on scm.acc_einvoice_outbox (company_id, debtor_code);
alter table scm.acc_einvoice_outbox owner to scm_engine;
alter table scm.acc_einvoice_outbox enable row level security;
revoke all on scm.acc_einvoice_outbox from anon, authenticated;
-- The engine reaches it through the Supabase REST client (service_role).
grant all on scm.acc_einvoice_outbox to service_role, pos_app;

notify pgrst, 'reload schema';
