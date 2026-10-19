-- REVERSAL: alter table scm.mfg_products drop constraint mfg_products_uom_fk; alter table scm.mfg_products add constraint mfg_products_uom_check check (uom in ('PCS','UNIT','SET','LOT','FT','SQFT','POINT','FULL')); drop table scm.product_uoms. (Fails while a SKU carries an added unit; move those SKUs to a built-in unit first.)
-- Renovation units of measure become a list the owner edits under Products > SKU Master > Units, instead of the
-- fixed eight in 0061's check. Codes and the measure flag are set when a unit is added and never change (SKUs,
-- document lines and printed documents store the code; a measure unit asks for a length or area on a line).
-- The eight rows are the same as UOMS in engine/backend/src/scm/shared/renovation-catalog.ts
-- (tests/renovationCatalogSeedParity.test.ts compares them).
set local search_path = scm, public, extensions;

create table scm.product_uoms (
  code text primary key check (code ~ '^[A-Z][A-Z0-9]{0,7}$'),
  label text not null,
  print_label text not null,
  measure boolean not null default false,
  builtin boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into scm.product_uoms (code, label, print_label, measure, builtin, sort_order) values
  ('PCS', 'Pieces', 'PCS', false, true, 10),
  ('UNIT', 'Unit', 'UNIT', false, true, 20),
  ('SET', 'Set', 'SET', false, true, 30),
  ('LOT', 'Lump sum', 'LS', false, true, 40),
  ('FT', 'Feet (run)', 'FT', true, true, 50),
  ('SQFT', 'Square feet', 'SQFT', true, true, 60),
  ('POINT', 'Point', 'POINT', false, true, 70),
  ('FULL', 'Full unit', 'FULL UNIT', false, true, 80);

alter table scm.mfg_products
  drop constraint mfg_products_uom_check,
  add constraint mfg_products_uom_fk foreign key (uom) references scm.product_uoms(code);

-- Same access shape as 0061: owned by scm_engine, RLS on with no policies, nothing for anon/authenticated.
alter table scm.product_uoms owner to scm_engine;
alter table scm.product_uoms enable row level security;
revoke all on scm.product_uoms from anon, authenticated;
grant all on scm.product_uoms to pos_app, service_role;

notify pgrst, 'reload schema';
