-- REVERSAL: delete from scm.mfg_products where id in ('mfg-rn-partition', 'mfg-rn-door', 'mfg-rn-feature-wall') (refused by the database if a document already uses one); delete from scm.product_models where model_code in ('RN-PARTITION', 'RN-DOOR', 'RN-FEATURE_WALL') and not exists (select 1 from scm.mfg_products p where p.model_id = product_models.id); delete from scm.product_sub_categories where code in ('PARTITION', 'DOOR', 'FEATURE_WALL');
-- Three WORKS trades the owner's Notion task categories name and the catalog did not have (owner decisions
-- 11 Oct 2026): PARTITION, DOOR (door installation, hidden door) and FEATURE_WALL. Same rows as
-- renovation-catalog.ts SUB_CATEGORIES; each gets its generic SKU RN-<SUB> like migration 0064, so a quotation or SO
-- line can price the trade (tests/renovationCatalogSeedParity.test.ts compares both). Re-running is a no-op.
set local search_path = scm, public, extensions;

insert into scm.product_sub_categories (group_code, code, label, sort_order, legacy_categories) values
  ('WORKS', 'PARTITION', 'Partition', 75, '{}'::text[]),
  ('WORKS', 'DOOR', 'Door', 82, '{}'::text[]),
  ('WORKS', 'FEATURE_WALL', 'Feature wall', 97, '{}'::text[])
on conflict (group_code, code) do nothing;

with co as (select id from public.companies where code = 'HOUZS'),
seed (code, name, category, sub, uom) as (values
  ('RN-PARTITION', 'Works - Partition', 'WORKS', 'PARTITION', 'LOT'),
  ('RN-DOOR', 'Works - Door', 'WORKS', 'DOOR', 'LOT'),
  ('RN-FEATURE_WALL', 'Works - Feature wall', 'WORKS', 'FEATURE_WALL', 'LOT')
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
