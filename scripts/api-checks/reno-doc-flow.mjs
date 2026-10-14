// Renovation document flow (owner, 14 Oct 2026, "batch 4"; migration 0116), through a local engine's HTTP API.
// Field list: docs/superpowers/plans/2026-10-14-reno-doc-flow-fields.md.
//
//   project (customer + property) -> quotation (starts from the project, keeps its own site address / property /
//   rooms, a new revision copies them) -> converted contract SO (address, building, unit, property, room list,
//   line rooms) -> Raise POs: 3 POs in 2 categories, one category each, a mixed line refused (project, room, category)
//   -> GR against a PO (project, room, category) -> the project lists every document, POs under their category
//   -> progress-billing SI (phone, email, address, project, building, unit)
//   and a renovation-mode standard SO (lines in rooms) -> DO from the SO (project, building, unit, rooms, phone,
//   address) -> SI from the DO (the same) -> the document pages' GET /:id/renovation-info.
//
// Runs against a local engine (wrangler dev in engine/backend, default http://localhost:8790, set ENGINE for another
// port) with its CONTS_SSO_SECRET from engine/backend/.dev.vars, on a throwaway local Postgres with every migration applied and
// a local PostgREST behind SUPABASE_URL (the engine's SCM routes read and write through it; PGlite cannot serve that).
// It WRITES a project, a supplier, a quotation and its documents named "TEST RF <run>". Refuses any ENGINE that is
// not localhost. Needs migrations 0112 and 0116 and renovation mode (migration 0082) in that database.
//
// Run: ENGINE=http://localhost:8791 node scripts/api-checks/reno-doc-flow.mjs
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
const show = (r) => `${r.status} ${JSON.stringify(r.json).slice(0, 500)}`;
const stop = (why) => { console.log(`\nstopped: ${why}\n${fails} failed`); process.exit(1); };

const body = b64url(JSON.stringify({ email: 'reno-flow-check@theconts.test', name: 'Doc flow check', role: 'management', access: Object.fromEntries(AREAS.map((k) => [k, 'full'])), exp: Date.now() + 45_000 }));
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
const RS = '/api/scm/renovation';
const SI = '/api/scm/renovation-so-info';
const SO = '/api/scm/mfg-sales-orders';
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const roomsOf = (info) => Object.values(info?.lines ?? {}).map((l) => l.room).filter(Boolean).sort();

/* ---------- project with its customer and property ---------- */
const types = await call('GET', `${R}/types`);
const type = types.json?.data?.find((t) => t.slug === 'full_renovation') ?? types.json?.data?.[0];
let r = await call('POST', R, { projectTypeId: type?.id, customerName: `TEST RF Customer ${run}`, building: `TEST RF Vista ${run}`, unitNo: 'B-8-2' });
if (!check('create a renovation project', r.status === 201, show(r))) stop('no project');
const projectId = r.json.id;
r = await call('PATCH', `${R}/${projectId}/customer-info`, {
  customerName: `TEST RF Customer ${run}`, customerPhone: '+60123456789', customerEmail: 'rf@example.test',
  address1: 'B-8-2 TEST Vista Harmoni', address2: 'Jalan Ampang', building: `TEST RF Vista ${run}`, unitNo: 'B-8-2',
  propertyType: 'Condo', layoutLabel: '3 bed 2 bath', bedrooms: 3, bathrooms: 2, builtUpSqft: '1,100',
});
if (!check('the project holds the customer and property', r.status === 200, show(r))) stop('project not saved');

