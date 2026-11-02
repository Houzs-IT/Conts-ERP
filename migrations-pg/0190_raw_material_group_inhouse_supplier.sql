-- REVERSAL: refused while a SKU or PO uses them: delete from scm.product_sub_categories where group_code = 'RAW'; delete from scm.product_category_groups where code = 'RAW'; delete from scm.acc_item_groups g where g.code = 'RAW' and not exists (select 1 from scm.acc_item_group_accounts a where a.group_code = g.code); delete from scm.suppliers where code = 'INHOUSE' and company_id = 1; put back mfg_products_new_group_needs_sub without 'RAW'.
-- The Raw material group (owner, 1 Nov 2026) and its sub-categories, the same rows as renovation-catalog.ts
-- (renovationCatalogSeedParity.test.ts reads this file), and the In-house Production Team supplier: works the owner
-- gives his own team (plaster ceiling, wiring, masonry) are ordered on a PO to it, which later becomes a production
-- order whose raw materials are bought from outside suppliers.
set local search_path = scm, public, extensions;

insert into scm.product_category_groups (code, label, default_stage, photo_required, sort_order) values
  ('RAW', 'Raw material', 'hardware', false, 90);

insert into scm.product_sub_categories (group_code, code, label, sort_order, legacy_categories) values
  ('RAW', 'CEMENT_SAND', 'Cement & sand', 10, '{}'::text[]),
  ('RAW', 'TILE_ADHESIVE', 'Tile adhesive & grout', 20, '{}'::text[]),
  ('RAW', 'BOARD', 'Gypsum & board', 30, '{}'::text[]),
  ('RAW', 'TIMBER', 'Timber & plywood', 40, '{}'::text[]),
  ('RAW', 'WIRE_FITTING', 'Wire & electrical fittings', 50, '{}'::text[]),
  ('RAW', 'PIPE_FITTING', 'Pipe & plumbing fittings', 60, '{}'::text[]),
  ('RAW', 'PAINT_SEALANT', 'Paint & sealant', 70, '{}'::text[]),
  ('RAW', 'HARDWARE', 'Hardware & fasteners', 80, '{}'::text[]),
  ('RAW', 'OTHER_RAW', 'Other raw material', 90, '{}'::text[])
on conflict do nothing;

-- A sales invoice refuses an item_group with no row here; the owner binds it to accounts under Accounting > Item Groups.
insert into scm.acc_item_groups (code, name) values ('RAW', 'Raw material')
on conflict (code) do nothing;

-- Like the other new groups, a raw material SKU always has a sub-category.
alter table scm.mfg_products drop constraint mfg_products_new_group_needs_sub;
alter table scm.mfg_products add constraint mfg_products_new_group_needs_sub check (
  category::text not in ('WORKS','BUILTIN','FURNITURE','LIGHTING','APPLIANCE','SOFT','AIRBNB','RAW') or sub_category is not null);

insert into scm.suppliers (code, name, notes, status, country, currency, company_id, for_purchasing, statement_type, aging_basis, rating, credit_limit_sen)
select 'INHOUSE', 'In-house Production Team', 'works done by The Conts own team; a PO to it becomes a production order', 'ACTIVE', 'Malaysia', 'MYR', 1, true, 'OPEN_ITEM', 'INVOICE_DATE', 0, 0
where not exists (select 1 from scm.suppliers where code = 'INHOUSE' and company_id = 1);

notify pgrst, 'reload schema';
