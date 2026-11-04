// The one search box (owner, 3 Nov 2026: "search any keyword - customer name, project name, etc."): GET /api/search finds
// rental and supply chain records of every kind, with phone and document numbers typed any way, and each person finds
// only the kinds their access opens. Also the Service Cases list search by project, and the engine's refusal of a
// statement that is not its own. Writes "GS<run>" records into the database it is pointed at, so localhost only.
//
//   a local Postgres built by scripts/ci-api-db.mjs (PGlite will not do: one session, one search_path, so the engine's users
//   and Property OS's users collide)
//   engine: wrangler dev in engine/backend, CONTS_SSO_SECRET in its .dev.vars
//   Property OS: wrangler pages dev dist, SCM_ENGINE_API at that engine and SCM_ENGINE_SSO_SECRET the same secret in .dev.vars
//   DB_URL=postgres://postgres@127.0.0.1:5432/ci API_BASE=http://localhost:18794 ENGINE=http://127.0.0.1:18793 node scripts/api-checks/global-search.mjs
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import { call, callAsUser, check, done } from './harness.mjs';

const url = process.env.DB_URL ?? '';
const ENGINE = process.env.ENGINE ?? '';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) { console.error('Refusing: DB_URL must point at localhost.'); process.exit(1); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(ENGINE)) { console.error('Refusing: ENGINE must be a local engine.'); process.exit(1); }
const sql = postgres(url, { max: 1, onnotice: () => {} });
const run = Date.now().toString(36).slice(-5).toUpperCase();
const tag = `GS${run}`;
const digits = String(Date.now()).slice(-7);
const phone = `+60 12-${digits.slice(0, 3)} ${digits.slice(3)}`;
const phoneLocal = `012${digits}`;
const uuid = async () => (await sql`select gen_random_uuid() as id`)[0].id;

/* ---------- a project and one record of every supply chain kind ---------- */
let by = (await sql`select id from scm.staff limit 1`)[0]?.id;
if (!by) {
  by = await uuid();
  await sql`insert into scm.staff (id, staff_code, name, role, initials, color) values (${by}, ${`S${run}`}, 'Search check', ${(await sql`select enum_range(null::scm.staff_role)::text[] as r`)[0].r[0]}, 'SC', 'grey')`;
}
const [{ id: projectId }] = await sql`insert into public.projects (name, stage, code, project_kind, customer_name, customer_phone, building, unit_no)
  values (${`${tag} Kitchen`}, 'new', ${`PR-${tag}-7`}, 'renovation', ${`Tan ${tag} Ling`}, ${phone}, ${`Skyline${tag}`}, 'A-12-03') returning id`;
const supplierId = await uuid();
await sql`insert into scm.suppliers (id, code, name, phone) values (${supplierId}, ${`SUP${tag}`}, ${`${tag} Timber`}, '03-1234 5678')`;
await sql`insert into scm.customers (name, phone) values (${`Tan ${tag} Ling`}, ${phone})`;
const so = `SO-${tag}-001`;
await sql`insert into scm.mfg_sales_orders (doc_no, debtor_name, phone, project_id) values (${so}, ${`Tan ${tag} Ling`}, ${phone}, ${projectId})`;
const quote = `QT-${tag}-1`;
await sql`insert into scm.reno_quotations (quote_no, project_id) values (${quote}, ${projectId})`;
const po = `PO-${tag}-2`; const poId = await uuid();
await sql`insert into scm.purchase_orders (id, po_number, supplier_id, created_by) values (${poId}, ${po}, ${supplierId}, ${by})`;
const grn = `GRN-${tag}-3`;
await sql`insert into scm.grns (grn_number, supplier_id, purchase_order_id, created_by) values (${grn}, ${supplierId}, ${poId}, ${by})`;
const dn = `DO-${tag}-4`;
await sql`insert into scm.delivery_orders (do_number, debtor_name, so_doc_no, created_by) values (${dn}, ${`Tan ${tag} Ling`}, ${so}, ${by})`;
const si = `SI-${tag}-5`;
await sql`insert into scm.sales_invoices (invoice_number, debtor_name, so_doc_no, created_by) values (${si}, ${`Tan ${tag} Ling`}, ${so}, ${by})`;
const pi = `PI-${tag}-6`;
await sql`insert into scm.purchase_invoices (invoice_number, supplier_id, created_by) values (${pi}, ${supplierId}, ${by})`;
const productCode = `SKU-${tag}`;
const [cat] = await sql`select category, category_group, sub_category from scm.mfg_products where sub_category is not null limit 1`;
await sql`insert into scm.mfg_products (id, code, name, description, category, category_group, sub_category, status)
  values (${`p-${tag}`}, ${productCode}, ${`${tag} Hinge`}, 'Soft close', ${cat.category}, ${cat.category_group}, ${cat.sub_category}, 'ACTIVE')`;