/* ---------- two suppliers, a warehouse, and generic products of two categories ---------- */
r = await call('POST', '/api/scm/suppliers', { code: `TRF${run}`, name: `TEST RF Supplier ${run}` });
const supplierId = r.json?.id ?? r.json?.supplier?.id ?? r.json?.data?.id;
if (!check('a supplier for the purchase orders', (r.status === 201 || r.status === 200) && !!supplierId, show(r))) stop('no supplier');
r = await call('POST', '/api/scm/suppliers', { code: `TRG${run}`, name: `TEST RF Plumber ${run}` });
const supplier2 = r.json?.id ?? r.json?.supplier?.id ?? r.json?.data?.id;
check('a second supplier', !!supplier2, show(r));
r = await call('GET', '/api/scm/inventory/warehouses');
let warehouseId = (r.json?.warehouses ?? r.json?.data ?? (Array.isArray(r.json) ? r.json : [])).find((w) => w.is_active !== false && w.isActive !== false)?.id;
if (!warehouseId) {
  r = await call('POST', '/api/scm/inventory/warehouses', { code: `TRW${run}`, name: `TEST RF Warehouse ${run}`, state: 'Selangor', isDefault: true });
  warehouseId = r.json?.id ?? r.json?.warehouse?.id ?? r.json?.data?.id;
}
check('a warehouse to receive into', !!warehouseId, show(r));
r = await call('PUT', '/api/scm/state-warehouse-mappings/Selangor', { warehouseId });
check('Selangor orders draw from it', r.status === 200 || r.status === 201, show(r));
r = await call('GET', `${RS}/lookups/products?q=RN-`);
const products = r.json?.products ?? r.json?.data ?? (Array.isArray(r.json) ? r.json : []);
const works = products.find((p) => p.code === 'RN-ELECTRICAL') ?? products.find((p) => p.group === 'WORKS');
const works2 = products.find((p) => p.group === 'WORKS' && p.code !== works?.code);
const service = products.find((p) => p.group === 'SERVICE');
if (!check('generic RN- products of two categories, Works and Service (migration 0085)', !!works && !!works2 && !!service, show(r))) stop('no RN- products');

/* ---------- quotation: starts from the project ---------- */
const sections = [
  { heading: 'Living hall', lines: [{ kind: 'ITEM', itemCode: works.code, description: 'TEST power points', qty: 2, unitPriceSen: 15000, supplierId, unitCostSen: 9000 }] },
  { heading: 'Bedroom 1', lines: [
    { kind: 'ITEM', itemCode: service.code, description: 'TEST cleaning', qty: 1, unitPriceSen: 30000, supplierId, unitCostSen: 20000 },
    { kind: 'ITEM', itemCode: works2.code, room: 'Bedroom 1 bathroom', description: 'TEST basin', qty: 1, unitPriceSen: 20000, supplierId: supplier2, unitCostSen: 12000 },
  ] },
];
const instalments = [{ seq: 1, label: 'Deposit', pctBp: 5000, trigger: 'so_confirmed' }, { seq: 2, label: 'Balance', pctBp: 5000, trigger: 'stage_start' }];
r = await call('POST', `${RS}/quotations`, { projectId, header: { docDate: today }, sections, instalments });
if (!check('create a quotation for the project', r.status === 201 && !!r.json?.id, show(r))) stop('no quotation');
const quotationId = r.json.id;
r = await call('GET', `${RS}/quotations/${quotationId}`);
let h = r.json?.revision?.header;
check('the quotation knows migration 0116 is in (propertyReady)', r.json?.propertyReady === true, show(r));
check('a new quotation starts from the project: customer, phone, email, site address, building, unit',
  h?.customerName === `TEST RF Customer ${run}` && h?.customerPhone === '+60123456789' && h?.customerEmail === 'rf@example.test'
  && h?.siteAddress === 'B-8-2 TEST Vista Harmoni\nJalan Ampang' && h?.building === `TEST RF Vista ${run}` && h?.unitNo === 'B-8-2', show(r));
check('and its property: type, layout with counts, sq ft', h?.propertyType === 'Condo' && h?.layoutLabel === '3 bed 2 bath' && h?.bedrooms === 3 && h?.bathrooms === 2 && h?.builtUpSqft === 1100, show(r));

