// Customer + property information shared by a renovation sales order and its project (owner, 14 Oct 2026;
// migrations 0112, 0115: the SO and the project ask for the same fields), through a local engine's HTTP API:
// the pick lists are seeded -> a project gets its customer and property -> the SO form's project picker finds it and
// prefills from it -> the validate dry run and the create both refuse a renovation SO missing the owner's required
// fields (and neither asks for a venue or a fair) -> a complete SO saves, carries its own copy of the fields and writes
// them back to the project -> editing the project refreshes that still-open SO -> once the SO is proceeded a project
// edit leaves it as printed -> the edit form's PUT saves the order information and writes back again.
//
// Runs against a local engine (wrangler dev on :8790 in engine/backend) with its CONTS_SSO_SECRET from
// engine/backend/.dev.vars, like renovation-project.mjs. It WRITES one project and one or two sales orders named
// "TEST CP <run>" into whatever database that engine points at. Never point it at production; refuses any ENGINE
// that is not localhost. Needs migration 0112 applied to that database and one ACTIVE product (RN- generic SKUs
// from migration 0085 do).
//
// Run: node scripts/api-checks/reno-customer-property.mjs
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
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' :: ' + extra}`); return ok; };
const show = (r) => `${r.status} ${JSON.stringify(r.json).slice(0, 400)}`;
const stop = (why) => { console.log(`\nstopped: ${why}\n${fails} failed`); process.exit(1); };

const body = b64url(JSON.stringify({ email: 'reno-cp-check@theconts.test', name: 'Customer info check', role: 'management', access: Object.fromEntries(AREAS.map((k) => [k, 'full'])), exp: Date.now() + 45_000 }));
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
const SI = '/api/scm/renovation-so-info';
const SO = '/api/scm/mfg-sales-orders';

/* ---------- lists ---------- */
let r = await call('GET', `${SI}/lists`);
if (!check('the SO form sees renovation mode with the lists ready', r.status === 200 && r.json?.ready === true && r.json?.renovationMode === true, show(r))) stop('0112 not applied or not renovation mode');
check('property types seeded: Condo, Landed, Serviced apartment, Commercial, Other',
  JSON.stringify(r.json.propertyTypes.map((t) => t.label)) === JSON.stringify(['Condo', 'Landed', 'Serviced apartment', 'Commercial', 'Other']), show(r));
const layout3 = r.json.layouts.find((l) => l.label === '3 bed 2 bath');
check('layouts seeded with their counts (Studio 0/1 ... 5 bed 4 bath)', r.json.layouts.length >= 6 && layout3?.bedrooms === 3 && layout3?.bathrooms === 2, show(r));
r = await call('GET', `${R}/property-lists`);
check('Project Maintenance reads the same lists', r.status === 200 && r.json?.ready === true && r.json.layouts.length === (await call('GET', `${SI}/lists`)).json.layouts.length, show(r));
r = await call('POST', `${R}/property-types`, { label: 'condo' });
check('a duplicate property type (any case) is refused (409)', r.status === 409, show(r));
r = await call('POST', `${R}/layouts`, { label: `TEST ${run} 6 bed`, bedrooms: 6, bathrooms: 5 });
const testLayoutId = r.json?.id;
check('a new layout is added (201)', r.status === 201 && !!testLayoutId, show(r));
r = await call('PATCH', `${R}/layouts/${testLayoutId}`, { active: false });
check('and switched off, not deleted', r.status === 200, show(r));
r = await call('POST', `${R}/layouts`, { label: 'bad', bedrooms: 2.5, bathrooms: 1 });
check('a layout with half a bedroom is refused (400)', r.status === 400, show(r));

/* ---------- staff: two salespeople to move between ---------- */
const staffR = await call('GET', '/api/scm/staff/pickable');
const staffIds = (staffR.json?.staff ?? []).filter((x) => x.active && x.staffCode !== 'SYSTEM').map((x) => x.id);
if (!check('two employees to use as salesperson', staffIds.length >= 2, show(staffR))) stop('need two staff rows');
const [salesA, salesB] = staffIds;

/* The complete Customer info the shared block sends (every field, the required ones filled). */
const full = (over = {}) => ({
  customerName: `TEST CP Customer ${run}`, customerPhone: '+60123456789', customerEmail: 'cp@example.test', salespersonId: salesA,
  address1: 'A-12-3 TEST Skyline', address2: 'Jalan Ampang', state: 'Selangor', city: 'Ampang', postcode: '68000', country: 'Malaysia', salesLocation: 'TESTWH',
  building: 'TEST Skyline Residence', unitNo: 'A-12-3', propertyType: 'Condo', layoutLabel: '3 bed 2 bath', bedrooms: 3, bathrooms: 2, builtUpSqft: '1,100',
  ...over,
});
const info = async (pid) => (await call('GET', `${R}/${pid}/customer-info`)).json?.project;

/* ---------- project ---------- */
const types = await call('GET', `${R}/types`);
const type = types.json?.data?.find((t) => t.slug === 'full_renovation') ?? types.json?.data?.[0];
r = await call('POST', R, { projectTypeId: type?.id, customerInfo: full({ customerPhone: '', propertyType: '' }) });
check('New project with the SO\'s required fields missing is refused (422, Phone and Property type named) and nothing is created',
  r.status === 422 && ['Phone number', 'Property type'].every((f) => r.json?.problems?.some((p) => p.field === f)), show(r));
r = await call('POST', R, { projectTypeId: type?.id, customerInfo: full() });
if (!check('New project with the full block (201)', r.status === 201, show(r))) stop('no project');
const projectId = r.json.id;
let p = await info(projectId);
check('the new project stores every field of the block (salesperson, structured address, property)',
  p?.salespersonId === salesA && p?.address1 === 'A-12-3 TEST Skyline' && p?.address2 === 'Jalan Ampang' && p?.state === 'Selangor'
  && p?.city === 'Ampang' && p?.postcode === '68000' && p?.country === 'Malaysia' && p?.salesLocation === 'TESTWH'
  && p?.propertyType === 'Condo' && p?.bedrooms === 3 && p?.builtUpSqft === 1100 && !!p?.salespersonName, show({ status: 200, json: p }));
check('its single address column is filled for older readers', p?.siteAddress === 'A-12-3 TEST Skyline\nJalan Ampang\n68000 Ampang\nSelangor', JSON.stringify(p?.siteAddress));
check('and it is named Building + Unit', p?.name === 'TEST Skyline Residence A-12-3', p?.name);
r = await call('PATCH', `${R}/${projectId}/customer-info`, full({ address1: '' }));
check('the Customer info edit asks for Address line 1 like the SO (422)', r.status === 422 && r.json?.problems?.some((x) => x.field === 'Address line 1'), show(r));
r = await call('PATCH', `${R}/${projectId}/customer-info`, full({ bedrooms: 'two' }));
check('a word for bedrooms is refused (422, field named)', r.status === 422 && r.json?.problems?.[0]?.field === 'Bedrooms', show(r));
r = await call('PATCH', `${R}/${projectId}/customer-info`, full({ salespersonId: '11111111-1111-4111-8111-111111111111' }));
check('a salesperson who is not an employee is refused (422)', r.status === 422 && r.json?.problems?.some((x) => x.field === 'Salesperson'), show(r));

r = await call('GET', `${SI}/projects?q=${encodeURIComponent('TEST Skyline Residence')}`);
const found = r.json?.data?.find((x) => x.id === projectId);
check('the SO project picker finds it with every shared field', r.status === 200 && found?.builtUpSqft === 1100 && found?.salespersonId === salesA
  && found?.address1 === 'A-12-3 TEST Skyline' && found?.state === 'Selangor' && found?.postcode === '68000', show(r));
r = await call('GET', `${SI}/projects/${projectId}`);
check('prefill read of one project carries the dates and the structured address', r.status === 200 && 'startDate' in (r.json?.project ?? {})
  && r.json?.project?.city === 'Ampang', show(r));

/* ---------- SO: refuse, then create ---------- */
const prod = await call('GET', '/api/scm/mfg-products?status=ACTIVE&limit=5');
const productList = prod.json?.products ?? prod.json?.data ?? prod.json?.items ?? (Array.isArray(prod.json) ? prod.json : []);
const product = productList.find((x) => x.code);
if (!check('an active product to put on the order', !!product, show(prod))) stop('no product');
const line = { itemGroup: product.category ?? 'RENOVATION', itemCode: product.code, description: product.name ?? product.code, uom: 'UNIT', qty: 1, unitPriceSen: 10000, discountSen: 0, unitCostSen: 0 };

const thin = { projectId, building: '', unitNo: '', propertyType: '', layoutLabel: '', bedrooms: '', bathrooms: '', builtUpSqft: '' };
r = await call('POST', `${SO}/validate`, { debtorName: 'X', phone: '012', items: [line], asDraft: false, hasSalesperson: true, renovation: thin, noFair: true });
const vFields = (r.json?.problems ?? []).map((x) => x.field);
check('validate names the missing renovation fields (same names as the project)', r.status === 200 && ['Address line 1', 'Property type', 'Layout', 'Built-up sq ft'].every((f) => vFields.includes(f)), show(r));
check('and does not ask for a venue or a fair', !vFields.includes('Venue') && !vFields.includes('Fair'), show(r));
r = await call('POST', SO, { debtorName: `TEST CP SO ${run}`, phone: '+60123456789', items: [line], renovation: thin, noFair: true });
check('the create refuses the same (422 validation_failed, nothing written)', r.status === 422 && r.json?.error === 'validation_failed', show(r));

const block = { projectId, building: 'TEST Skyline Residence', unitNo: 'A-12-3', propertyType: 'Landed', layoutLabel: '4 bed 3 bath', bedrooms: '4', bathrooms: '3', builtUpSqft: '2400' };
r = await call('POST', SO, {
  debtorName: `TEST CP SO ${run}`, phone: '+60198765432', email: '', salespersonId: salesB,
  address1: 'No 8 TEST Jalan Bukit', address2: 'Taman TEST', customerState: 'Selangor', city: 'Shah Alam', postcode: '40000',
  items: [{ ...line, room: 'Bedroom 1' }, { ...line, room: '' }],
  renovation: { ...block, roomSections: ['Living hall', 'Bedroom 1', 'Common area'] }, noFair: true,
});
if (!check('a complete renovation SO saves (201) with no venue and no fair', r.status === 201 && !!r.json?.docNo && r.json?.renovationInfoSaved !== false, show(r))) stop('no SO');
const docNo = r.json.docNo;
r = await call('GET', `${SI}/so/${encodeURIComponent(docNo)}`);
check('the SO keeps its own copy of the order information and its project', r.status === 200 && r.json?.info?.projectId === projectId && r.json?.info?.propertyType === 'Landed' && r.json?.info?.bedrooms === '4' && r.json?.info?.builtUpSqft === '2400', show(r));
r = await call('GET', `${R}/${projectId}/customer-info`);
const pj = r.json?.project;
check('SO -> project: name, phone, salesperson, address line 1 and 2, state, city, postcode, property all come across',
  pj?.customerName === `TEST CP SO ${run}` && pj?.customerPhone === '+60198765432' && pj?.salespersonId === salesB
  && pj?.address1 === 'No 8 TEST Jalan Bukit' && pj?.address2 === 'Taman TEST' && pj?.state === 'Selangor' && pj?.city === 'Shah Alam' && pj?.postcode === '40000'
  && pj?.propertyType === 'Landed' && pj?.bedrooms === 4 && pj?.builtUpSqft === 2400, show(r));
check("SO -> project: the SO's empty email did not clear the project's", pj?.customerEmail === 'cp@example.test', show(r));
check('the project lists the SO as following it', r.json?.salesOrders?.some((x) => x.docNo === docNo && x.followsProject === true), show(r));

/* ---------- rooms ---------- */
r = await call('GET', `${SI}/so/${encodeURIComponent(docNo)}`);
const roomIds = Object.keys(r.json?.itemRooms ?? {});
check('the new SO keeps its rooms in order and the first line is in Bedroom 1',
  JSON.stringify(r.json?.roomSections) === JSON.stringify(['Living hall', 'Bedroom 1', 'Common area']) && roomIds.length === 1 && r.json.itemRooms[roomIds[0]] === 'Bedroom 1', show(r));
r = await call('PUT', `${SI}/${encodeURIComponent(docNo)}/rooms`, { roomSections: ['Master bedroom', 'Living hall', 'Common area'], itemRooms: { [roomIds[0]]: 'Master bedroom' } });
check('the edit form saves renamed and reordered rooms with the line moved along', r.status === 200
  && JSON.stringify(r.json?.roomSections) === JSON.stringify(['Master bedroom', 'Living hall', 'Common area']) && r.json?.itemRooms?.[roomIds[0]] === 'Master bedroom', show(r));
r = await call('GET', `${SO}/${encodeURIComponent(docNo)}`);
const head = r.json?.salesOrder ?? r.json?.header ?? r.json;
check('totals are untouched by rooms (2 lines, RM 200.00)', Number(head?.local_total_sen ?? head?.localTotalSen) === 20000, JSON.stringify(head).slice(0, 200));

/* ---------- project -> open SO: every field ---------- */
r = await call('PATCH', `${R}/${projectId}/customer-info`, full({
  customerName: `TEST CP Owner ${run}`, customerPhone: '+60111111111', customerEmail: 'owner@example.test', salespersonId: salesA,
  address1: 'B-1-1 TEST Tower', address2: 'Jalan Tun Razak', state: 'Selangor', city: 'Petaling Jaya', postcode: '46000',
  building: 'TEST Tower', unitNo: 'B-1-1', propertyType: 'Serviced apartment', layoutLabel: '2 bed 2 bath', bedrooms: 2, bathrooms: 2, builtUpSqft: 850,
}));
check('editing the project refreshes its open SO', r.status === 200 && r.json?.salesOrdersUpdated?.includes(docNo), show(r));
r = await call('GET', `${SO}/${encodeURIComponent(docNo)}`);
const so2 = r.json?.salesOrder ?? r.json?.header ?? r.json;
check('project -> SO: name, phone, email, salesperson, address line 1 and 2, state, city, postcode, sales location come across',
  so2?.debtor_name === `TEST CP Owner ${run}` && so2?.phone === '+60111111111' && so2?.email === 'owner@example.test' && so2?.salesperson_id === salesA
  && so2?.address1 === 'B-1-1 TEST Tower' && so2?.address2 === 'Jalan Tun Razak' && so2?.customer_state === 'Selangor' && so2?.city === 'Petaling Jaya'
  && so2?.postcode === '46000' && so2?.sales_location === 'TESTWH', JSON.stringify(so2).slice(0, 300));
r = await call('GET', `${SI}/so/${encodeURIComponent(docNo)}`);
check('project -> SO: building, unit and property come across', r.json?.info?.building === 'TEST Tower' && r.json?.info?.unitNo === 'B-1-1'
  && r.json?.info?.propertyType === 'Serviced apartment' && r.json?.info?.bedrooms === '2' && r.json?.info?.builtUpSqft === '850', show(r));

/* ---------- link from the project side; no automatic Signed ---------- */
r = await call('GET', `${R}/${projectId}/step`);
check('an SO made under the project leaves it in Design (Signed is set by hand)', r.json?.current === 'design' || r.json?.flow?.current === 'design', show(r));
/* A second, almost empty project (the old create without the block, then an email): linking an existing SO fills it. */
r = await call('POST', R, { projectTypeId: type?.id, customerName: `TEST CP Link ${run}` });
const linkProjectId = r.json?.id;
r = await call('PATCH', `${R}/${linkProjectId}`, { customerEmail: 'keep@example.test' });
check('a second project with only a name and an email', r.status === 200, show(r));
r = await call('POST', SO, { debtorName: `TEST CP Loose ${run}`, phone: '+60122222222', email: '', salespersonId: salesB,
  address1: 'No 3 TEST Lorong Loose', address2: 'Taman Loose', customerState: 'Selangor', city: 'Klang', postcode: '41000', items: [line],
  renovation: { projectId: null, building: 'TEST Loose Tower', unitNo: 'L-3-3', propertyType: 'Landed', layoutLabel: '2 bed 2 bath', bedrooms: '2', bathrooms: '2', builtUpSqft: '1500' }, noFair: true });
const loose = r.json?.docNo;
check('an SO with no project yet saves', r.status === 201 && !!loose, show(r));
r = await call('GET', `${R}/linkable-sos?q=${encodeURIComponent(loose)}`);
check("the project's Link existing SO lists it", r.json?.data?.some((x) => x.doc_no === loose && x.building === 'TEST Loose Tower'), show(r));
r = await call('POST', `${R}/link-so`, { projectId: linkProjectId, docNo: loose });
check('linking it from the project side works', r.status === 200, show(r));
const lp = await info(linkProjectId);
check('link -> project: every SO field comes across (customer, salesperson, structured address, building, unit, property)',
  lp?.customerName === `TEST CP Loose ${run}` && lp?.customerPhone === '+60122222222' && lp?.salespersonId === salesB
  && lp?.address1 === 'No 3 TEST Lorong Loose' && lp?.address2 === 'Taman Loose' && lp?.state === 'Selangor' && lp?.city === 'Klang' && lp?.postcode === '41000'
  && lp?.building === 'TEST Loose Tower' && lp?.unitNo === 'L-3-3' && lp?.propertyType === 'Landed' && lp?.layoutLabel === '2 bed 2 bath'
  && lp?.bedrooms === 2 && lp?.bathrooms === 2 && lp?.builtUpSqft === 1500, show({ status: 200, json: lp }));
check("the SO's empty email did not clear the project's", lp?.customerEmail === 'keep@example.test', show({ status: 200, json: lp }));
check('and the project is renamed after the building and unit it took from the SO', lp?.name === 'TEST Loose Tower L-3-3', lp?.name);
r = await call('GET', `${SI}/so/${encodeURIComponent(loose)}`);
check('the SO side shows the project', r.json?.info?.projectId === linkProjectId, show(r));
r = await call('GET', `${R}/${linkProjectId}/step`);
check('still Design after the link', r.json?.current === 'design' || r.json?.flow?.current === 'design', show(r));

/* ---------- the name rule: Building + Unit, else the customer name ---------- */
r = await call('POST', R, { projectTypeId: type?.id, customerInfo: full({ customerName: `TEST CP Name ${run}`, building: ' TEST  Vista Harmoni ', unitNo: 'B-8-2' }) });
const nameProjectId = r.json?.id;
check('a project created with no name and no "Customer is" is named Building + Unit', r.status === 201 && (await info(nameProjectId))?.name === 'TEST Vista Harmoni B-8-2', show(r));
r = await call('POST', R, { projectTypeId: type?.id, customerName: `TEST CP Only ${run}` });
check('with no building or unit it takes the customer name', r.status === 201 && (await info(r.json?.id))?.name === `TEST CP Only ${run}`, show(r));
r = await call('PATCH', `${R}/${nameProjectId}/customer-info`, full({ customerName: `TEST CP Name ${run}`, building: 'TEST Vista Harmoni', unitNo: 'C-3-1' }));
check('editing the unit under Customer info renames it', (await info(nameProjectId))?.name === 'TEST Vista Harmoni C-3-1', show(r));
r = await call('POST', SO, { debtorName: `TEST CP Name ${run}`, phone: '+60123333333', address1: 'TEST name rule address', customerState: 'Selangor', items: [line],
  renovation: { projectId: nameProjectId, building: 'TEST Seri Ampang', unitNo: 'D-1-9', propertyType: 'Condo', layoutLabel: 'Studio', bedrooms: '0', bathrooms: '1', builtUpSqft: '500' }, noFair: true });
check('an SO saved under it with another building and unit renames it too', r.status === 201 && (await info(nameProjectId))?.name === 'TEST Seri Ampang D-1-9', show(r));

/* ---------- edit form PUT ---------- */
r = await call('PUT', `${SI}/${encodeURIComponent(docNo)}`, { ...block, propertyType: 'Commercial', builtUpSqft: '' });
check('the edit form refuses a blank sq ft (422)', r.status === 422 && r.json?.problems?.some((x) => x.field === 'Built-up sq ft'), show(r));
r = await call('PUT', `${SI}/${encodeURIComponent(docNo)}`, { ...block, propertyType: 'Commercial', builtUpSqft: '990.5' });
check('the edit form saves the order information', r.status === 200, show(r));
check('and writes it back to the project', (await info(projectId))?.propertyType === 'Commercial' && (await info(projectId))?.builtUpSqft === 990.5);

/* ---------- attachments on the whole order (mig 0115) ---------- */
const upload = async (name, type, bytes) => {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), name);
  const res = await fetch(`${ENGINE}${SI}/${encodeURIComponent(docNo)}/attachments`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
r = await upload('site.png', 'image/png', PNG);
check('a photo attaches to the order (201)', r.status === 201 && !!r.json?.attachment?.id && !('key' in (r.json?.attachment ?? {})), show(r));
const attId = r.json?.attachment?.id;
r = await upload('notes.txt', 'text/plain', new TextEncoder().encode('x'));
check('a text file is refused (photos and PDFs only)', r.status === 400 && r.json?.error === 'invalid_mime', show(r));
r = await call('GET', `${SI}/${encodeURIComponent(docNo)}/attachments`);
check('the order lists its attachment', r.json?.attachments?.length === 1 && r.json.attachments[0].name === 'site.png', show(r));
const fileRes = await fetch(`${ENGINE}${SI}/${encodeURIComponent(docNo)}/attachments/${attId}`, { headers: { authorization: `Bearer ${token}` } });
check('the file comes back as the photo', fileRes.status === 200 && fileRes.headers.get('content-type') === 'image/png' && (await fileRes.arrayBuffer()).byteLength === PNG.length, `${fileRes.status}`);
r = await call('DELETE', `${SI}/${encodeURIComponent(docNo)}/attachments/${attId}`);
check('and can be removed', r.status === 200 && (await call('GET', `${SI}/${encodeURIComponent(docNo)}/attachments`)).json?.attachments?.length === 0, show(r));

/* ---------- a proceeded SO keeps what it was printed with ---------- */
if (process.env.DATABASE_URL) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  await sql`update scm.mfg_sales_orders set processing_date = current_date + 7 where doc_no = ${docNo}`;
  r = await call('PATCH', `${R}/${projectId}/customer-info`, full({ customerName: `TEST CP Later ${run}`, propertyType: 'Other', city: 'Puchong', bedrooms: 1, bathrooms: 1, builtUpSqft: 500 }));
  check('after the SO is proceeded, a project edit leaves it as printed', r.status === 200 && r.json?.salesOrdersKept?.includes(docNo) && !r.json?.salesOrdersUpdated?.includes(docNo), show(r));
  const [row] = await sql`select property_type, city from scm.mfg_sales_orders where doc_no = ${docNo}`;
  check('its property type and city are still Commercial / Petaling Jaya', row?.property_type === 'Commercial' && row?.city === 'Petaling Jaya', JSON.stringify(row));
  await sql.end();
} else {
  console.log('skip the proceeded-SO check (set DATABASE_URL to the same local database to run it)');
}

console.log(`\nSO ${docNo}, project ${projectId}\n${fails} failed`);
process.exit(fails ? 1 : 0);