const assrNo = `ASSR/${tag}-9`;
const [{ id: caseId }] = await sql`insert into public.assr_cases (assr_no, doc_no, stage, customer_name, phone, complaint_issue, project_id)
  values (${assrNo}, ${so}, 'new', ${`Tan ${tag} Ling`}, ${phoneLocal}, 'Cabinet door loose', ${projectId}) returning id`;

const search = async (q, role = 'management', extra = '') => {
  const r = await call('GET', `/api/search?q=${encodeURIComponent(q)}${extra}`, undefined, role);
  return { ...r, hits: Array.isArray(r.json) ? r.json : [] };
};
const has = (hits, kind, re) => hits.some(h => h.kind === kind && (!re || re.test(h.label)));

/* ---------- every kind, by a keyword ---------- */
let r = await search(tag);
check('the box answers with a list', r.status === 200 && Array.isArray(r.json), r.text.slice(0, 200));
check('no notice: the engine answered', !has(r.hits, 'notice'), JSON.stringify(r.hits.filter(h => h.kind === 'notice')));
for (const k of ['project', 'customer', 'quotation', 'sales_order', 'delivery_order', 'sales_invoice', 'purchase_order', 'grn', 'purchase_invoice', 'supplier', 'product', 'service_case']) {
  check(`"${tag}" finds a ${k}`, has(r.hits, k), JSON.stringify([...new Set(r.hits.map(h => h.kind))]));
}
check('dates arrive as calendar days of this year or later', r.hits.filter(h => h.date).length >= 5 && r.hits.filter(h => h.date).every(h => /^20[2-9]\d-\d{2}-\d{2}/.test(h.date) && h.date.slice(0, 4) >= '2026'), JSON.stringify(r.hits.map(h => h.date)));
check('every result opens something', r.hits.every(h => h.target && h.label), JSON.stringify(r.hits.find(h => !h.target)));
const target = k => r.hits.find(h => h.kind === k)?.target ?? '';
check('a project opens inside the Projects screen', target('project') === `/projects/list?engine=${encodeURIComponent(`/beta/projects/${projectId}`)}`, target('project'));
check('a sales order opens inside Sales orders', target('sales_order').startsWith('/sales/orders?engine='), target('sales_order'));
check('a service case opens inside Service cases', target('service_case') === `/service/cases?engine=${encodeURIComponent(`/assr/${caseId}`)}`, target('service_case'));
check('a goods receipt opens inside Goods receipt', target('grn').startsWith('/procurement/goods-received?engine='), target('grn'));
check('a customer opens their projects', decodeURIComponent(target('customer')).includes('/beta/projects?q='), target('customer'));

r = await search(`ling ${tag.toLowerCase()} skyline`);
check('words in any order, any case, across fields find the project', has(r.hits, 'project'), JSON.stringify(r.hits.map(h => h.kind)));
r = await search(`Tan ${tag}`);
check('a customer name finds the project, order and case together', has(r.hits, 'project') && has(r.hits, 'sales_order') && has(r.hits, 'service_case'), JSON.stringify(r.hits.map(h => h.kind)));

