-- REVERSAL: drop table scm.grn_site_photos; alter table scm.grns drop constraint grns_site_receipt_check, drop constraint grns_site_location_check, drop column received_at_site, drop column project_id, drop column site_received_at, drop column site_lat, drop column site_lng, drop column site_accuracy_m, drop column site_located_at, drop column supervisor_user_id, drop column supervisor_signature_r2_key, drop column customer_signer_name, drop column customer_signature_r2_key, drop column site_notes;
-- Site receipt: when a supplier delivers straight to the unit (most furniture, appliances, factory
-- cabinets) or a subcontractor finishes a trade, the site supervisor receives the purchase order on
-- the phone at the unit. It is an ordinary goods receipt with proof of delivery attached (photos,
-- the supplier's delivery order, supervisor signature, optional customer signature, location and
-- time) and it books NO stock: the goods are already in the customer's unit, never in a warehouse.
-- grns.ts and purchase-returns.ts skip every stock movement for a GRN with received_at_site.
set local search_path = scm, public, extensions;

alter table scm.grns
  add column received_at_site boolean not null default false,
  add column project_id bigint references public.projects(id) on delete restrict,
  add column site_received_at timestamptz,
  add column site_lat double precision,
  add column site_lng double precision,
  add column site_accuracy_m double precision,
  add column site_located_at timestamptz,
  add column supervisor_user_id uuid references scm.staff(id) on delete set null,
  add column supervisor_signature_r2_key text,
  add column customer_signer_name text,
  add column customer_signature_r2_key text,
  add column site_notes text;

alter table scm.grns
  -- A site receipt always names its project, when it was received and who signed for it.
  add constraint grns_site_receipt_check check (
    not received_at_site
    or (project_id is not null and site_received_at is not null and supervisor_signature_r2_key is not null)),
  add constraint grns_site_location_check check (
    (site_lat is null and site_lng is null)
    or (site_lat between -90 and 90 and site_lng between -180 and 180
        and (site_accuracy_m is null or site_accuracy_m >= 0) and site_located_at is not null)),
  add constraint grns_customer_signature_check check (
    customer_signature_r2_key is null or length(trim(coalesce(customer_signer_name, ''))) > 0);

create index grns_project_idx on scm.grns (project_id) where project_id is not null;

create table scm.grn_site_photos (
  id uuid primary key default gen_random_uuid(),
  grn_id uuid not null references scm.grns(id) on delete cascade,
  grn_item_id uuid references scm.grn_items(id) on delete set null,
  project_id bigint not null references public.projects(id) on delete cascade,
  location text,
  kind text not null,
  r2_key text not null,
  caption text,
  taken_at timestamptz,
  uploaded_by uuid references scm.staff(id) on delete set null,
  company_id bigint not null default 1 references public.companies(id),
  created_at timestamptz not null default now(),
  constraint grn_site_photos_kind_check check (kind in ('in_place', 'supplier_do', 'before', 'after', 'defect', 'other'))
);
create index grn_site_photos_grn_idx on scm.grn_site_photos (grn_id);
create index grn_site_photos_project_idx on scm.grn_site_photos (project_id, location);

alter table scm.grn_site_photos owner to scm_engine;
alter table scm.grn_site_photos enable row level security;
revoke all on scm.grn_site_photos from anon, authenticated;