/* the quotation keeps its own values */
let version = r.json.quotation.version;
r = await call('PUT', `${RS}/quotations/${quotationId}`, { version, header: { ...h, siteAddress: 'B-8-2 TEST Vista Harmoni\nJalan Ampang\n50450 Kuala Lumpur', builtUpSqft: 1150.5, layoutLabel: '4 bed 3 bath', bedrooms: 4, bathrooms: 3 } });
check('the quotation saves its own site address, layout and sq ft', r.status === 200, show(r));
r = await call('PUT', `${RS}/quotations/${quotationId}`, { version: r.json?.version, header: { builtUpSqft: 10.123 } });
check('a sq ft with 3 decimals is refused (422)', r.status === 422, show(r));
r = await call('GET', `${RS}/quotations/${quotationId}`);
h = r.json?.revision?.header;
check('and reads them back', h?.siteAddress === 'B-8-2 TEST Vista Harmoni\nJalan Ampang\n50450 Kuala Lumpur' && h?.builtUpSqft === 1150.5 && h?.bedrooms === 4, show(r));
version = r.json.quotation.version;

/* a new revision copies the block */
r = await call('POST', `${RS}/quotations/${quotationId}/status`, { status: 'SENT', version });
r = await call('POST', `${RS}/quotations/${quotationId}/revisions`, { version: r.json?.version });
check('start revision R2', r.status === 201 && r.json?.revNo === 2, show(r));
r = await call('GET', `${RS}/quotations/${quotationId}`);
h = r.json?.revision?.header;
check('R2 keeps the site address and property', r.json?.revision?.revNo === 2 && h?.siteAddress?.endsWith('50450 Kuala Lumpur') && h?.layoutLabel === '4 bed 3 bath' && h?.builtUpSqft === 1150.5, show(r));
version = r.json.quotation.version;
r = await call('POST', `${RS}/quotations/${quotationId}/status`, { status: 'SENT', version });
r = await call('POST', `${RS}/quotations/${quotationId}/status`, { status: 'ACCEPTED', version: r.json?.version });
check('R2 sent and accepted', r.status === 200 && r.json?.status === 'ACCEPTED', show(r));

/* ---------- convert: the contract SO carries the block and the rooms ---------- */
r = await call('POST', `${RS}/quotations/${quotationId}/convert`, { version: r.json.version, soDate: today });
if (!check('convert to the sales order', r.status === 200 || r.status === 201, show(r))) stop('no contract');
const contract = r.json.docNo;
r = await call('GET', `${SI}/so/${encodeURIComponent(contract)}`);
const ci = r.json?.info;
check('the contract SO has the quotation site address (not building / unit in the address lines)',
  ci?.siteAddress === 'B-8-2 TEST Vista Harmoni\nJalan Ampang, 50450 Kuala Lumpur', show(r));
check('and its building, unit, property type, layout and sq ft',
  ci?.building === `TEST RF Vista ${run}` && ci?.unitNo === 'B-8-2' && ci?.propertyType === 'Condo' && ci?.layoutLabel === '4 bed 3 bath'
  && ci?.bedrooms === '4' && ci?.bathrooms === '3' && ci?.builtUpSqft === '1150.5', show(r));
check('and its customer, phone and email', ci?.customerName === `TEST RF Customer ${run}` && ci?.customerPhone === '+60123456789' && ci?.customerEmail === 'rf@example.test', show(r));
check('and its project', ci?.projectId === projectId, show(r));
check('the contract room list follows the quotation sections and line rooms',
  JSON.stringify(r.json?.roomSections) === JSON.stringify(['Living hall', 'Bedroom 1', 'Bedroom 1 bathroom']), show(r));
check('each SO line has its room (section heading, or the line\'s own)',
  JSON.stringify(Object.values(r.json?.itemRooms ?? {}).sort()) === JSON.stringify(['Bedroom 1', 'Bedroom 1 bathroom', 'Living hall']), show(r));

