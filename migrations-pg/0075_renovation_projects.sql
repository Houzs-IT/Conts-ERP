-- REVERSAL: alter table public.projects drop constraint projects_project_kind_check, drop constraint projects_customer_kind_check, drop constraint projects_customer_id_fkey, drop constraint projects_reno_stage_check, drop column project_kind, drop column project_type_id, drop column customer_kind, drop column customer_id, drop column customer_name, drop column customer_phone, drop column customer_email, drop column pos_owner_id, drop column pos_unit_id, drop column building, drop column unit_no, drop column site_address, drop column reno_stage, drop column signed_at, drop column planned_handover_date, drop column handed_over_at, drop column closed_at, drop column salesperson_name;
-- Renovation projects (phase 3 of the renovation flow). The engine's exhibition Projects module is
-- reworked in place: every existing row stays an exhibition, new rows default to renovation. The
-- exhibition columns (brand, venue, booth...) stay and are hidden in the renovation screens.
-- Owner and unit links are opaque ids copied from Property OS (the engine cannot read schema pos),
-- with the building and unit text copied alongside so the board reads without a cross-schema join.
set local search_path = public, extensions;

alter table public.projects
  add column project_kind text not null default 'exhibition',
  add column project_type_id bigint,
  add column customer_kind text,
  add column customer_id uuid,
  add column customer_name text,
  add column customer_phone text,
  add column customer_email text,
  add column pos_owner_id text,
  add column pos_unit_id text,
  add column building text,
  add column unit_no text,
  add column site_address text,
  add column reno_stage text,
  add column signed_at timestamptz,
  add column planned_handover_date date,
  add column handed_over_at timestamptz,
  add column closed_at timestamptz,
  add column salesperson_name text;

-- Existing rows were filled with 'exhibition' by the default above; from now on a new row is renovation.
alter table public.projects alter column project_kind set default 'renovation';

alter table public.projects
  add constraint projects_project_kind_check check (project_kind in ('exhibition', 'renovation')),
  add constraint projects_customer_kind_check check (customer_kind is null or customer_kind in ('owner', 'customer')),
  add constraint projects_customer_id_fkey foreign key (customer_id) references scm.customers(id) on delete set null,
  add constraint projects_reno_stage_check check (reno_stage is null or reno_stage in
    ('design', 'key_permit', 'defect_check', 'shop_drawings', 'hardware', 'furniture', 'appliances',
     'soft_furnishing', 'handover', 'warranty', 'closed'));

create index projects_kind_company_idx on public.projects (company_id, project_kind) where archived_at is null;
create index projects_customer_id_idx on public.projects (customer_id) where customer_id is not null;
create index projects_pos_unit_idx on public.projects (pos_unit_id) where pos_unit_id is not null;
