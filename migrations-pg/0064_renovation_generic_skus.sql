-- REVERSAL: delete from scm.mfg_products where code like 'RN-%' and id like 'mfg-rn-%' (refused by the database if a document already uses one, which is the point); then delete from scm.product_models where model_code like 'RN-%' and not exists (select 1 from scm.mfg_products p where p.model_id = product_models.id).
-- Generic renovation SKUs (integration contract "Generic SKUs", owner default Q5): one per WORKS and SERVICE
-- sub-category, code RN-<SUB>, so every priced line of a quotation or SO can pick a SKU and carry its own
-- free-text description. The line's trade is the SKU's sub_category. Price 0: the line sets its price.
-- Each gets its own 1:1 model, like every other SKU (owner 2026-09-18). Not photo-required groups, so ACTIVE.
-- The list is renovation-catalog.ts genericSkus() (tests/renovationCatalogSeedParity.test.ts compares them).
-- Seeded for the Conts company only; re-running is a no-op. Its internal code is HOUZS on purpose (migration 0046),
-- so it is selected by that code; a lookup by 'CONTS' finds nothing and would seed nothing.
set local search_path = scm, public, extensions;

with co as (select id from public.companies where code = 'HOUZS'),
seed (code, name, category, sub, uom) as (values
  ('RN-PROTECTION', 'Works - Protection', 'WORKS', 'PROTECTION', 'LOT'),
  ('RN-HACKING', 'Works - Hacking', 'WORKS', 'HACKING', 'LOT'),
  ('RN-PLUMBING', 'Works - Plumbing', 'WORKS', 'PLUMBING', 'LOT'),
  ('RN-WATERPROOFING', 'Works - Waterproofing', 'WORKS', 'WATERPROOFING', 'SQFT'),
  ('RN-ELECTRICAL', 'Works - Electrical', 'WORKS', 'ELECTRICAL', 'POINT'),
  ('RN-MASONRY_TILING', 'Works - Masonry / tiling', 'WORKS', 'MASONRY_TILING', 'SQFT'),
  ('RN-PLASTER_CEILING', 'Works - Plaster ceiling', 'WORKS', 'PLASTER_CEILING', 'SQFT'),
  ('RN-ALUMINIUM_GLASS', 'Works - Window / sliding door / glass', 'WORKS', 'ALUMINIUM_GLASS', 'LOT'),
  ('RN-GRILL', 'Works - Grill', 'WORKS', 'GRILL', 'LOT'),
  ('RN-PAINTING', 'Works - Painting', 'WORKS', 'PAINTING', 'LOT'),
  ('RN-TEXTURED_PAINTING', 'Works - Textured painting', 'WORKS', 'TEXTURED_PAINTING', 'LOT'),
  ('RN-FLOORING', 'Works - Flooring', 'WORKS', 'FLOORING', 'SQFT'),
  ('RN-AIRCON_INSTALL', 'Works - Aircon install', 'WORKS', 'AIRCON_INSTALL', 'LOT'),
  ('RN-CLEANING', 'Works - Cleaning', 'WORKS', 'CLEANING', 'LOT'),
  ('RN-PROJECT_MGMT', 'Works - Project management', 'WORKS', 'PROJECT_MGMT', 'LOT'),
  ('RN-DELIVERY', 'Service - Delivery', 'SERVICE', 'DELIVERY', 'LOT'),
  ('RN-STYLING', 'Service - Styling', 'SERVICE', 'STYLING', 'LOT'),
  ('RN-PHOTOSHOOT', 'Service - Photoshoot', 'SERVICE', 'PHOTOSHOOT', 'LOT'),
  ('RN-AIRBNB_SETUP', 'Service - Airbnb setup', 'SERVICE', 'AIRBNB_SETUP', 'LOT')
),
models as (
  insert into scm.product_models (company_id, model_code, name, category)
  select co.id, s.code, s.name, s.category::scm.mfg_product_category from seed s cross join co
  on conflict (company_id, model_code, category) do nothing
  returning id, model_code
)
insert into scm.mfg_products (id, company_id, code, name, category, sub_category, uom, status, cost_price_sen, model_id)
select 'mfg-rn-' || lower(replace(s.sub, '_', '-')), co.id, s.code, s.name, s.category::scm.mfg_product_category,
       s.sub, s.uom, 'ACTIVE', 0,
       coalesce(m.id, (select pm.id from scm.product_models pm
                        where pm.company_id = co.id and pm.model_code = s.code and pm.category::text = s.category))
  from seed s cross join co
  left join models m on m.model_code = s.code
on conflict (company_id, code) do nothing;