/* ---------- Raise POs: one per supplier AND category, each with the project, room and category ---------- */
r = await call('POST', `${RS}/sales-orders/${encodeURIComponent(contract)}/po-split`, { poDate: today, expectedAt: today });
const created = r.json?.created ?? [];
if (!check('raising POs for the contract makes 3 POs in 2 categories (supplier A Works, supplier A Service, supplier B Works)',
  r.status === 201 && created.length === 3 && JSON.stringify(created.map((c) => c.categoryGroup).sort()) === JSON.stringify(['SERVICE', 'WORKS', 'WORKS']), show(r))) stop('no POs');
const poWorksA = created.find((c) => c.categoryGroup === 'WORKS' && c.supplierId === supplierId);
const poService = created.find((c) => c.categoryGroup === 'SERVICE');
const poId = poWorksA.id;
r = await call('GET', `/api/scm/mfg-purchase-orders/${poId}/renovation-info`);
const pi = r.json;
check('the PO points at the project', pi?.ready === true && pi?.info?.projectId === projectId, show(r));
check('and holds one category (Works, sub-category Electrical)', pi?.info?.categoryGroup === 'WORKS' && pi?.info?.subCategory === 'ELECTRICAL', show(r));
check('and lists the contract it came from', JSON.stringify(pi?.info?.soDocNos) === JSON.stringify([contract]), show(r));
check('its line has the room and category', JSON.stringify(roomsOf(pi)) === JSON.stringify(['Living hall']) && Object.values(pi?.lines ?? {}).every((l) => l.categoryGroup === 'WORKS'), show(r));
r = await call('GET', `/api/scm/mfg-purchase-orders/${poService.id}/renovation-info`);
check('the Service PO holds Service and its line Bedroom 1', r.json?.info?.categoryGroup === 'SERVICE' && JSON.stringify(roomsOf(r.json)) === JSON.stringify(['Bedroom 1']), show(r));
r = await call('POST', `/api/scm/mfg-purchase-orders/${poId}/items`, { itemCode: service.code, materialName: 'TEST mixed line', materialKind: 'mfg_product', qty: 1, unitPriceSen: 100 });
check('adding a Service line to the Works PO is refused, naming both categories', r.status >= 400 && /one category/.test(JSON.stringify(r.json)) && /SERVICE/.test(JSON.stringify(r.json)), show(r));
r = await call('GET', `/api/scm/mfg-purchase-orders/${poId}/renovation-info`);
check('and the Works PO still has its one line', Object.keys(r.json?.lines ?? {}).length === 1, show(r));

/* ---------- GR against the Works PO ---------- */
r = await call('GET', `/api/scm/mfg-purchase-orders/${poId}`);
const poItems = r.json?.items ?? [];
r = await call('POST', '/api/scm/grns', {
  supplierId, purchaseOrderId: poId, warehouseId, receivedAt: today,
  items: poItems.map((it) => ({ purchaseOrderItemId: it.id, itemCode: it.item_code, materialKind: it.material_kind, materialName: it.material_name,
    description: it.description, qtyReceived: it.qty, qtyAccepted: it.qty, unitPriceSen: it.unit_price_sen, uom: it.uom })),
});
const grnId = r.json?.id ?? r.json?.grn?.id ?? r.json?.header?.id ?? r.json?.data?.id;
if (check('receive the Works PO (goods receipt)', (r.status === 201 || r.status === 200) && !!grnId, show(r))) {
  r = await call('GET', `/api/scm/grns/${grnId}/renovation-info`);
  check('the GR takes the PO project', r.json?.ready === true && r.json?.info?.projectId === projectId, show(r));
  check('and each line the PO line room and category', JSON.stringify(roomsOf(r.json)) === JSON.stringify(['Living hall'])
    && Object.values(r.json?.lines ?? {}).every((l) => l.categoryGroup === 'WORKS'), show(r));
  check('and names its PO and SO', r.json?.info?.poNumbers?.length === 1 && JSON.stringify(r.json?.info?.soDocNos) === JSON.stringify([contract]), show(r));
}

