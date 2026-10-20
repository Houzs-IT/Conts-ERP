// The writes of scripts/catalog-first-import.mjs as plain SQL, so the same import can be applied by anyone who can
// run SQL against the database (e.g. the Supabase SQL editor or connector) and by the script itself: the script's real
// run executes exactly these parts, so the two ways cannot drift apart.
//
// Each part is one transaction (begin ... commit), safe to run alone, in order, and again:
//   - every part repeats the small setup (units, sub-category, suppliers) with ON CONFLICT DO NOTHING / WHERE NOT EXISTS
//   - each part carries its own SKUs; a SKU, its model, its supplier link and its cost row are keyed on the SKU code
//     (and the supplier code), so a second run finds them and adds nothing
//   - mfg_products.id is derived from the SKU code (sha256), the same on every database and every run
//   - the import note is one scm.app_config row per part (key note:catalog-first-import-2026-10:part-N), kept on re-run
//   - the last statement returns the counts for the whole catalog
import { createHash } from 'node:crypto';

export const RUN_TAG = 'catalog-first-import 2026-10';
const NOTE_KEY = 'note:catalog-first-import-2026-10';
const TAG = '$cfi$';
const COMPANY = `(select id from public.companies where code = 'HOUZS')`;

export const skuId = (code) => `mfg-${createHash('sha256').update(`catalog-first-import|${code}`).digest('hex').slice(0, 12)}`;
const sen = (rm) => (rm == null ? null : Math.round(Number(rm) * 100));
const lit = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const json = (v) => {
  const s = JSON.stringify(v);
  if (s.includes(TAG)) throw new Error('data contains the dollar-quote tag');
  return `${TAG}${s}${TAG}::jsonb`;
};

/** The rows a part writes for one SKU (product + link), from catalog-data.json. */
function skuRows(data, k) {
  const s = data.suppliers[k.supplier];
  const priced = k.cost_rm != null;
  return {
    id: skuId(k.code), code: k.code, name: k.name, category: k.category, sub_category: k.sub_category, uom: k.uom,
    status: ['WORKS', 'SERVICE'].includes(k.category) ? 'ACTIVE' : 'INACTIVE',
    cost: sen(k.cost_rm) ?? 0, description: k.description || null, branding: s.name,
    sup_code: s.code, sup_name: s.name, supplier_sku: k.supplier_item_code || '',
    valid_from: priced ? k.price_date : null,
    notes: priced ? `${RUN_TAG}: ${k.price_type}, ${k.price_source}` : `${RUN_TAG}: PRICE NEEDED - no price in ${k.item_source}`,
  };
}

function setupSql(data) {
  const uoms = data.new_uoms.map((u) => `(${lit(u.code)}, ${lit(u.label)}, ${lit(u.print_label)}, ${u.measure ? 'true' : 'false'}, false, 200)`).join(',\n  ');
  const subs = data.new_sub_categories.map((s) => `(${lit(s.group)}, ${lit(s.code)}, ${lit(s.label)}, 200)`).join(',\n  ');
  const sups = Object.values(data.suppliers).map((s) => ({
    code: s.code, name: s.name, registration_no: s.registration_no ?? null, tin_number: s.tin_number ?? null,
    address1: s.address1 ?? null, address2: s.address2 ?? null, phone: s.phone ?? null, email: s.email ?? null,
    notes: `${s.note} Created by ${RUN_TAG} from ${s.src}.`,
  }));
  return `do $$ begin
  if (select count(*) from public.companies where code = 'HOUZS') <> 1 then
    raise exception 'expected exactly one company with code HOUZS (the Conts company)';
  end if;
end $$;

insert into scm.product_uoms (code, label, print_label, measure, builtin, sort_order) values
  ${uoms}
on conflict (code) do nothing;

insert into scm.product_sub_categories (group_code, code, label, sort_order) values
  ${subs}
on conflict do nothing;

-- A supplier that already exists under the same code or the same name is used as it is.
insert into scm.suppliers (company_id, code, name, registration_no, tin_number, address1, address2, phone, email, notes, status)
select ${COMPANY}, x.code, x.name, x.registration_no, x.tin_number, x.address1, x.address2, x.phone, x.email, x.notes, 'ACTIVE'
  from jsonb_to_recordset(${json(sups)}) as x(code text, name text, registration_no text, tin_number text, address1 text,
                                            address2 text, phone text, email text, notes text)
 where not exists (select 1 from scm.suppliers s where s.company_id = ${COMPANY}
                     and (upper(s.code) = upper(x.code) or upper(trim(s.name)) = upper(x.name)))
on conflict (company_id, code) do nothing;
`;
}

