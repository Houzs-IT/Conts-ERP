-- REVERSAL: delete from scm.supplier_material_bindings where notes = 'Default In-house (0221)';
-- Works and Built-in SKUs with no supplier start on In-house, so MRP opens on it (owner: every SKU can default to the
-- in-house supplier; catalog SKUs already carry the supplier from their documents). Other categories stay unbound.
insert into scm.supplier_material_bindings (supplier_id, material_kind, item_code, material_name, supplier_sku, is_main_supplier, company_id, notes)
select distinct on (p.code) s.id, 'mfg_product', p.code, p.name, p.code, true, p.company_id, 'Default In-house (0221)'
  from scm.mfg_products p
  join scm.suppliers s on s.company_id = p.company_id and s.code = 'INHOUSE'
 where p.status::text = 'ACTIVE' and p.category::text in ('WORKS', 'BUILTIN')
   and not exists (select 1 from scm.supplier_material_bindings b
                    where b.item_code = p.code and b.company_id = p.company_id and b.material_kind = 'mfg_product')
 order by p.code;