/* ---------- progress billing SI ---------- */
r = await call('GET', `${RS}/sales-orders/${encodeURIComponent(contract)}/billing`);
const next = r.json?.instalments?.find((i) => i.isNext);
r = await call('POST', `${RS}/sales-orders/${encodeURIComponent(contract)}/instalments/${next?.id}/bill`, { invoiceDate: today, expectedAmountSen: next?.amountSen });
const billSi = r.json?.salesInvoiceId ?? r.json?.result?.salesInvoiceId;
if (check('bill the deposit (progress-billing invoice)', (r.status === 200 || r.status === 201) && !!billSi, show(r))) {
  r = await call('GET', `/api/scm/sales-invoices/${billSi}`);
  const sh = r.json?.salesInvoice ?? r.json?.header ?? r.json;
  check('the progress invoice has the SO phone, email and address', sh?.phone === '+60123456789' && sh?.email === 'rf@example.test'
    && sh?.address1 === 'B-8-2 TEST Vista Harmoni' && sh?.address2 === 'Jalan Ampang, 50450 Kuala Lumpur', JSON.stringify(sh).slice(0, 400));
  r = await call('GET', `/api/scm/sales-invoices/${billSi}/renovation-info`);
  check('and the project, building and unit', r.json?.info?.projectId === projectId && r.json?.info?.building === `TEST RF Vista ${run}` && r.json?.info?.unitNo === 'B-8-2', show(r));
}

/* ---------- renovation-mode standard SO -> DO -> SI ---------- */
const line = (desc, room) => ({ itemGroup: 'RENOVATION', itemCode: works.code, description: desc, uom: 'UNIT', qty: 1, unitPriceSen: 10000, discountSen: 0, unitCostSen: 0, room });
r = await call('POST', SO, {
  debtorName: `TEST RF SO ${run}`, phone: '+60198765432', email: 'so@example.test', address1: 'No 8 TEST Jalan Bukit', address2: 'Taman TEST', customerState: 'Selangor',
  items: [line('TEST lights', 'Living hall'), line('TEST fan', 'Bedroom 1')],
  renovation: { projectId, building: `TEST RF Vista ${run}`, unitNo: 'B-8-2', propertyType: 'Condo', layoutLabel: '3 bed 2 bath', bedrooms: '3', bathrooms: '2', builtUpSqft: '1100',
    roomSections: ['Living hall', 'Bedroom 1'] },
  noFair: true,
});
if (!check('a renovation-mode SO with lines in rooms', r.status === 201 && !!r.json?.docNo, show(r))) stop('no standard SO');
const soNo = r.json.docNo;
r = await call('GET', `${SO}/${encodeURIComponent(soNo)}`);
const soItems = r.json?.items ?? r.json?.lines ?? [];
r = await call('POST', '/api/scm/delivery-orders-mfg/from-sos', { picks: soItems.map((it) => ({ soItemId: it.id, qty: 1 })), confirmShortStock: true, dropShip: true });
const doId = r.json?.id ?? r.json?.deliveryOrder?.id ?? r.json?.header?.id ?? r.json?.created?.[0]?.id;
if (check('a delivery order from the SO', (r.status === 201 || r.status === 200) && !!doId, show(r))) {
  r = await call('GET', `/api/scm/delivery-orders-mfg/${doId}/renovation-info`);
  check('the DO has the project, building and unit', r.json?.info?.projectId === projectId && r.json?.info?.building === `TEST RF Vista ${run}` && r.json?.info?.unitNo === 'B-8-2', show(r));
  check('and each line its SO room', JSON.stringify(roomsOf(r.json)) === JSON.stringify(['Bedroom 1', 'Living hall']), show(r));
  r = await call('GET', `/api/scm/delivery-orders-mfg/${doId}`);
  const dh = r.json?.deliveryOrder ?? r.json?.header ?? r.json;
  const doItems = r.json?.items ?? [];
  check('and the SO customer, phone and address', dh?.debtor_name === `TEST RF SO ${run}` && dh?.phone === '+60198765432' && dh?.address1 === 'No 8 TEST Jalan Bukit', JSON.stringify(dh).slice(0, 300));
  r = await call('POST', '/api/scm/sales-invoices/from-dos', { picks: doItems.map((it) => ({ doItemId: it.id, qty: it.qty })) });
  const siId = r.json?.id ?? r.json?.salesInvoice?.id ?? r.json?.header?.id;
  if (check('a sales invoice from the DO', (r.status === 201 || r.status === 200) && !!siId, show(r))) {
    r = await call('GET', `/api/scm/sales-invoices/${siId}/renovation-info`);
    check('the SI has the project, building and unit', r.json?.info?.projectId === projectId && r.json?.info?.building === `TEST RF Vista ${run}` && r.json?.info?.unitNo === 'B-8-2', show(r));
    check('and each line its room', JSON.stringify(roomsOf(r.json)) === JSON.stringify(['Bedroom 1', 'Living hall']), show(r));
    check('and names the SO', JSON.stringify(r.json?.info?.soDocNos) === JSON.stringify([soNo]), show(r));
    r = await call('GET', `/api/scm/sales-invoices/${siId}`);
    const sh = r.json?.salesInvoice ?? r.json?.header ?? r.json;
    check('and the customer, phone and address', sh?.debtor_name === `TEST RF SO ${run}` && sh?.phone === '+60198765432' && sh?.address1 === 'No 8 TEST Jalan Bukit', JSON.stringify(sh).slice(0, 300));
  }
}

