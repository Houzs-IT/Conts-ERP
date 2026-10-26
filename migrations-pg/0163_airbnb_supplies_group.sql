-- REVERSAL: refused while a SKU uses it: delete from scm.product_sub_categories where group_code = 'AIRBNB'; delete from scm.product_category_groups where code = 'AIRBNB'; delete from scm.acc_item_groups g where g.code = 'AIRBNB' and not exists (select 1 from scm.acc_item_group_accounts a where a.group_code = g.code); put back mfg_products_new_group_needs_sub without 'AIRBNB'.
-- The Airbnb supplies group (owner, 26 Oct 2026) and its five sub-categories, the same rows as
-- renovation-catalog.ts (renovationCatalogSeedParity.test.ts reads this file). It sits in the soft furnishing stage
-- and needs no photo (most of it comes from Shopee and IKEA). Things a renovation customer also buys (bed linen,
-- towels, carpets, small appliances, wall art) stay in their existing groups, so each SKU has one home.
set local search_path = scm, public, extensions;

insert into scm.product_category_groups (code, label, default_stage, photo_required, sort_order) values
  ('AIRBNB', 'Airbnb supplies', 'soft_furnishing', false, 80);

insert into scm.product_sub_categories (group_code, code, label, sort_order, legacy_categories) values
  ('AIRBNB', 'KITCHENWARE', 'Kitchenware', 10, '{}'::text[]),
  ('AIRBNB', 'BATH_CLEANING', 'Bathroom & cleaning', 20, '{}'::text[]),
  ('AIRBNB', 'FIXTURE', 'Fixture', 30, '{}'::text[]),
  ('AIRBNB', 'CONSUMABLES', 'Consumables', 40, '{}'::text[]),
  ('AIRBNB', 'SIGNAGE', 'Signage', 50, '{}'::text[])
on conflict do nothing;

-- A sales invoice refuses an item_group with no row here; the owner binds it to accounts under Accounting > Item Groups.
insert into scm.acc_item_groups (code, name) values ('AIRBNB', 'Airbnb supplies')
on conflict (code) do nothing;

-- Like the other new groups, an Airbnb SKU always has a sub-category.
alter table scm.mfg_products drop constraint mfg_products_new_group_needs_sub;
alter table scm.mfg_products add constraint mfg_products_new_group_needs_sub check (
  category::text not in ('WORKS','BUILTIN','FURNITURE','LIGHTING','APPLIANCE','SOFT','AIRBNB') or sub_category is not null);

notify pgrst, 'reload schema';
