-- REVERSAL: drop trigger trg_mfg_products_category_fill on scm.mfg_products; drop function scm.mfg_products_category_fill(); drop index scm.idx_mfg_products_group_sub; alter table scm.mfg_products drop constraint mfg_products_sub_category_fk, drop constraint mfg_products_category_group_fk, drop constraint mfg_products_new_group_needs_sub, drop constraint mfg_products_uom_check, drop column category_group, drop column sub_category, drop column uom; drop function scm.mfg_category_group(text); drop function scm.mfg_legacy_sub(text); drop table scm.product_sub_categories; drop table scm.product_category_groups; delete from scm.acc_item_groups g where g.code in ('WORKS','BUILTIN','FURNITURE','LIGHTING','APPLIANCE','SOFT') and not exists (select 1 from scm.acc_item_group_accounts a where a.group_code = g.code).
-- The renovation catalog (spec 2026-10-09 section 3): a two-level category tree and a unit of measure per SKU.
--
-- * scm.product_category_groups: the seven groups, each with its default project stage (lower-case stage keys,
--   the same as renovation-stages.ts) and whether its SKUs need a photo before they can be ACTIVE.
-- * scm.product_sub_categories: the sub-categories under each group. The sub-category of a WORKS item is its
--   trade. legacy_categories lists the Houzs categories that imply this sub-category.
-- * scm.mfg_products gets category_group (filled by trigger from category, never typed), sub_category and uom.
--   New SKUs store the group in category; legacy Houzs categories are NOT renamed, they map to a group here.
--
-- The rows below are the same as engine/backend/src/scm/shared/renovation-catalog.ts
-- (tests/renovationCatalogSeedParity.test.ts compares them). Sub-categories change by code + migration for now.
set local search_path = scm, public, extensions;

