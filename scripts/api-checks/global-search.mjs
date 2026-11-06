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

/* ---------- VOs, delivery returns, consignment and stock documents ---------- */
const [{ id: voId }] = await sql`insert into scm.so_amendments (so_doc_no, amendment_no, reason, requested_by) values (${so}, ${`VO-${tag}-1`}, 'Add a kitchen island', ${by}) returning id`;
const returnNo = `DR-${tag}-1`;
const [{ id: returnId }] = await sql`insert into scm.delivery_returns (return_number, do_doc_no, debtor_name, phone, reason, created_by) values (${returnNo}, ${dn}, ${`Tan ${tag} Ling`}, ${phone}, 'Door scratched', ${by}) returning id`;
const coNo = `CSO-${tag}-1`;
await sql`insert into scm.consignment_sales_orders (doc_no, debtor_name, phone) values (${coNo}, ${`Tan ${tag} Ling`}, ${phone})`;
const cnNo = `CN-${tag}-1`;
const [{ id: cnId }] = await sql`insert into scm.consignment_delivery_orders (do_number, consignment_so_doc_no, debtor_name, created_by) values (${cnNo}, ${coNo}, ${`Tan ${tag} Ling`}, ${by}) returning id`;
const crNo = `CR-${tag}-1`;
const [{ id: crId }] = await sql`insert into scm.consignment_delivery_returns (return_number, do_doc_no, debtor_name, created_by) values (${crNo}, ${cnNo}, ${`Tan ${tag} Ling`}, ${by}) returning id`;
const pcNo = `PC-${tag}-1`;
const [{ id: pcId }] = await sql`insert into scm.purchase_consignment_orders (pc_number, supplier_id, created_by) values (${pcNo}, ${supplierId}, ${by}) returning id`;
const pcrNo = `PCR-${tag}-1`;
const [{ id: pcrId }] = await sql`insert into scm.purchase_consignment_receives (receive_number, pc_order_no, supplier_id, created_by) values (${pcrNo}, ${pcNo}, ${supplierId}, ${by}) returning id`;
const pctNo = `PCT-${tag}-1`;
const [{ id: pctId }] = await sql`insert into scm.purchase_consignment_returns (return_number, supplier_id, created_by) values (${pctNo}, ${supplierId}, ${by}) returning id`;
const [{ id: whA }] = await sql`insert into scm.warehouses (code, name, type) values (${`WA${tag}`}, ${`${tag} North store`}, 'warehouse') returning id`;
const [{ id: whB }] = await sql`insert into scm.warehouses (code, name, type) values (${`WB${tag}`}, ${`${tag} South store`}, 'warehouse') returning id`;
const transferNo = `ST-${tag}-1`;
const [{ id: transferId }] = await sql`insert into scm.stock_transfers (transfer_no, from_warehouse_id, to_warehouse_id) values (${transferNo}, ${whA}, ${whB}) returning id`;
const takeNo = `TK-${tag}-1`;
const [{ id: takeId }] = await sql`insert into scm.stock_takes (take_no, warehouse_id) values (${takeNo}, ${whA}) returning id`;
const adjustCode = `ADJ-${tag}`;
await sql`insert into scm.inventory_movements (movement_type, warehouse_id, item_code, product_name, qty, source_doc_type, reason_code) values ('ADJUSTMENT', ${whA}, ${adjustCode}, ${`${tag} Hinge`}, -2, 'ADJUSTMENT', 'DAMAGED')`;
// A goods movement that is not an adjustment never shows as one.
await sql`insert into scm.inventory_movements (movement_type, warehouse_id, item_code, qty, source_doc_type) values ('IN', ${whA}, ${`IN-${tag}`}, 2, 'GRN')`;

const search = async (q, role = 'management', extra = '') => {
  const r = await call('GET', `/api/search?q=${encodeURIComponent(q)}${extra}`, undefined, role);
  return { ...r, hits: Array.isArray(r.json) ? r.json : [] };
};
const has = (hits, kind, re) => hits.some(h => h.kind === kind && (!re || re.test(h.label)));

