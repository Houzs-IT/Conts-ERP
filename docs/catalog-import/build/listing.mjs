// Every SKU of the Conts company as the database holds it, for the owner's listing (build/listing.py makes the xlsx).
//   DATABASE_URL=postgres://... node docs/catalog-import/build/listing.mjs <out.json>     read only
import { writeFileSync } from 'node:fs';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const rows = await sql`
  select p.code, p.name, g.label as category, coalesce(s.label, p.sub_category) as sub_category, p.uom, u.label as unit,
         p.base_model, p.size_label, p.status::text as status, sp.name as supplier, b.supplier_sku, b.unit_price_sen, p.cost_price_sen
    from scm.mfg_products p
    left join scm.product_category_groups g on g.code = p.category_group
    left join scm.product_sub_categories s on s.group_code = p.category_group and s.code = p.sub_category
    left join scm.product_uoms u on u.code = p.uom
    left join scm.supplier_material_bindings b on b.company_id = p.company_id and b.material_kind = 'mfg_product'
                                              and b.item_code = p.code and b.is_main_supplier
    left join scm.suppliers sp on sp.id = b.supplier_id
   where p.company_id = (select id from public.companies where code = 'HOUZS')
   order by g.sort_order, p.category_group, p.sub_category, p.code`;
writeFileSync(process.argv[2], JSON.stringify(rows, null, 1));
console.log(`${rows.length} SKUs`);
await sql.end();
