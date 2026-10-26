// Runs migrations-pg (incl. 0162/0163) and the two batch2 SQL files on a throwaway in-memory PGlite, twice, and
// prints the counts: the second run must add nothing. The suppliers the balance file names are stubbed first,
// because the demo data has none of Conts's real suppliers.
//   node docs/catalog-import/batch2/check-local.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const { PGlite } = await import('@electric-sql/pglite');
const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
const pg = new PGlite({ extensions: { pg_trgm } });
for (const role of ['anon', 'authenticated', 'service_role']) {
  await pg.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`);
}
await pg.exec('create schema if not exists extensions');
for (const f of readdirSync(join(root, 'migrations-pg')).filter((x) => x.endsWith('.sql')).sort()) {
  try { await pg.exec(`begin;\n${readFileSync(join(root, 'migrations-pg', f), 'utf8')}\ncommit;`); }
  catch (e) { await pg.exec('rollback').catch(() => {}); if (f >= '0162') throw new Error(`${f}: ${e.message}`); }
}
const company = (await pg.query(`select id from public.companies where code = 'HOUZS'`)).rows;
if (company.length !== 1) await pg.exec(`insert into public.companies (code, name) values ('HOUZS', 'The Conts (local)')`);
const stubs = [['400-S002', 'Shopee'], ['400-I001', 'IKEA'], ['400-Z001', 'ZOE HOME SDN BHD'], ['400-U001', 'UJU HOME'],
  ['400-V001', 'VIP HOSPITALITY SUPPLIES SDN BHD'], ['400-0002', 'HLK (CHAIN-STORE) SDN BHD'], ['400-O003', 'ONE LIVING SDN BHD'],
  ['400-S001', 'SINCERE ZONE ELECTRONICS (M) SDN BHD'], ['400-C004', 'CARRESS SDN BHD'], ['400-H003', 'HOUZS CENTURY SDN BHD']];
for (const [code, name] of stubs) {
  await pg.query(`insert into scm.suppliers (company_id, code, name) select id, $1, $2 from public.companies where code = 'HOUZS'
                  on conflict do nothing`, [code, name]);
}
for (const run of [1, 2]) {
  for (const f of ['batch2-a-balance.sql', 'batch2-b-so-codes.sql']) {
    const res = await pg.exec(readFileSync(join(here, f), 'utf8'));
    console.log(`run ${run} ${f}:`, JSON.stringify(res.at(-1).rows[0]));
  }
}
const g = await pg.query(`select category_group, sub_category, count(*)::int n, sum((status = 'ACTIVE')::int)::int active
                            from scm.mfg_products where code like any (array['ELE-%','AIB-%','CON-%','SIG-%','FIX-%','LIN-%','DEC-%','SRV-%'])
                           group by 1, 2 order by 1, 2`);
console.table(g.rows);
const m = await pg.query(`select count(*)::int links, sum(is_main_supplier::int)::int mains, sum((unit_price_sen > 0)::int)::int priced
                            from scm.supplier_material_bindings where notes like 'sku-batch2%'`);
console.log('links', m.rows[0]);
await pg.close();
