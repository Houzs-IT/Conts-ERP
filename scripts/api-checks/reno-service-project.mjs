// Service cases raised against a renovation PROJECT, not an SO (owner, 15 Oct 2026: "It shouldn't look up the SO,
// it should look up the PROJECT"), through a local engine's HTTP API: renovation mode is seen by the service-case
// screens with the item categories -> the project picker finds a project by code, name, building, unit, customer and
// phone -> a case created with only a project takes the project's customer, phone, email and address and is linked
// to it -> a project with a sales order carries that SO on the case without anyone picking it -> the list and the
// detail show the project, the project page lists the case and the picker counts it -> bad project ids are refused
// -> a case raised the Houzs way (an SO doc no, no project) still works.
//
// Runs against a local engine (wrangler dev on :8790 in engine/backend) with its CONTS_SSO_SECRET from
// engine/backend/.dev.vars, like reno-customer-property.mjs. It WRITES two projects, one sales order and three
// service cases named "TEST SC <run>" into whatever database that engine points at. Never point it at production;
// refuses any ENGINE that is not localhost. Needs migrations 0081 and 0115 and one ACTIVE product.
//
// Run: node scripts/api-checks/reno-service-project.mjs
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ENGINE = process.env.ENGINE ?? 'http://localhost:8790';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(ENGINE)) { console.error(`ENGINE must be a local engine, not ${ENGINE}`); process.exit(1); }
const secret = readFileSync(new URL('../../engine/backend/.dev.vars', import.meta.url), 'utf8').match(/^CONTS_SSO_SECRET\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
if (!secret) { console.error('CONTS_SSO_SECRET not found in engine/backend/.dev.vars'); process.exit(1); }
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const AREAS = ['scSales', 'scInvoices', 'scConsignment', 'scProcurement', 'scTransportPlan', 'scWarehouse', 'serviceCases', 'projects'];
const run = Date.now().toString(36).slice(-5).toUpperCase();

let fails = 0;
let passes = 0;
const check = (name, ok, extra = '') => { if (ok) passes++; else fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' :: ' + extra}`); return ok; };
const show = (r) => `${r.status} ${JSON.stringify(r.json).slice(0, 400)}`;
const stop = (why) => { console.log(`\nstopped: ${why}\n${passes} passed, ${fails} failed`); process.exit(1); };

const body = b64url(JSON.stringify({ email: 'reno-sc-check@theconts.test', name: 'Service case check', role: 'management', access: Object.fromEntries(AREAS.map((k) => [k, 'full'])), exp: Date.now() + 45_000 }));
const sso = await fetch(`${ENGINE}/api/conts-sso`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assertion: `${body}.${b64url(createHmac('sha256', secret).update(body).digest())}` }) });
const token = (await sso.json().catch(() => ({}))).token;
if (!check('sign on to the engine', sso.status === 200 && !!token, `${sso.status}`)) stop('no session');

async function call(method, path, payload) {
  const r = await fetch(ENGINE + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
const R = '/api/renovation';
const A = '/api/assr';
const caseOf = async (id) => (await call('GET', `${A}/${id}`)).json?.case ?? {};

/* ---------- renovation mode, as the service-case screens see it ---------- */
let r = await call('GET', `${A}/renovation/context`);
if (!check('the service-case screens see renovation mode', r.status === 200 && r.json?.renovation === true, show(r))) stop('not renovation mode');
const builtin = r.json.categories.find((g) => g.code === 'BUILTIN');
check('with the renovation item categories and their sub-categories (Built-in / Wardrobe)', !!builtin && builtin.subs.some((s) => s.code === 'WARDROBE'), show(r));

/* ---------- two projects: one without an SO, one with ---------- */
const staffR = await call('GET', '/api/scm/staff/pickable');
const sales = (staffR.json?.staff ?? []).find((x) => x.active && x.staffCode !== 'SYSTEM')?.id;
if (!check('an employee to use as salesperson', !!sales, show(staffR))) stop('no staff');
const info = (n, over = {}) => ({
  customerName: `TEST SC Customer ${n} ${run}`, customerPhone: n === 'A' ? '+60177001234' : '+60188005678', customerEmail: `sc-${n.toLowerCase()}@example.test`,
  salespersonId: sales, address1: `${n}-8-2 TEST Harmoni ${run}`, address2: 'Jalan Cheras', state: 'Selangor', city: 'Cheras', postcode: '56000',
  country: 'Malaysia', salesLocation: 'TESTWH', building: `TEST SC Harmoni ${run}`, unitNo: `${n}-8-2`, propertyType: 'Condo',
  layoutLabel: '3 bed 2 bath', bedrooms: 3, bathrooms: 2, builtUpSqft: '1100', ...over,
});
const types = await call('GET', `${R}/types`);
const type = types.json?.data?.find((t) => t.slug === 'full_renovation') ?? types.json?.data?.[0];
r = await call('POST', R, { projectTypeId: type?.id, customerInfo: info('A') });
if (!check('project A (no sales order) created', r.status === 201, show(r))) stop('no project A');
const pA = r.json.id;
r = await call('POST', R, { projectTypeId: type?.id, customerInfo: info('B') });
if (!check('project B created', r.status === 201, show(r))) stop('no project B');
const pB = r.json.id;

const prod = await call('GET', '/api/scm/mfg-products?status=ACTIVE&limit=5');
const productList = prod.json?.products ?? prod.json?.data ?? prod.json?.items ?? (Array.isArray(prod.json) ? prod.json : []);
const product = productList.find((x) => x.code);
if (!check('an active product to put on project B\'s order', !!product, show(prod))) stop('no product');
const line = { itemGroup: product.category ?? 'RENOVATION', itemCode: product.code, description: product.name ?? product.code, uom: 'UNIT', qty: 1, unitPriceSen: 10000, discountSen: 0, unitCostSen: 0 };
r = await call('POST', '/api/scm/mfg-sales-orders', {
  debtorName: `TEST SC Customer B ${run}`, phone: '+60188005678', salespersonId: sales, address1: `B-8-2 TEST Harmoni ${run}`, address2: 'Jalan Cheras',
  customerState: 'Selangor', city: 'Cheras', postcode: '56000', items: [line], noFair: true,
  renovation: { projectId: pB, building: `TEST SC Harmoni ${run}`, unitNo: 'B-8-2', propertyType: 'Condo', layoutLabel: '3 bed 2 bath', bedrooms: '3', bathrooms: '2', builtUpSqft: '1100' },
});
const soB = r.json?.docNo ?? r.json?.doc_no ?? r.json?.data?.docNo ?? r.json?.salesOrder?.docNo;
if (!check('project B gets a sales order', (r.status === 200 || r.status === 201) && !!soB, show(r))) stop('no SO for B');

/* ---------- the project picker ---------- */
const pick = async (q) => (await call('GET', `${A}/renovation/projects?q=${encodeURIComponent(q)}`)).json?.data ?? [];
let hits = await pick(`TEST SC Harmoni ${run}`);
const hitA = hits.find((x) => x.id === pA);
check('the picker finds both projects by building', hits.some((x) => x.id === pA) && hits.some((x) => x.id === pB), JSON.stringify(hits).slice(0, 300));
check('a hit carries code, name and customer (with phone, email, address)', !!hitA?.code && hitA.name === `TEST SC Harmoni ${run} A-8-2`
  && hitA.customerName === `TEST SC Customer A ${run}` && hitA.customerPhone === '+60177001234' && hitA.customerEmail === 'sc-a@example.test'
  && hitA.address1 === `A-8-2 TEST Harmoni ${run}` && hitA.postcode === '56000', JSON.stringify(hitA));
check('project A has no SO, project B carries its own', hitA?.soDocNo === '' && hits.find((x) => x.id === pB)?.soDocNo === soB, JSON.stringify(hits).slice(0, 400));
check('found by its code', (await pick(hitA.code)).some((x) => x.id === pA));
check('found by customer name (any case)', (await pick(`test sc customer a ${run}`)).map((x) => x.id).join() === String(pA));
check('found by phone typed with spaces and dashes', (await pick('017-700 1234')).some((x) => x.id === pA));
check('found by unit no', (await pick('A-8-2')).some((x) => x.id === pA));
check('a search that matches nothing finds nothing', (await pick(`NOPE ${run} XYZ`)).length === 0);

/* ---------- a case from project A (no SO) ---------- */
const base = { complaint_issue: `TEST SC ${run} wardrobe door hinge loose`, issue_category: 'Defect', items: [] };
r = await call('POST', A, { ...base, project_id: pA, doc_no: '', customer_email: null, service_category: ['Built-in / Wardrobe'] });
if (!check('a case with only a project is created (201), no SO needed', r.status === 201 && !!r.json?.id, show(r))) stop('no case A');
const cA = r.json.id;
let c = await caseOf(cA);
check('it is linked to the project, with its code and name', Number(c.project_id) === pA && c.project_code === hitA.code && c.project_name === hitA.name, JSON.stringify(c).slice(0, 300));
check('it takes the project\'s customer, phone and email', c.customer_name === `TEST SC Customer A ${run}` && c.phone === '+60177001234' && c.customer_email === 'sc-a@example.test', JSON.stringify(c).slice(0, 300));
check('and the site address as four lines', c.addr1 === `A-8-2 TEST Harmoni ${run}` && c.addr2 === 'Jalan Cheras' && c.addr3 === '56000 Cheras' && c.addr4 === 'Selangor', JSON.stringify([c.addr1, c.addr2, c.addr3, c.addr4]));
check('no SO and no Ref No are made up', c.doc_no === '' && c.ref_no == null, JSON.stringify({ doc_no: c.doc_no, ref_no: c.ref_no }));
check('the item category is the renovation one', c.service_category === 'Built-in / Wardrobe', c.service_category);

/* ---------- a case from project B (has an SO) ---------- */
r = await call('POST', A, { ...base, project_id: pB, doc_no: '', customer_email: 'typed@example.test' });
if (!check('a case for project B is created (201)', r.status === 201, show(r))) stop('no case B');
const cB = r.json.id;
c = await caseOf(cB);
check('the project\'s SO rides along on the case without being picked', c.doc_no === soB && Number(c.project_id) === pB, JSON.stringify({ doc_no: c.doc_no, project_id: c.project_id }));
check('an email typed on the form wins over the project\'s', c.customer_email === 'typed@example.test', c.customer_email);

/* ---------- where the project shows ---------- */
r = await call('GET', `${A}?search=${encodeURIComponent(`TEST SC ${run}`)}&per_page=50`);
const rowA = (r.json?.data ?? []).find((x) => Number(x.id) === cA);
check('the service case list carries the project code and name', rowA?.project_code === hitA.code && rowA?.project_name === hitA.name, show(r));
r = await call('GET', `${R}/${pA}`);
check('the project page lists the case', r.status === 200 && (r.json?.serviceCases ?? []).some((x) => Number(x.id) === cA), show(r));
check('the picker now counts 1 open case on project A', (await pick(hitA.code)).find((x) => x.id === pA)?.openCaseCount === 1);

/* ---------- refusals ---------- */
r = await call('POST', A, { ...base, project_id: 99999999, doc_no: '' });
check('a project that does not exist is refused (404)', r.status === 404 && r.json?.error === 'project_not_found', show(r));
r = await call('POST', A, { ...base, project_id: 'abc', doc_no: '' });
check('a project id that is not a number is refused (400)', r.status === 400 && r.json?.error === 'project_invalid', show(r));
r = await call('POST', A, { ...base, doc_no: '' });
check('no project and no SO is still refused (400)', r.status === 400, show(r));
r = await call('POST', A, { ...base, project_id: pA, doc_no: '', issue_category: '' });
check('the issue category is still required (400)', r.status === 400, show(r));

/* ---------- the Houzs way still works ---------- */
r = await call('POST', A, { ...base, doc_no: soB });
const cH = r.json?.id;
check('a case raised with an SO doc no and no project is created (201)', r.status === 201 && !!cH, show(r));
c = cH ? await caseOf(cH) : {};
check('and is not linked to any project', c.project_id == null && c.doc_no === soB, JSON.stringify({ project_id: c.project_id, doc_no: c.doc_no }));

console.log(`\n${passes} passed, ${fails} failed (cases ${cA}, ${cB}, ${cH}; projects ${pA}, ${pB}; SO ${soB})`);
process.exit(fails ? 1 : 0);