/* ---------- the project's documents (Procurement details rows and the Project documents card) ---------- */
r = await call('GET', `${R}/${projectId}/documents`);
const pd = r.json;
check('the project lists its quotation', pd?.ready === true && pd?.quotations?.some((q) => q.id === quotationId), show(r));
check('and both sales orders (the contract and the renovation-mode SO)', [contract, soNo].every((n) => pd?.salesOrders?.some((s) => s.no === n)), show(r));
check('and the 3 POs, each under its category (2 Works, 1 Service) with supplier and dates',
  pd?.purchaseOrders?.length === 3 && pd.purchaseOrders.filter((p) => p.categoryGroup === 'WORKS').length === 2 && pd.purchaseOrders.filter((p) => p.categoryGroup === 'SERVICE').length === 1
  && pd.purchaseOrders.every((p) => p.supplierName && p.poDate === today && p.expectedAt === today), show(r));
check('the received Works PO reads received, the others not received', pd?.purchaseOrders?.find((p) => p.id === poId)?.receipt === 'full'
  && pd.purchaseOrders.filter((p) => p.id !== poId).every((p) => p.receipt === 'none'), show(r));
check('the goods receipt is listed against its PO', pd?.goodsReceipts?.some((g) => g.id === grnId && g.poIds.includes(poId)), show(r));
check('and the delivery order and both sales invoices (progress billing, from the DO)', pd?.deliveryOrders?.length === 1 && pd?.salesInvoices?.length === 2, show(r));
check('the DO hangs under its SO, the DO invoice under the DO, the progress invoice under the contract',
  pd?.deliveryOrders?.[0]?.soDocNo === soNo && pd?.salesInvoices?.some((s) => s.deliveryOrderId === pd.deliveryOrders[0].id) && pd?.salesInvoices?.some((s) => s.soDocNo === contract && !s.deliveryOrderId), show(r));

/* ---------- a bad id is refused, not a crash ---------- */
r = await call('GET', '/api/scm/delivery-orders-mfg/not-a-uuid/renovation-info');
check('a malformed document id is refused (400)', r.status === 400, show(r));

console.log(`\nproject ${projectId}, quotation ${quotationId}, contract ${contract}, PO ${poId}, SO ${soNo}\n${fails} failed`);
process.exit(fails ? 1 : 0);