/* ---------- numbers typed any way ---------- */
for (const typed of [phoneLocal, `012-${digits.slice(0, 3)} ${digits.slice(3)}`, `+60 12 ${digits}`, `60 12${digits}`]) {
  r = await search(typed);
  check(`phone typed "${typed}" finds the project and the service case`, has(r.hits, 'project') && has(r.hits, 'service_case'), JSON.stringify(r.hits.map(h => h.kind)));
}
for (const [typed, kind] of [[so.replaceAll('-', ''), 'sales_order'], [so.replaceAll('-', ' ').toLowerCase(), 'sales_order'], [po.replaceAll('-', ''), 'purchase_order'], [quote.replaceAll('-', ' '), 'quotation'], [`assr ${tag} 9`, 'service_case']]) {
  r = await search(typed);
  check(`document number typed "${typed}" finds the ${kind}`, has(r.hits, kind), JSON.stringify(r.hits.map(h => h.kind)));
}

/* ---------- rental records ---------- */
const unit = (await sql`select u.id, u.unit_number, p.name from pos.units u join pos.properties p on p.id = u.property_id where u.unit_number ~ '[-]' order by u.unit_number limit 1`)[0];
const anyUnit = unit ?? (await sql`select u.id, u.unit_number, p.name from pos.units u join pos.properties p on p.id = u.property_id limit 1`)[0];
r = await search(anyUnit.name);
check('a building name finds the building and its units', has(r.hits, 'building') && has(r.hits, 'unit'), JSON.stringify(r.hits.map(h => h.kind)));
if (unit) {
  r = await search(unit.unit_number.replace(/[^a-zA-Z0-9]/g, ''));
  check(`unit ${unit.unit_number} found without its marks`, r.hits.some(h => h.kind === 'unit' && h.id === unit.id), JSON.stringify(r.hits.slice(0, 3)));
}
const now = new Date().toISOString();
const jobId = `gs-job-${run}`;
await sql`insert into pos.maintenance_issues (id, unit_id, title, reported_at, created_at, updated_at) values (${jobId}, ${anyUnit.id}, ${`${tag} leaking tap`}, ${now}, ${now}, ${now})`;
r = await search(`${tag} tap`);
check('a maintenance job is found and opens the job', has(r.hits, 'maintenance') && r.hits.find(h => h.kind === 'maintenance').target === `/operations/maintenance?id=${jobId}`, JSON.stringify(r.hits));

/* ---------- See all ---------- */
for (let i = 0; i < 7; i++) await sql`insert into scm.suppliers (id, code, name) values (${await uuid()}, ${`SP${tag}${i}`}, ${`${tag} Glass ${i}`})`;
r = await search(`${tag} Glass`);
check('six of a kind are sent when there are more (the box shows five, then See all)', r.hits.filter(h => h.kind === 'supplier').length === 6, r.hits.length);
r = await search(`${tag} Glass`, 'management', '&kind=supplier');
check('See all lists them all, and that kind alone', r.hits.filter(h => h.kind === 'supplier').length === 7 && r.hits.every(h => h.kind === 'supplier'), JSON.stringify(r.hits.map(h => h.kind)));

