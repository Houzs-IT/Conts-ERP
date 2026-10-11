// Renovation project end to end through a local engine's HTTP API (phases 2 and 3 together):
// create a project -> quotation -> accept -> convert to the contract SO -> stages auto-skip from the
// SO's contents -> a skip without a reason is refused (400) -> raise the PO -> the hardware gate refuses
// (409) before instalment 1 is received -> the billing prompt bills instalment 1 -> pay it, sign the shop
// drawings, skip the permit with a reason -> the gate opens -> receive the trade on site (no stock booked,
// the PO is received, the trade task completes) -> the proof of delivery is grouped by room.
//
// Runs against a local engine (wrangler dev on :8790 in engine/backend) with its CONTS_SSO_SECRET from
// engine/backend/.dev.vars, like scm-engine-access.mjs. It WRITES: one project, quotation, contract SO,
// supplier, PO, progress invoice, payment and site receipt, all named "TEST RN <run>", in whatever
// database that local engine is pointed at (its Hyperdrive local connection string). Never point it at
// production. Refuses any ENGINE that is not localhost.
//
// Run: node scripts/api-checks/renovation-project.mjs
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ENGINE = process.env.ENGINE ?? 'http://localhost:8790';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(ENGINE)) { console.error(`ENGINE must be a local engine, not ${ENGINE}`); process.exit(1); }
const secret = readFileSync(new URL('../../engine/backend/.dev.vars', import.meta.url), 'utf8').match(/^CONTS_SSO_SECRET\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
if (!secret) { console.error('CONTS_SSO_SECRET not found in engine/backend/.dev.vars'); process.exit(1); }
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const AREAS = ['scSales', 'scInvoices', 'scConsignment', 'scProcurement', 'scTransportPlan', 'scWarehouse', 'serviceCases', 'projects'];
const run = Date.now().toString(36).slice(-5).toUpperCase();
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' :: ' + extra}`); return ok; };
const show = (r) => `${r.status} ${JSON.stringify(r.json).slice(0, 300)}`;
const stop = (why) => { console.log(`\nstopped: ${why}\n${fails} failed`); process.exit(1); };

// Management, Full in every area (the role the owner uses).
const body = b64url(JSON.stringify({ email: 'renovation-check@theconts.test', name: 'Renovation check', role: 'management', access: Object.fromEntries(AREAS.map((k) => [k, 'full'])), exp: Date.now() + 45_000 }));
const sso = await fetch(`${ENGINE}/api/conts-sso`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assertion: `${body}.${b64url(createHmac('sha256', secret).update(body).digest())}` }) });
const token = (await sso.json().catch(() => ({}))).token;
if (!check('sign on to the engine', sso.status === 200 && !!token, `${sso.status}`)) stop('no session');

async function call(method, path, payload, headers = {}) {
  const isBytes = payload instanceof Uint8Array;
  const r = await fetch(ENGINE + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(payload === undefined ? {} : { 'content-type': isBytes ? 'image/png' : 'application/json' }), ...headers },
    body: payload === undefined ? undefined : isBytes ? payload : JSON.stringify(payload),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
const R = '/api/renovation';
const S = '/api/scm/renovation';
const project = async (id) => (await call('GET', `${R}/${id}`)).json;
// A 1x1 PNG: the site photos and the supervisor's signature.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

/* ---------- project ---------- */
const types = await call('GET', `${R}/types`);
const type = types.json?.data?.find((t) => t.slug === 'full_renovation');
if (!check('the Full renovation project type exists', !!type, show(types))) stop('no project type');
let r = await call('POST', R, { name: `TEST RN ${run}`, projectTypeId: type.id, customerKind: 'customer', customerName: `TEST Customer ${run}`, building: 'TEST Skyline', unitNo: 'A-1-1' });
if (!check('create a renovation project (201, RN-YYMM-NNN)', r.status === 201 && /^RN-\d{4}-\d{3}$/.test(r.json?.code ?? ''), show(r))) stop('no project');
const projectId = r.json.id;
let p = await project(projectId);
check('the project opens at Design with 11 stages and the gate closed', p.currentStage === 'design' && p.stages?.length === 11 && p.gate?.open === false, `${p.currentStage} ${p.stages?.length} ${JSON.stringify(p.gate)}`);

r = await call('POST', `${R}/${projectId}/stages/defect_check/skip`, {});
check('skipping a stage without a reason is refused (400)', r.status === 400 && r.json?.error === 'reason_required', show(r));
r = await call('POST', `${R}/${projectId}/stages/defect_check/skip`, { reason: 'ab' });
check('a two-letter reason is refused too (400)', r.status === 400, show(r));

/* ---------- quotation -> contract SO ---------- */
// RENO_SUPPLIER_ID: use an existing supplier instead of creating one.
let supplierId = process.env.RENO_SUPPLIER_ID ?? null;
if (!supplierId) {
  r = await call('POST', '/api/scm/suppliers', { code: `TRN${run}`, name: `TEST RN Electrician ${run}` });
  supplierId = r.json?.supplier?.id ?? null;
  if (!check('a subcontractor to bind the wiring to', r.status === 201 && !!supplierId, show(r))) stop('no supplier');
}
r = await call('POST', `${S}/quotations`, {
  projectId,
  header: { customerName: `TEST Customer ${run}`, building: 'TEST Skyline', unitNo: 'A-1-1' },
  sections: [
    { heading: 'ELECTRICAL', lines: [{ kind: 'ITEM', itemCode: 'RN-ELECTRICAL', description: 'WIRING WHOLE UNIT', room: 'Living', qty: 1, unitPriceSen: 1_000_000, supplierId, unitCostSen: 600_000 }] },
    { heading: 'STYLING', lines: [{ kind: 'ITEM', itemCode: 'RN-STYLING', description: 'STYLING AND SET UP', room: 'Living', qty: 1, unitPriceSen: 200_000 }] },
  ],
});
if (!check('quotation created (QT-YYMM-NNN)', r.status === 201 && /^QT-\d{4}-\d{3}$/.test(r.json?.quoteNo ?? ''), show(r))) stop('no quotation');
const quoteId = r.json.id;
let q = (await call('GET', `${S}/quotations/${quoteId}`)).json;
check('the default payment terms were copied onto the quotation', (q.revision?.instalments?.length ?? 0) > 0, JSON.stringify(q.revision?.instalments ?? null).slice(0, 200));
r = await call('POST', `${S}/quotations/${quoteId}/status`, { status: 'SENT', version: q.quotation.version });
r = await call('POST', `${S}/quotations/${quoteId}/status`, { status: 'ACCEPTED', version: r.json?.version });
check('quotation sent and accepted', r.status === 200, show(r));
r = await call('POST', `${S}/quotations/${quoteId}/convert`, { version: r.json?.version });
if (!check('the accepted quotation converts to the contract SO (RM 12,000)', r.status === 201 && r.json?.contractSen === 1_200_000, show(r))) stop('no SO');
const soDocNo = r.json.docNo;

/* ---------- stages follow the SO ---------- */
p = await project(projectId);
const st = Object.fromEntries((p.stages ?? []).map((s) => [s.key, s]));
check('no furniture or appliance lines: those stages auto-skip', st.furniture?.state === 'skipped' && st.furniture?.skipSource === 'auto' && st.appliances?.state === 'skipped' && st.appliances?.skipSource === 'auto',
  JSON.stringify({ furniture: st.furniture, appliances: st.appliances }).slice(0, 300));
check('works and service lines keep Hardware and Soft furnishing open', st.hardware?.state !== 'skipped' && st.soft_furnishing?.state !== 'skipped');
const wiringTask = (p.tasks ?? []).find((t) => t.trade_code === 'ELECTRICAL');
check('converting the quotation created the ELECTRICAL trade task (phase 2 hook -> phase 3 sync)', !!wiringTask, JSON.stringify((p.tasks ?? []).map((t) => t.trade_code)));

/* ---------- PO, then the hardware gate ---------- */
r = await call('POST', `${S}/sales-orders/${soDocNo}/po-split`, {});
check('SO -> PO: one PO for the subcontractor', r.status === 201 && r.json?.created?.length === 1 && r.json.created[0].supplierId === supplierId, show(r));
r = await call('POST', `${R}/${projectId}/stages/hardware/start`);
check('works may start before instalment 1 (the gate warns, it does not block)', r.status === 200, show(r));
p = await project(projectId);
check('...and says why: instalment 1, shop drawings, permit', ['instalment1_unpaid', 'shop_drawings_unsigned', 'permit_pending'].every((x) => p.gate?.reasons?.includes(x)), JSON.stringify(p.gate));

const open = await call('GET', `/api/scm/site-receipts/projects/${projectId}/open-lines`);
const wiringLine = open.json?.data?.find((l) => l.item_code === 'RN-ELECTRICAL');
check('the wiring PO line waits to be received on site', !!wiringLine && wiringLine.remaining === 1, show(open));
const up = async (kind) => (await call('POST', `${R}/${projectId}/files?kind=${kind}`, PNG)).json?.key;
const afterKey = await up('after');
const sigKey = await up('supervisor_signature');
check('site photo and signature uploaded', !!afterKey && !!sigKey, `${afterKey} ${sigKey}`);
const receipt = () => ({ projectId, lines: [{ poItemId: wiringLine.po_item_id, qty: 1 }], photos: [{ r2Key: afterKey, kind: 'after', location: 'Living', takenAt: new Date().toISOString() }], supervisorSignatureR2Key: sigKey });

/* ---------- billing prompt -> instalment 1 paid -> gate opens ---------- */
const prompt = (p.prompts ?? []).find((x) => x.seq === 1);
check('the billing prompt offers instalment 1 once the SO is confirmed', prompt?.actionable === true && prompt.dueSen > 0, JSON.stringify(p.prompts));
const billing = (await call('GET', `${S}/sales-orders/${soDocNo}/billing`)).json;
check('the prompt amount is phase 2\'s amount for instalment 1', billing?.instalments?.[0]?.amountSen === prompt?.dueSen, `${billing?.instalments?.[0]?.amountSen} vs ${prompt?.dueSen}`);
r = await call('POST', `${S}/sales-orders/${soDocNo}/instalments/${prompt?.instalmentId}/bill`, { invoiceDate: today, expectedAmountSen: prompt?.dueSen });
if (!check('bill instalment 1 from the prompt: a progress invoice', r.status === 201 && r.json?.kind === 'INVOICE' && !!r.json.salesInvoiceId, show(r))) stop('not billed');
const invoiceId = r.json.salesInvoiceId;
r = await call('POST', `/api/scm/sales-invoices/${invoiceId}/payments`, { paidAt: today, method: 'transfer', amountSen: prompt.dueSen, note: `TEST RN ${run}` });
check('instalment 1 paid in full', r.status === 200 || r.status === 201, show(r));
const signed = p.checklist?.find((c) => c.item_key === 'shop_drawings_signed');
r = await call('POST', `/api/projects/checklist/${signed?.id}/status`, { status: 'done' });
check('shop drawings signed off', r.status === 200, show(r));
const permit = p.checklist?.find((c) => c.item_key === 'renovation_permit');
r = await call('POST', `${R}/checklist/${permit?.id}/skip`, { reason: 'TEST: management needs no permit' });
check('renovation permit skipped with a reason', r.status === 200, show(r));
p = await project(projectId);
check('the gate opens', p.gate?.open === true, JSON.stringify(p.gate));
check('payment condition shows instalment 1 received', p.payment?.receivedCount === 1, JSON.stringify(p.payment));
check('hardware works are already in progress (started before the gate opened)', p.stages?.find?.((s) => s.key === 'hardware')?.state === 'in_progress', JSON.stringify(p.stages?.find?.((s) => s.key === 'hardware')));

/* ---------- site receipt: no stock, PO received, task done, POD by room ---------- */
r = await call('POST', '/api/scm/site-receipts', receipt(), { 'Idempotency-Key': randomUUID() });
const grn = r.json?.created?.[0];
if (!check('the trade is received on site as the PO\'s goods receipt, posted', r.status === 201 && grn?.posted === true, show(r))) stop('no site receipt');
const moves = await call('GET', `/api/scm/inventory/movements?itemCode=RN-ELECTRICAL&limit=500`);
check('the site receipt booked no stock', moves.status === 200 && !(moves.json?.movements ?? []).some((m) => m.source_doc_id === grn.id), show(moves));
const again = await call('GET', `/api/scm/site-receipts/projects/${projectId}/open-lines`);
check('nothing is left to receive on the wiring PO', !(again.json?.data ?? []).some((l) => l.po_item_id === wiringLine.po_item_id), show(again));
p = await project(projectId);
const done = (p.tasks ?? []).find((t) => t.trade_code === 'ELECTRICAL');
check('the ELECTRICAL trade task completed on receipt', done?.status === 'done', JSON.stringify(done));
const pod = await call('GET', `${R}/${projectId}/pod`);
const living = pod.json?.rooms?.find((g) => g.room === 'Living');
check('the proof of delivery is grouped by room (Living has the after photo)', pod.status === 200 && !!living?.photos?.some((ph) => ph.r2_key === afterKey), show(pod));
check('...and lists the receipt', (pod.json?.receipts ?? []).some((x) => x.id === grn.id));

console.log(`\nproject ${projectId}, ${soDocNo}, ${grn.grnNumber}\n${fails ? `${fails} failed` : 'all passed'}`);
process.exit(fails ? 1 : 0);
