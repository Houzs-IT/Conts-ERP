-- sku-batch3 2026-11-03: three SKUs for the in-house (The Conts) renovation orders (owner, 3 Nov 2026). The Skyline
-- Embassy quotations price a dining table, a working table and installation, which had no catalog product; the import
-- (docs/so-import/inhouse) put them on RN-PROJECT_MGMT. Same shape as sku-batch2 (batch2-b-so-codes.sql): each SKU a
-- model of its own, active straight away, coded as the catalog's generic SKUs are (FUR-GEN-..., RN-... "Service - ...").
-- One transaction; safe to run again (keyed on SKU code).
begin;

do $$ begin
  if (select count(*) from public.companies where code = 'HOUZS') <> 1 then raise exception 'expected exactly one HOUZS company'; end if;
end $$;

insert into scm.product_sub_categories (group_code, code, label, sort_order, legacy_categories) values
  ('SERVICE', 'INSTALLATION', 'Installation', 110, '{}'::text[])
on conflict do nothing;

create temp table b3_rows on commit drop as
select * from jsonb_to_recordset($b3$[
  {"id": "mfg-248dec05b46e", "code": "FUR-GEN-DINTABLE", "name": "Dining table", "category": "FURNITURE", "sub_category": "DINING", "uom": "PCS", "cost": 0},
  {"id": "mfg-cab0874f3a33", "code": "FUR-GEN-WORKTABLE", "name": "Working / study table", "category": "FURNITURE", "sub_category": "TABLES", "uom": "PCS", "cost": 0},
  {"id": "mfg-rn-installation", "code": "RN-INSTALLATION", "name": "Service - Installation", "category": "SERVICE", "sub_category": "INSTALLATION", "uom": "LOT", "cost": 0}
]$b3$::jsonb)
  as x(id text, code text, name text, category text, sub_category text, uom text, cost integer);

insert into scm.product_models (company_id, model_code, name, category)
select (select id from public.companies where code = 'HOUZS'), r.code, r.name, r.category::scm.mfg_product_category from b3_rows r
on conflict (company_id, model_code, category) do nothing;

insert into scm.mfg_products (id, company_id, code, name, category, sub_category, uom, status, cost_price_sen, model_id)
select r.id, (select id from public.companies where code = 'HOUZS'), r.code, r.name, r.category::scm.mfg_product_category, r.sub_category, r.uom, 'ACTIVE', r.cost, m.id
  from b3_rows r
  left join scm.product_models m on m.company_id = (select id from public.companies where code = 'HOUZS') and m.model_code = r.code and m.category::text = r.category
on conflict (company_id, code) do nothing;

do $$ begin
  if (select count(*) from scm.mfg_products p join public.companies c on c.id = p.company_id and c.code = 'HOUZS'
       where p.code in ('FUR-GEN-DINTABLE', 'FUR-GEN-WORKTABLE', 'RN-INSTALLATION') and p.status = 'ACTIVE' and p.model_id is not null) <> 3
  then raise exception 'expected the 3 SKUs active with their models'; end if;
end $$;

commit;