/* ---------- each person finds only what they may open ---------- */
r = await search(tag, 'housekeeper');
check('a cleaner is refused', r.status === 403, r.status);
r = await search(tag, 'technician');
check('a technician is refused', r.status === 403, r.status);
const owner = (await sql`select id, email, full_name from pos.users where role = 'owner' limit 1`)[0];
if (owner) {
  const o = await callAsUser({ userId: owner.id, email: owner.email, role: 'owner', fullName: owner.full_name }, 'GET', `/api/search?q=${tag}`);
  check('an owner is refused', o.status === 403, o.status);
}
const pos = (await sql`select position_id, department_id from pos.users where email = 'weiwen@theconts.com'`)[0];
const setLevel = (key, level) => call('PUT', '/api/users/access', { changes: [{ scope: 'position', scopeId: pos.position_id, key, level }] });
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
// Operations sits on The Conts side, which closes the supply chain; for this check it works on both, put back below.
const [sides] = await sql`select d.side as department, u.side as person from pos.users u join pos.departments d on d.id = u.department_id where u.email = 'weiwen@theconts.com'`;
await sql`update pos.departments set side = 'both' where id = ${pos.department_id}`;
await sql`update pos.users set side = 'both' where email = 'weiwen@theconts.com'`;
for (const k of ['scSales', 'scProcurement', 'scInvoices', 'serviceCases', 'projects']) await setLevel(k, 'none');
await setLevel('scSales', 'view');
await sleep(11_000);
r = await search(tag, 'operations_staff');
check('staff with Sales only find sales records', has(r.hits, 'sales_order') && has(r.hits, 'quotation') && has(r.hits, 'delivery_order'), JSON.stringify([...new Set(r.hits.map(h => h.kind))]));
check('...and no projects, service cases, purchase orders, invoices or suppliers', !['project', 'service_case', 'purchase_order', 'grn', 'sales_invoice', 'purchase_invoice', 'supplier'].some(k => has(r.hits, k)), JSON.stringify([...new Set(r.hits.map(h => h.kind))]));
check('a customer with no Projects access opens Sales orders instead', r.hits.find(h => h.kind === 'customer')?.target === '/sales/orders', JSON.stringify(r.hits.find(h => h.kind === 'customer')));
await setLevel('scSales', 'none');
await setLevel('reservations', 'none');
await sleep(11_000);
r = await search(tag, 'operations_staff');
check('no supply chain area at all: no supply chain results and no notice', !r.hits.some(h => !['unit', 'building', 'maintenance', 'owner'].includes(h.kind)), JSON.stringify([...new Set(r.hits.map(h => h.kind))]));
for (const k of ['scSales', 'scProcurement', 'scInvoices', 'serviceCases', 'projects', 'reservations']) await setLevel(k, null);
await sql`update pos.departments set side = ${sides.department} where id = ${pos.department_id}`;
await sql`update pos.users set side = ${sides.person} where email = 'weiwen@theconts.com'`;

/* ---------- the engine takes only its own statement ---------- */
const secret = readFileSync(new URL('../../engine/backend/.dev.vars', import.meta.url), 'utf8').match(/^CONTS_SSO_SECRET\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
const b64 = (v) => Buffer.from(v).toString('base64url');
const statement = (payload, key = secret) => { const body = b64(JSON.stringify(payload)); return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`; };
const access = Object.fromEntries(['scSales', 'scInvoices', 'scConsignment', 'scProcurement', 'scTransportPlan', 'scWarehouse', 'serviceCases', 'projects'].map(k => [k, 'full']));
const ask = (token) => fetch(`${ENGINE}/api/conts-search`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-conts-search': token } : {}) }, body: JSON.stringify({ q: tag }) });
await call('POST', '/api/supply-chain/engine-session');
const email = 'management@theconts.com';
check('no statement: refused', (await ask()).status === 401);
check('a claims statement: refused', (await ask(statement({ aud: 'claims', email, access, exp: Date.now() + 30_000 }))).status === 401);
check('a sign-on statement: refused', (await ask(statement({ email, name: 'x', role: 'management', access, exp: Date.now() + 30_000 }))).status === 401);
check('the wrong secret: refused', (await ask(statement({ aud: 'search', email, access, exp: Date.now() + 30_000 }, 'y'.repeat(64)))).status === 401);
const okRes = await ask(statement({ aud: 'search', email, access, exp: Date.now() + 30_000 }));
check('its own statement: answered', okRes.status === 200, okRes.status);
check('no account yet: says so, and Property OS signs on first', (await ask(statement({ aud: 'search', email: `nobody-${run}@theconts.com`, access, exp: Date.now() + 30_000 }))).status === 409);

/* ---------- the Service Cases list finds a case by its project ---------- */
const session = await call('POST', '/api/supply-chain/engine-session');
const listed = async (q) => {
  const res = await fetch(`${ENGINE}/api/assr?search=${encodeURIComponent(q)}`, { headers: { authorization: `Bearer ${session.json?.token}` } });
  const body = await res.json().catch(() => null);
  return { status: res.status, ids: (body?.data ?? []).map(x => Number(x.id)) };
};
for (const q of [`PR-${tag}`, `${tag} Kitchen`, `Skyline${tag}`, `Tan ${tag}`, so, phoneLocal, `+60 12 ${digits}`]) {
  const l = await listed(q);
  check(`Service Cases search "${q}" finds the case`, l.status === 200 && l.ids.includes(Number(caseId)), JSON.stringify(l));
}

await sql.end();
done();
