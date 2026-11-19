// Applies every migration up to 0345 on a throwaway in-memory PGlite, then 0346 (Hin Lim SKUs) twice, and prints the
// counts: the second run must add nothing. Two databases: one with Hin Lim already there under production's id (as
// production is), one without (as a fresh CI database is, where 0346 creates the supplier). The 9 old generic SKUs 0346
// retires are planted ACTIVE on the first database (as production has them, 19 Nov 2026); on the second one of them is
// planted INACTIVE already, to show 0346 touches only those still ACTIVE.
//   node docs/catalog-import/crm-hinlim/check-local.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const MIG = '0346_crm_hinlim_skus.sql';
const HINLIM = 'f98aa7d5-2bf3-4543-b0ff-cbbc4c5f9360';
const OLD = ['FUR-GEN-COF-HIACE', 'FUR-GEN-COF-SANDRA2', 'FUR-GEN-SIDE-HIRADO', 'FUR-GEN-DIN-AIMON', 'SOF-GEN-NEXON-3S',
  'FUR-GEN-CHAIR-CARTER', 'FUR-GEN-CHAIR-ZOLA', 'FUR-GEN-CHAIR-MACY', 'FUR-MUJ-TVCAB'];
const OLD_LIST = OLD.map((c) => `'${c}'`).join(',');
const { PGlite } = await import('@electric-sql/pglite');
const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');

async function fresh() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await pg.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`);
  }
  await pg.exec('create schema if not exists extensions');
  for (const f of readdirSync(join(root, 'migrations-pg')).filter((x) => x.endsWith('.sql') && x < MIG).sort()) {
    // 0291 needs btree_gist, which PGlite lacks; nothing here depends on it.
    try { await pg.exec(`begin;\n${readFileSync(join(root, 'migrations-pg', f), 'utf8')}\ncommit;`); }
    catch (e) { await pg.exec('rollback').catch(() => {}); if (f !== '0291_production_time_entries.sql') throw new Error(`${f}: ${e.message}`); }
  }
  return pg;
}

const counts = async (pg) => (await pg.query(`
  select (select count(*)::int from scm.mfg_products where code like '%-HLM-%') skus,
         (select count(*)::int from scm.mfg_products where code like '%-HLM-%' and status = 'ACTIVE' and category_group = 'FURNITURE'
            and model_id is not null and cost_price_sen > 0 and sell_price_sen is null and base_price_sen is null) skus_shaped,
         (select count(*)::int from scm.product_models where model_code like '%-HLM-%') models,
         (select count(*)::int from scm.supplier_material_bindings where item_code like '%-HLM-%' and supplier_id = '${HINLIM}'
            and is_main_supplier and material_kind = 'mfg_product' and supplier_sku <> '') main_links,
         (select count(*)::int from scm.supplier_binding_price_history where item_code like '%-HLM-%') price_rows,
         (select count(*)::int from scm.suppliers where code = '400-H004') hinlim_suppliers,
         (select count(*)::int from scm.app_config where key = 'note:crm-hinlim-2026-11-19') notes,
         (select count(*)::int from scm.mfg_products where code in (${OLD_LIST})) old_kept,
         (select count(*)::int from scm.mfg_products where code in (${OLD_LIST}) and status = 'INACTIVE') old_inactive,
         (select count(*)::int from scm.entity_audit_log where entity_id in (${OLD_LIST}) and action = 'deactivate') old_audit,
         (select count(*)::int from scm.mfg_products where status = 'ACTIVE' and (code like '%HIACE%' or name ilike '%hiace%')) hiace_pickable`)).rows[0];

const body = readFileSync(join(root, 'migrations-pg', MIG), 'utf8');
for (const withSupplier of [true, false]) {
  const pg = await fresh();
  if (withSupplier) {
    await pg.exec(`insert into scm.suppliers (id, company_id, code, name, status)
                   values ('${HINLIM}', 1, '400-H004', 'HIN LIM FURNITURE MANUFACTURER SDN BHD', 'ACTIVE')`);
  }
  for (const [i, code] of OLD.entries()) {
    const status = !withSupplier && i === 0 ? 'INACTIVE' : 'ACTIVE';
    await pg.exec(`insert into scm.mfg_products (id, company_id, code, name, category, category_group, sub_category, uom, status)
                   values ('old-${i}', 1, '${code}', '${code} (planted)', 'FURNITURE', 'FURNITURE', 'TABLES', 'PCS', '${status}')`);
  }
  const before = (await pg.query(`select count(*)::int n from scm.mfg_products`)).rows[0].n;
  console.log(`\n== database ${withSupplier ? 'with Hin Lim (as production)' : 'without Hin Lim (fresh)'}; SKUs before: ${before}`);
  for (const run of [1, 2]) {
    await pg.exec(`begin;\n${body}\ncommit;`);
    console.log(`after run ${run}:`, JSON.stringify(await counts(pg)));
  }
  console.table((await pg.query(`select sub_category, split_part(code, '-', 1) prefix, uom, count(*)::int n
                                   from scm.mfg_products where code like '%-HLM-%' group by 1, 2, 3 order by 1, 2, 3`)).rows);
  console.table((await pg.query(`select branding, count(*)::int n from scm.mfg_products where code like '%-HLM-%' group by 1 order by 2 desc`)).rows);
  if (withSupplier) {
    const s = (await pg.query(`select p.code, p.name, p.branding, p.cost_price_sen, p.unit_m3_milli, p.uom, p.description,
                                      b.supplier_sku, b.unit_price_sen, b.price_valid_from::text, b.notes
                                 from scm.mfg_products p join scm.supplier_material_bindings b on b.item_code = p.code
                                where p.code in ('FUR-HLM-122022', 'FUR-HLM-1409498-1409496', 'SOF-HLM-731013')`)).rows;
    console.log(JSON.stringify(s, null, 1));
  }
  await pg.close();
}