/* ---------- every kind, by a keyword ---------- */
let r = await search(tag);
check('the box answers with a list', r.status === 200 && Array.isArray(r.json), r.text.slice(0, 200));
check('no notice: the engine answered', !has(r.hits, 'notice'), JSON.stringify(r.hits.filter(h => h.kind === 'notice')));
for (const k of ['project', 'customer', 'quotation', 'sales_order', 'delivery_order', 'sales_invoice', 'purchase_order', 'grn', 'purchase_invoice', 'supplier', 'product', 'service_case',
  'vo', 'delivery_return', 'stock_transfer', 'stock_take', 'stock_adjustment']) {
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
for (const [kind, menu, path] of [
  ['vo', '/sales/amendments', `/scm/amendments/${voId}`],
  ['delivery_return', '/sales/returns', `/scm/delivery-returns/${returnId}`],
  ['stock_transfer', '/procurement/stock-transfers', `/scm/stock-transfers/${transferId}`],
  ['stock_take', '/procurement/stock-takes', `/scm/stock-takes/${takeId}`],
  ['stock_adjustment', '/procurement/adjustments', `/scm/stock-adjustments?q=${adjustCode}`],
]) check(`a ${kind} opens its own screen`, target(kind) === `${menu}?engine=${encodeURIComponent(path)}`, target(kind));
check('consignment is switched off: none of its records is offered, because they would open Home', !r.hits.some(h => /consignment/.test(h.kind)), JSON.stringify(r.hits.filter(h => /consignment/.test(h.kind))));
check('a stock movement that is not an adjustment is not found as one', !r.hits.some(h => h.kind === 'stock_adjustment' && h.label.startsWith('IN-')), JSON.stringify(r.hits.filter(h => h.kind === 'stock_adjustment')));

r = await search(`ling ${tag.toLowerCase()} skyline`);
check('words in any order, any case, across fields find the project', has(r.hits, 'project'), JSON.stringify(r.hits.map(h => h.kind)));
r = await search(`Tan ${tag}`);
check('a customer name finds the project, order and case together', has(r.hits, 'project') && has(r.hits, 'sales_order') && has(r.hits, 'service_case'), JSON.stringify(r.hits.map(h => h.kind)));

/* ---------- numbers typed any way ---------- */
for (const typed of [phoneLocal, `012-${digits.slice(0, 3)} ${digits.slice(3)}`, `+60 12 ${digits}`, `60 12${digits}`]) {
  r = await search(typed);
  check(`phone typed "${typed}" finds the project, the service case and the delivery return`, has(r.hits, 'project') && has(r.hits, 'service_case') && has(r.hits, 'delivery_return'), JSON.stringify(r.hits.map(h => h.kind)));
}
for (const [typed, kind] of [[so.replaceAll('-', ''), 'sales_order'], [so.replaceAll('-', ' ').toLowerCase(), 'sales_order'], [po.replaceAll('-', ''), 'purchase_order'], [quote.replaceAll('-', ' '), 'quotation'], [`assr ${tag} 9`, 'service_case'],
  [`vo${tag}1`.toLowerCase(), 'vo'], [returnNo.replaceAll('-', ' '), 'delivery_return'],
  [transferNo.replaceAll('-', ''), 'stock_transfer'], [takeNo.replaceAll('-', ' '), 'stock_take'], [adjustCode.replaceAll('-', ''), 'stock_adjustment']]) {
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

/* ---------- cleaning jobs, expenses, utility bills ---------- */
const stamp = now.slice(0, 10);
const month = stamp.slice(0, 7);
const guestPhoneDigits = String(Date.now() + 7).slice(-7);
const [{ id: guestId }] = await sql`insert into pos.guests (id, full_name, phone, created_at) values (${`gs-guest-${run}`}, ${`Aisha ${tag} Rahim`}, ${`+60 17-${guestPhoneDigits.slice(0, 3)} ${guestPhoneDigits.slice(3)}`}, ${now}) returning id`;
const [{ id: stayId }] = await sql`insert into pos.reservations (id, unit_id, guest_id, channel, check_in, check_out, state, created_at, updated_at)
  values (${`gs-res-${run}`}, ${anyUnit.id}, ${guestId}, 'direct', '2026-01-01', ${stamp}, 'checked_out', ${now}, ${now}) returning id`;
const [{ id: cleanerId }] = await sql`insert into pos.cleaners (id, full_name, created_at, updated_at) values (${`gs-cleaner-${run}`}, ${`Siti ${tag} Cleaner`}, ${now}, ${now}) returning id`;
const taskId = `gs-task-${run}`;
await sql`insert into pos.tasks (id, unit_id, reservation_id, kind, title, state, cleaner_id, scheduled_for, created_at, updated_at)
  values (${taskId}, ${anyUnit.id}, ${stayId}, 'turnover', 'Clean after checkout', 'open', ${cleanerId}, ${now}, ${now}, ${now})`;
await sql`insert into pos.task_cleaners (id, task_id, cleaner_id, assigned_at) values (${`gs-tc-${run}`}, ${taskId}, ${cleanerId}, ${now})`;
await sql`insert into pos.tasks (id, unit_id, kind, title, state, created_at, updated_at) values (${`gs-inspect-${run}`}, ${anyUnit.id}, 'inspection', ${`Siti ${tag} inspection`}, 'open', ${now}, ${now})`;
for (const typed of [`siti ${tag}`, `Aisha ${tag}`, `${anyUnit.name} ${tag}`, `017${guestPhoneDigits}`, `+60 17 ${guestPhoneDigits}`, anyUnit.unit_number.replace(/[^a-zA-Z0-9]/g, '')]) {
  r = await search(typed, 'management', '&kind=cleaning');
  check(`cleaning job found by "${typed}"`, r.hits.some(h => h.id === taskId), JSON.stringify(r.hits.slice(0, 3)));
}
r = await search(`siti ${tag}`);
check('a cleaning job opens that job on the board, with its cleaner and guest', r.hits.find(h => h.id === taskId)?.target === `/operations/cleaning?task=${taskId}` && /Basic clean/.test(r.hits.find(h => h.id === taskId)?.sub) && /Aisha/.test(r.hits.find(h => h.id === taskId)?.sub) && /Siti/.test(r.hits.find(h => h.id === taskId)?.sub), JSON.stringify(r.hits.find(h => h.id === taskId)));
check('an inspection is not a cleaning job', !r.hits.some(h => h.id === `gs-inspect-${run}`), JSON.stringify(r.hits));

const expenseId = `gs-exp-${run}`, billId = `gs-bill-${run}`, parentId = `gs-parent-${run}`, account = `2200-${digits}-77`;
await sql`insert into pos.expenses (id, unit_id, category, description, amount, incurred_on, deduct_month, reference, supplier_name, created_at)
  values (${expenseId}, ${anyUnit.id}, 'consumables', ${`${tag} towels`}, 1234, ${stamp}, ${month}, ${`INV-${tag}/7`}, ${`${tag} Linen Supply`}, ${now})`;
await sql`insert into pos.expenses (id, unit_id, category, description, amount, incurred_on, deduct_month, reference, created_at)
  values (${billId}, ${anyUnit.id}, 'sewerage', ${`${tag} sewer`}, 5600, ${stamp}, ${month}, ${`BILL-${tag}-8`}, ${now})`;
await sql`insert into pos.unit_utility_accounts (id, unit_id, kind, account_no, created_at, updated_at) values (${`gs-acc-${run}`}, ${anyUnit.id}, 'sewerage', ${account}, ${now}, ${now})`;
await sql`insert into pos.expenses (id, unit_id, category, description, amount, incurred_on, deduct_month, created_at) values (${parentId}, ${anyUnit.id}, 'maintenance', ${`${tag} rollup`}, 0, ${stamp}, ${month}, ${now})`;
await sql`insert into pos.expenses (id, unit_id, parent_expense_id, category, description, amount, incurred_on, deduct_month, created_at) values (${`gs-child-${run}`}, ${anyUnit.id}, ${parentId}, 'maintenance', ${`${tag} labour`}, 900, ${stamp}, ${month}, ${now})`;
for (const [typed, kind, id] of [
  [`${tag} towels`, 'expense', expenseId], [`${tag} linen`, 'expense', expenseId], [`consumables ${tag}`, 'expense', expenseId], [`inv${tag}7`.toLowerCase(), 'expense', expenseId],
  [`indah water ${tag}`, 'bill', billId], [`bill ${tag} 8`, 'bill', billId], [`2200${digits}77`, 'bill', billId], [`2200 ${digits} 77`, 'bill', billId],
]) {
  r = await search(typed, 'management', `&kind=${kind}`);
  check(`${kind} found by "${typed}"`, r.hits.some(h => h.id === id) && r.hits.every(h => h.kind === kind), JSON.stringify(r.hits.slice(0, 3)));
}
r = await search(tag);
const opened = id => `/finance/payables?view=list&month=${month}&expense=${id}`;
check('an expense opens its dialog over its month', r.hits.find(h => h.id === expenseId)?.target === opened(expenseId), JSON.stringify(r.hits.find(h => h.id === expenseId)));
check('a utility bill is a bill, not an expense, and opens the same way', r.hits.find(h => h.id === billId)?.kind === 'bill' && r.hits.find(h => h.id === billId)?.label.startsWith('Indah Water bill') && r.hits.find(h => h.id === billId)?.target === opened(billId), JSON.stringify(r.hits.find(h => h.id === billId)));
check('a rollup heading is not listed, its line is', !r.hits.some(h => h.id === parentId) && r.hits.some(h => h.id === `gs-child-${run}`), JSON.stringify(r.hits.filter(h => h.kind === 'expense')));
check('no result carries an amount', !JSON.stringify(r.hits.filter(h => ['expense', 'bill'].includes(h.kind))).match(/RM|12\.34|56\.00|1234|5600/), JSON.stringify(r.hits.filter(h => ['expense', 'bill'].includes(h.kind))));
const one = await call('GET', `/api/expenses/${billId}`);
check('GET one expense answers what the dialog needs', one.status === 200 && one.json?.amount === 5600 && one.json?.category === 'sewerage' && one.json?.unitId === anyUnit.id, one.text);
check('GET an expense that is gone: 404', (await call('GET', '/api/expenses/gs-nothing')).status === 404);
check('operations staff cannot read one expense', (await call('GET', `/api/expenses/${billId}`, undefined, 'operations_staff')).status === 403);
r = await search(tag, 'finance_admin');
check('finance finds expenses and bills', has(r.hits, 'expense') && has(r.hits, 'bill'), JSON.stringify([...new Set(r.hits.map(h => h.kind))]));
r = await search(tag, 'operations_staff');
check('operations staff find cleaning jobs, not expenses or bills', has(r.hits, 'cleaning') && !has(r.hits, 'expense') && !has(r.hits, 'bill'), JSON.stringify([...new Set(r.hits.map(h => h.kind))]));

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
for (const k of ['scSales', 'scProcurement', 'scInvoices', 'serviceCases', 'projects', 'scConsignment', 'scWarehouse']) await setLevel(k, 'none');
await setLevel('scSales', 'view');
await sleep(11_000);
r = await search(tag, 'operations_staff');
check('staff with Sales only find sales records', has(r.hits, 'sales_order') && has(r.hits, 'quotation') && has(r.hits, 'delivery_order') && has(r.hits, 'vo') && has(r.hits, 'delivery_return'), JSON.stringify([...new Set(r.hits.map(h => h.kind))]));
check('...and no projects, service cases, purchase orders, invoices, suppliers, consignment or stock documents', !['project', 'service_case', 'purchase_order', 'grn', 'sales_invoice', 'purchase_invoice', 'supplier', 'consignment_order', 'consignment_note', 'consignment_return', 'purchase_consignment_order', 'purchase_consignment_receive', 'purchase_consignment_return', 'stock_transfer', 'stock_take', 'stock_adjustment'].some(k => has(r.hits, k)), JSON.stringify([...new Set(r.hits.map(h => h.kind))]));
check('a customer with no Projects access opens Sales orders instead', r.hits.find(h => h.kind === 'customer')?.target === '/sales/orders', JSON.stringify(r.hits.find(h => h.kind === 'customer')));
await setLevel('scSales', 'none');
await setLevel('scConsignment', 'view');
await sleep(11_000);
r = await search(tag, 'operations_staff');
check('staff with Consignment only find no stock documents or sales orders', !has(r.hits, 'stock_take') && !has(r.hits, 'sales_order'), JSON.stringify([...new Set(r.hits.map(h => h.kind))]));
await setLevel('scConsignment', 'none');
await setLevel('scWarehouse', 'view');
await sleep(11_000);
r = await search(tag, 'operations_staff');
check('staff with Warehouse only find stock documents and no consignment documents', has(r.hits, 'stock_transfer') && has(r.hits, 'stock_take') && has(r.hits, 'stock_adjustment') && !has(r.hits, 'consignment_order'), JSON.stringify([...new Set(r.hits.map(h => h.kind))]));
await setLevel('scWarehouse', 'none');
await setLevel('reservations', 'none');
await sleep(11_000);
r = await search(tag, 'operations_staff');
check('no supply chain area at all: no supply chain results and no notice', !r.hits.some(h => !['unit', 'building', 'maintenance', 'cleaning', 'owner'].includes(h.kind)), JSON.stringify([...new Set(r.hits.map(h => h.kind))]));
for (const k of ['scSales', 'scProcurement', 'scInvoices', 'serviceCases', 'projects', 'reservations', 'scConsignment', 'scWarehouse']) await setLevel(k, null);
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
// Consignment is switched off on Property OS's side only; the engine is ready for the day it comes back.
const reads = await (await fetch(`${ENGINE}/api/conts-search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-conts-search': statement({ aud: 'search', email, access, exp: Date.now() + 30_000 }) }, body: JSON.stringify({ q: tag, limit: 20 }) })).json();
for (const [kind, path] of [
  ['consignment_order', `/scm/consignment-orders/${coNo}`], ['consignment_note', `/scm/consignment-notes/${cnId}`], ['consignment_return', `/scm/consignment-returns/${crId}`],
  ['purchase_consignment_order', `/scm/purchase-consignment-orders/${pcId}`], ['purchase_consignment_receive', `/scm/purchase-consignment-receives/${pcrId}`], ['purchase_consignment_return', `/scm/purchase-consignment-returns/${pctId}`],
]) check(`the engine reads a ${kind} and names its screen`, reads.hits?.some(h => h.kind === kind && h.path === path), JSON.stringify(reads.hits?.filter(h => h.kind === kind)));
for (const [typed, kind] of [[coNo.replaceAll('-', ''), 'consignment_order'], [cnNo.replaceAll('-', ' ').toLowerCase(), 'consignment_note'], [crNo.replaceAll('-', ''), 'consignment_return'], [pcNo.replaceAll('-', ''), 'purchase_consignment_order'], [pcrNo.replaceAll('-', ' '), 'purchase_consignment_receive'], [pctNo.replaceAll('-', ''), 'purchase_consignment_return']]) {
  const res = await (await fetch(`${ENGINE}/api/conts-search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-conts-search': statement({ aud: 'search', email, access, exp: Date.now() + 30_000 }) }, body: JSON.stringify({ q: typed, only: kind }) })).json();
  check(`the engine finds the ${kind} typed "${typed}"`, res.hits?.length >= 1, JSON.stringify(res));
}
const noConsignment = { ...access, scConsignment: 'none' };
const closedAnswer = await (await fetch(`${ENGINE}/api/conts-search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-conts-search': statement({ aud: 'search', email, access: noConsignment, exp: Date.now() + 30_000 }) }, body: JSON.stringify({ q: tag, limit: 20 }) })).json();
check('the engine reads no consignment kind for someone without that area', !closedAnswer.hits?.some(h => /consignment/.test(h.kind)), JSON.stringify(closedAnswer.hits?.map(h => h.kind)));
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