function skuSql(rows) {
  const payload = json(rows);
  return `create temp table cfi_rows on commit drop as
select * from jsonb_to_recordset(${payload}) as x(id text, code text, name text, category text, sub_category text, uom text,
  status text, cost integer, description text, branding text, sup_code text, sup_name text, supplier_sku text,
  valid_from date, notes text);

-- The supplier of each row: matched on code first, then on name (as the setup above matched it).
alter table cfi_rows add column supplier_id uuid;
update cfi_rows r set supplier_id = (
  select s.id from scm.suppliers s where s.company_id = ${COMPANY}
     and (upper(s.code) = upper(r.sup_code) or upper(trim(s.name)) = upper(r.sup_name))
   order by (upper(s.code) = upper(r.sup_code)) desc limit 1);

-- Every SKU belongs to a model of its own (model_code = SKU code), as the API's create paths do.
insert into scm.product_models (company_id, model_code, name, category, branding)
select ${COMPANY}, r.code, r.name, r.category::scm.mfg_product_category, r.branding from cfi_rows r
on conflict (company_id, model_code, category) do nothing;

-- Works and Service need no photo; the other groups are held Inactive by the photo rule (migration 0062) anyway.
insert into scm.mfg_products (id, company_id, code, name, category, sub_category, uom, status, cost_price_sen, description, branding, model_id)
select r.id, ${COMPANY}, r.code, r.name, r.category::scm.mfg_product_category, r.sub_category, r.uom, r.status::scm.mfg_product_status,
       r.cost, r.description, r.branding, m.id
  from cfi_rows r
  left join scm.product_models m on m.company_id = ${COMPANY} and m.model_code = r.code and m.category::text = r.category
on conflict (company_id, code) do nothing;

-- One link per supplier and SKU; main only where the SKU has no main supplier yet (uq_smb_one_main).
insert into scm.supplier_material_bindings
    (company_id, supplier_id, material_kind, item_code, material_name, supplier_sku, unit_price_sen, price_valid_from, is_main_supplier, notes)
select ${COMPANY}, r.supplier_id, 'mfg_product', r.code, r.name, r.supplier_sku, r.cost, r.valid_from,
       not exists (select 1 from scm.supplier_material_bindings b where b.company_id = ${COMPANY} and b.material_kind = 'mfg_product'
                                                                    and b.item_code = r.code and b.is_main_supplier),
       r.notes
  from cfi_rows r
 where not exists (select 1 from scm.supplier_material_bindings b where b.company_id = ${COMPANY} and b.material_kind = 'mfg_product'
                                                                   and b.item_code = r.code and b.supplier_id = r.supplier_id);

-- The cost with its document date, once per supplier, SKU and date.
insert into scm.supplier_binding_price_history
    (company_id, supplier_id, material_kind, item_code, unit_price_sen, is_main_supplier, effective_from, notes, created_by, applied_at)
select ${COMPANY}, r.supplier_id, 'mfg_product', r.code, r.cost, b.is_main_supplier, r.valid_from, r.notes, ${lit(RUN_TAG)}, now()
  from cfi_rows r
  join scm.supplier_material_bindings b on b.company_id = ${COMPANY} and b.material_kind = 'mfg_product'
                                       and b.item_code = r.code and b.supplier_id = r.supplier_id
 where r.valid_from is not null
   and not exists (select 1 from scm.supplier_binding_price_history h where h.company_id = ${COMPANY} and h.supplier_id = r.supplier_id
                                                                       and h.material_kind = 'mfg_product' and h.item_code = r.code
                                                                       and h.effective_from = r.valid_from);
`;
}

function countsSql(allCodes) {
  const codes = `array[${allCodes.map(lit).join(',')}]::text[]`;
  return `select
  (select count(*)::int from scm.suppliers where company_id = ${COMPANY} and notes like ${lit(`%${RUN_TAG}%`)}) as suppliers_created_by_import,
  (select count(*)::int from scm.mfg_products where company_id = ${COMPANY} and code = any(${codes})) as skus,
  (select count(*)::int from scm.supplier_material_bindings where company_id = ${COMPANY} and material_kind = 'mfg_product' and item_code = any(${codes})) as supplier_links,
  (select count(*)::int from scm.supplier_material_bindings where company_id = ${COMPANY} and material_kind = 'mfg_product' and item_code = any(${codes}) and unit_price_sen > 0) as priced_links,
  (select count(*)::int from scm.supplier_binding_price_history where company_id = ${COMPANY} and material_kind = 'mfg_product' and item_code = any(${codes})) as cost_rows,
  ${allCodes.length} as skus_expected;
`;
}

/** The import as SQL parts, each under maxBytes where it can be. Returns [{ name, sql, skus }]. */
export function buildSqlParts(data, { maxBytes = 400_000 } = {}) {
  const all = data.skus.map((k) => skuRows(data, k));
  const codes = all.map((r) => r.code);
  const fixed = Buffer.byteLength(setupSql(data) + countsSql(codes)) + 3_000;
  const chunks = []; let cur = []; let size = fixed;
  for (const r of all) {
    const n = Buffer.byteLength(JSON.stringify(r)) + 1;
    if (cur.length && size + n > maxBytes) { chunks.push(cur); cur = []; size = fixed; }
    cur.push(r); size += n;
  }
  if (cur.length) chunks.push(cur);
  return chunks.map((rows, i) => {
    const part = i + 1, of = chunks.length;
    const note = { tag: RUN_TAG, part, of, skus: rows.length, first: rows[0].code, last: rows[rows.length - 1].code, data: data.built, source: data.source };
    const sql = `-- ${RUN_TAG}: part ${part} of ${of} (${rows.length} SKUs, ${rows[0].code} .. ${rows[rows.length - 1].code}).
-- Built from docs/catalog-import/catalog-data.json by scripts/catalog-first-import.mjs. One transaction; safe to run
-- alone, in order, and again (a second run adds nothing). Target: the Conts engine database, schemas scm / public.
begin;

${setupSql(data)}
${skuSql(rows)}
insert into scm.app_config (key, value, description, company_id)
values (${lit(`${NOTE_KEY}:part-${part}`)}, ${lit(JSON.stringify(note))}, ${lit(`Import note: ${RUN_TAG}, part ${part} of ${of}`)}, ${COMPANY})
on conflict (key) do nothing;

commit;

${countsSql(codes)}`;
    return { name: `part-${String(part).padStart(2, '0')}-of-${String(of).padStart(2, '0')}.sql`, sql, skus: rows.length };
  });
}
