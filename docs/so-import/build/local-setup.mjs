// Local test only: catalog (first import + batch2), stub suppliers, and the projects the import names, by id.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const W = fileURLToPath(new URL('../../..', import.meta.url)).replace(/[\/]$/, '');
const require = createRequire(W + '/engine/backend/package.json');
const postgres = require('postgres');
const sql = postgres(process.argv[2], { max: 1, prepare: false, onnotice: () => {} });
const co = await sql`select id from public.companies where code = 'HOUZS'`;
if (!co.length) await sql`insert into public.companies (code, name) values ('HOUZS', 'The Conts (local)')`;
for (const [code, name] of [['400-S002','Shopee'],['400-I001','IKEA'],['400-Z001','ZOE HOME SDN BHD'],['400-U001','UJU HOME'],['400-V001','VIP HOSPITALITY SUPPLIES SDN BHD'],['400-0002','HLK (CHAIN-STORE) SDN BHD'],['400-O003','ONE LIVING SDN BHD'],['400-S001','SINCERE ZONE ELECTRONICS (M) SDN BHD'],['400-C004','CARRESS SDN BHD'],['400-H003','HOUZS CENTURY SDN BHD']])
  await sql`insert into scm.suppliers (company_id, code, name) select id, ${code}, ${name} from public.companies where code = 'HOUZS' on conflict do nothing`;
for (const f of ['docs/catalog-import/sql/catalog-first-import.part-01-of-02.sql', 'docs/catalog-import/sql/catalog-first-import.part-02-of-02.sql', 'docs/catalog-import/batch2/batch2-a-balance.sql', 'docs/catalog-import/batch2/batch2-b-so-codes.sql']) {
  try { await sql.unsafe(readFileSync(`${W}/${f}`, 'utf8')); console.log('ok', f); } catch (e) { console.log('FAIL', f, e.message); }
}
const data = JSON.parse(readFileSync(`${W}/docs/so-import/so-notion-data.json`, 'utf8'));
const [c] = await sql`select id from public.companies where code = 'HOUZS'`;
for (const p of data.projects) if (p.projectId)
  await sql`insert into public.projects (id, code, name, stage, company_id, project_kind) overriding system value values (${p.projectId}, ${'RN-T-' + p.projectId}, ${p.project}, 'design', ${c.id}, 'renovation') on conflict (id) do nothing`;
console.log('products', (await sql`select count(*)::int n from scm.mfg_products`)[0].n, 'projects', (await sql`select count(*)::int n from public.projects`)[0].n);
await sql.end();