create table scm.product_category_groups (
  code text primary key,
  label text not null,
  default_stage text not null check (default_stage in
    ('design','key_permit','defect_check','shop_drawings','hardware','furniture','appliances','soft_furnishing','handover','warranty','closed')),
  photo_required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into scm.product_category_groups (code, label, default_stage, photo_required, sort_order) values
  ('WORKS', 'Works', 'hardware', false, 10),
  ('BUILTIN', 'Built-in', 'furniture', true, 20),
  ('FURNITURE', 'Furniture', 'furniture', true, 30),
  ('LIGHTING', 'Lighting', 'hardware', true, 40),
  ('APPLIANCE', 'Appliances', 'appliances', true, 50),
  ('SOFT', 'Soft furnishing', 'soft_furnishing', true, 60),
  ('SERVICE', 'Service', 'soft_furnishing', false, 70);

create table scm.product_sub_categories (
  group_code text not null references scm.product_category_groups(code),
  code text not null,
  label text not null,
  sort_order integer not null default 0,
  legacy_categories text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (group_code, code),
  constraint product_sub_categories_code_key unique (code)
);

-- WORKS sort order is the SUGGESTED site trade order (renovation-stages.ts TRADE_ORDER); it is never enforced.
insert into scm.product_sub_categories (group_code, code, label, sort_order, legacy_categories) values
  ('WORKS', 'PROTECTION', 'Protection', 10, '{}'::text[]),
  ('WORKS', 'HACKING', 'Hacking', 20, '{}'::text[]),
  ('WORKS', 'PLUMBING', 'Plumbing', 30, '{}'::text[]),
  ('WORKS', 'WATERPROOFING', 'Waterproofing', 40, '{}'::text[]),
  ('WORKS', 'ELECTRICAL', 'Electrical', 50, '{}'::text[]),
  ('WORKS', 'MASONRY_TILING', 'Masonry / tiling', 60, '{}'::text[]),
  ('WORKS', 'PLASTER_CEILING', 'Plaster ceiling', 70, '{}'::text[]),
  ('WORKS', 'ALUMINIUM_GLASS', 'Window / sliding door / glass', 80, '{}'::text[]),
  ('WORKS', 'GRILL', 'Grill', 85, '{}'::text[]),
  ('WORKS', 'PAINTING', 'Painting', 90, '{}'::text[]),
  ('WORKS', 'TEXTURED_PAINTING', 'Textured painting', 95, '{}'::text[]),
  ('WORKS', 'FLOORING', 'Flooring', 100, '{}'::text[]),
  ('WORKS', 'AIRCON_INSTALL', 'Aircon install', 110, '{}'::text[]),
  ('WORKS', 'CLEANING', 'Cleaning', 120, '{}'::text[]),
  ('WORKS', 'PROJECT_MGMT', 'Project management', 130, '{}'::text[]),
  ('BUILTIN', 'KITCHEN_CABINET', 'Kitchen cabinet', 10, '{}'::text[]),
  ('BUILTIN', 'WARDROBE', 'Wardrobe', 20, '{}'::text[]),
  ('BUILTIN', 'TV_CABINET', 'TV cabinet', 30, '{}'::text[]),
  ('BUILTIN', 'SHOE_CABINET', 'Shoe cabinet', 40, '{}'::text[]),
  ('BUILTIN', 'STUDY_TABLE', 'Study table', 50, '{}'::text[]),
  ('BUILTIN', 'COUNTERTOP', 'Countertop (stone)', 60, '{}'::text[]),
  ('BUILTIN', 'SHELVING', 'Shelving', 70, '{}'::text[]),
  ('FURNITURE', 'SOFA', 'Sofa', 10, array['SOFA']::text[]),
  ('FURNITURE', 'BEDFRAME', 'Bedframe', 20, array['BEDFRAME']::text[]),
  ('FURNITURE', 'MATTRESS', 'Mattress', 30, array['MATTRESS']::text[]),
  ('FURNITURE', 'DINING', 'Dining', 40, array['DINING']::text[]),
  ('FURNITURE', 'TABLES', 'Tables', 50, '{}'::text[]),
  ('FURNITURE', 'LOOSE_STORAGE', 'Loose storage', 60, '{}'::text[]),
  ('FURNITURE', 'ACCESSORY', 'Accessory', 70, array['ACCESSORY', 'FABRIC_ACCESSORY', 'OTHERS']::text[]),
  ('LIGHTING', 'DOWNLIGHT', 'Downlight', 10, '{}'::text[]),
  ('LIGHTING', 'PENDANT', 'Pendant', 20, '{}'::text[]),
  ('LIGHTING', 'LED_STRIP', 'LED strip', 30, '{}'::text[]),
  ('LIGHTING', 'CEILING_FAN', 'Ceiling fan', 40, '{}'::text[]),
  ('APPLIANCE', 'TV', 'TV', 10, '{}'::text[]),
  ('APPLIANCE', 'FRIDGE', 'Fridge', 20, '{}'::text[]),
  ('APPLIANCE', 'WASHER', 'Washer', 30, '{}'::text[]),
  ('APPLIANCE', 'WATER_HEATER', 'Water heater', 40, '{}'::text[]),
  ('APPLIANCE', 'HOOD_HOB', 'Hood / hob', 50, '{}'::text[]),
  ('APPLIANCE', 'AIRCON_UNIT', 'Aircon unit', 60, '{}'::text[]),
  ('SOFT', 'CURTAIN_BLINDS', 'Curtain / blinds', 10, '{}'::text[]),
  ('SOFT', 'BED_LINEN', 'Bed linen', 20, array['BEDLINES']::text[]),
  ('SOFT', 'AMENITIES', 'Amenities', 30, '{}'::text[]),
  ('SOFT', 'DECORATION', 'Decoration', 40, '{}'::text[]),
  ('SOFT', 'CARPET', 'Carpet', 50, array['CARPET']::text[]),
  ('SOFT', 'DIFFUSER', 'Diffuser', 60, array['DIFFUSER']::text[]),
  ('SERVICE', 'DELIVERY', 'Delivery', 10, '{}'::text[]),
  ('SERVICE', 'STYLING', 'Styling', 20, '{}'::text[]),
  ('SERVICE', 'PHOTOSHOOT', 'Photoshoot', 30, '{}'::text[]),
  ('SERVICE', 'AIRBNB_SETUP', 'Airbnb setup', 40, '{}'::text[]);

-- The group a stored category belongs to: a group code is its own group; a legacy Houzs category maps through
-- legacy_categories (SOFA..OTHERS -> FURNITURE, BEDLINES/CARPET/DIFFUSER -> SOFT). null for anything else.
create or replace function scm.mfg_category_group(p_category text)
returns text language sql stable
set search_path = scm, pg_temp
as $$
  select coalesce(
    (select g.code from scm.product_category_groups g where g.code = upper(p_category)),
    (select s.group_code from scm.product_sub_categories s where upper(p_category) = any (s.legacy_categories) limit 1)
  )
$$;

-- The sub-category a legacy category implies (SOFA -> SOFA, BEDLINES -> BED_LINEN, OTHERS -> ACCESSORY); null when none.
create or replace function scm.mfg_legacy_sub(p_category text)
returns text language sql stable
set search_path = scm, pg_temp
as $$
  select s.code from scm.product_sub_categories s where upper(p_category) = any (s.legacy_categories) limit 1
$$;

alter table scm.mfg_products
  add column category_group text,
  add column sub_category text,
  add column uom text not null default 'UNIT';

update scm.mfg_products
   set category_group = scm.mfg_category_group(category::text),
       sub_category = coalesce(sub_category, scm.mfg_legacy_sub(category::text));

-- Fail closed: every stored category must map to a group before the column becomes required.
do $$
declare n integer;
begin
  select count(*) into n from scm.mfg_products where category_group is null;
  if n > 0 then
    raise exception '% mfg_products rows have a category that maps to no renovation group; map them first', n;
  end if;
end $$;

alter table scm.mfg_products
  alter column category_group set not null,
  add constraint mfg_products_category_group_fk foreign key (category_group) references scm.product_category_groups(code),
  -- MATCH SIMPLE: a null sub_category (legacy SERVICE, or a legacy row with no implied sub) passes.
  add constraint mfg_products_sub_category_fk foreign key (category_group, sub_category)
    references scm.product_sub_categories(group_code, code),
  add constraint mfg_products_new_group_needs_sub check (
    category::text not in ('WORKS','BUILTIN','FURNITURE','LIGHTING','APPLIANCE','SOFT') or sub_category is not null),
  add constraint mfg_products_uom_check check (uom in ('PCS','UNIT','SET','LOT','FT','SQFT','POINT','FULL'));

-- category_group is derived, never typed. A category change that does not also send a sub-category re-derives
-- it from the new category, so a stale sub can never sit under the wrong group (a new group then needs one).
create or replace function scm.mfg_products_category_fill()
returns trigger language plpgsql
set search_path = scm, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.category is distinct from old.category
     and new.sub_category is not distinct from old.sub_category then
    new.sub_category := null;
  end if;
  new.category_group := scm.mfg_category_group(new.category::text);
  if new.sub_category is null then
    new.sub_category := scm.mfg_legacy_sub(new.category::text);
  else
    new.sub_category := upper(new.sub_category);
  end if;
  if new.uom is not null then new.uom := upper(new.uom); end if;
  return new;
end $$;

create trigger trg_mfg_products_category_fill
  before insert or update of category, sub_category, uom, category_group on scm.mfg_products
  for each row execute function scm.mfg_products_category_fill();

create index idx_mfg_products_group_sub on scm.mfg_products (company_id, category_group, sub_category);

-- Accounting item groups: a sales invoice refuses an item_group with no scm.acc_item_groups row. The owner binds
-- each to its accounts under Accounting > Item Groups.
insert into scm.acc_item_groups (code, name) values
  ('WORKS', 'Works'), ('BUILTIN', 'Built-in'), ('FURNITURE', 'Furniture'), ('LIGHTING', 'Lighting'),
  ('APPLIANCE', 'Appliances'), ('SOFT', 'Soft furnishing'), ('SERVICE', 'Service')
on conflict (code) do nothing;

-- Same access shape as every engine table: owned by scm_engine, RLS on with no policies, nothing for anon/authenticated.
alter table scm.product_category_groups owner to scm_engine;
alter table scm.product_sub_categories owner to scm_engine;
alter function scm.mfg_category_group(text) owner to scm_engine;
alter function scm.mfg_legacy_sub(text) owner to scm_engine;
alter function scm.mfg_products_category_fill() owner to scm_engine;
alter table scm.product_category_groups enable row level security;
alter table scm.product_sub_categories enable row level security;
revoke all on scm.product_category_groups, scm.product_sub_categories from anon, authenticated;
grant all on scm.product_category_groups, scm.product_sub_categories to pos_app, service_role;
grant execute on function scm.mfg_category_group(text), scm.mfg_legacy_sub(text) to pos_app, service_role;

notify pgrst, 'reload schema';
