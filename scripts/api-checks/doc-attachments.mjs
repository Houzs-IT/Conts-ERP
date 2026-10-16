// Photos and documents on every document of the transaction flow, on the whole document and on each line (owner,
// 16 Oct 2026; migration 0119), through a local engine's HTTP API: several files on a sales order, PO, DO and goods
// receipt -> the same file twice is recognised -> a file on an SO line shows, read-only and named, on its PO, DO and
// goods-received lines (nothing copied) -> a line of another document is refused -> caption, ranged read (video
// playback), remove (hidden, with who removed it) -> the renovation project's Documents roll-up groups it all by
// document and line and streams it -> the import check finds documents and lines by number or item code and knows
// what is already attached.
//
// Runs against a local engine (wrangler dev in engine/backend, ENGINE, default http://localhost:8790) with its
// CONTS_SSO_SECRET from engine/backend/.dev.vars, like reno-service-project.mjs. It WRITES one renovation project, a
// sales order, a PO, a DO, a draft goods receipt and their files into whatever database that engine points at, and
// the files into the engine's local R2. Never point it at production; refuses any ENGINE that is not localhost.
// Needs migrations 0116 and 0119, renovation mode, three ACTIVE products, one supplier and a warehouse mapped to
// Selangor (scm.state_warehouse_mappings). Every run uses new file contents, so it can be run again.
//
// Run: ENGINE=http://localhost:8797 node scripts/api-checks/doc-attachments.mjs
import { createHash, createHmac, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const ENGINE = process.env.ENGINE ?? 'http://localhost:8790';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(ENGINE)) { console.error(`ENGINE must be a local engine, not ${ENGINE}`); process.exit(1); }
const secret = readFileSync(new URL('../../engine/backend/.dev.vars', import.meta.url), 'utf8').match(/^CONTS_SSO_SECRET\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
if (!secret) { console.error('CONTS_SSO_SECRET not found in engine/backend/.dev.vars'); process.exit(1); }
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const AREAS = ['scSales', 'scInvoices', 'scConsignment', 'scProcurement', 'scTransportPlan', 'scWarehouse', 'serviceCases', 'projects'];
const E = ENGINE;
const body = b64url(JSON.stringify({ email: 'doc-files-check@theconts.test', name: 'Document Files Check', role: 'management', access: Object.fromEntries(AREAS.map((k) => [k, 'full'])), exp: Date.now() + 45_000 }));
const tok = (await (await fetch(`${E}/api/conts-sso`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assertion: `${body}.${b64url(createHmac('sha256', secret).update(body).digest())}` }) })).json()).token;
if (!tok) { console.error('sign-in failed'); process.exit(1); }
const H = { authorization: `Bearer ${tok}` };
const call = async (m, p, b, extra = {}) => {
  const r = await fetch(E + p, { method: m, headers: { ...H, ...(b && !(b instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}), ...extra }, body: b instanceof Uint8Array ? b : b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j, h: r.headers };
};
let fails = 0;
const ok = (name, cond, detail = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`); };
const stop = (why) => { console.log(`stopped: ${why}`); process.exit(1); };

/* A 4x4 PNG of one colour; the run's own colours make every file new to the database. */
const salt = randomInt(1, 200);
function png(r, g, b) {
  [r, g, b] = [(r + salt) % 256, (g + salt * 3) % 256, (b + salt * 7) % 256];
  const w = 4, h = 4;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td) >>> 0); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const sha = (b) => createHash('sha256').update(b).digest('hex');
const put = (prefix, id, bytes, q, mime = 'image/png') => call('PUT', `/api/scm${prefix}/${encodeURIComponent(id)}/attachments?${new URLSearchParams({ sha256: sha(bytes), ...q })}`, bytes, { 'content-type': mime });

// 0. the documents: a renovation project, its SO, a PO and a DO from the SO's lines, a draft GR from the PO
const types = (await call('GET', '/api/renovation/types')).j.data ?? [];
if (!types.length) stop('no renovation project types (renovation mode?)');
const proj = await call('POST', '/api/renovation', { name: `TEST FILES ${salt}`, projectTypeId: types[0].id, customerKind: 'customer', customerName: 'Tan Mei Ling' });
const prods = (await call('GET', '/api/scm/mfg-products?status=ACTIVE&limit=10')).j;
const products = (prods.products ?? prods.data ?? prods.items ?? []).filter((x) => x.code).slice(0, 3);
if (products.length < 3) stop('needs three ACTIVE products');
const soRes = await call('POST', '/api/scm/mfg-sales-orders', {
  debtorName: 'Tan Mei Ling', phone: '+60123456789', address1: 'A-12-3 Skyline Residence', address2: 'Jalan Ampang', customerState: 'Selangor',
  items: products.map((pr, i) => ({ itemGroup: pr.category, itemCode: pr.code, description: pr.name, uom: 'UNIT', qty: 2, unitPriceSen: 150000 + i * 10000, discountSen: 0, unitCostSen: 0 })),
  renovation: { projectId: proj.j.id, building: 'Skyline Residence', unitNo: 'A-12-3', propertyType: 'Condo', layoutLabel: '3 bed 2 bath', bedrooms: '3', bathrooms: '2', builtUpSqft: '1180' }, noFair: true,
});
const soDocNo = soRes.j.docNo ?? soRes.j.doc_no;
if (!soDocNo) stop(`sales order: ${soRes.s} ${JSON.stringify(soRes.j).slice(0, 300)}`);
const soLines = (await call('GET', `/api/scm/mfg-sales-orders/${soDocNo}/attachments`)).j.lines ?? [];
const soItems = (await call('GET', `/api/scm/mfg-sales-orders/${soDocNo}`)).j;
const soItemRows = soItems.items ?? soItems.salesOrder?.items ?? soItems.lines ?? [];
const suppliers = (await call('GET', '/api/scm/suppliers?limit=1')).j;
const supplierId = (suppliers.suppliers ?? suppliers.data ?? suppliers.items ?? [])[0]?.id;
const whs = (await call('GET', '/api/scm/inventory/warehouses')).j;
const warehouseId = (whs.warehouses ?? whs.data ?? whs.items ?? whs ?? [])[0]?.id;
if (!supplierId || !warehouseId) stop('needs one supplier and one warehouse');
const byId = new Map(soItemRows.map((i) => [i.id, i]));
const lineItems = soLines.map((l) => ({ l, i: byId.get(l.id) ?? {} }));
const poRes = await call('POST', '/api/scm/mfg-purchase-orders', { supplierId, purchaseLocationId: warehouseId, items: lineItems.map(({ l, i }) => ({ soItemId: l.id, itemCode: l.sku, materialName: l.description, description: l.description, itemGroup: i.item_group ?? i.itemGroup, qty: 2, unitPriceSen: 50000, materialKind: 'mfg_product' })) });
const poId = poRes.j.id ?? poRes.j.purchaseOrder?.id;
const doRes = await call('POST', '/api/scm/delivery-orders-mfg', { debtorName: 'Tan Mei Ling', soDocNo, items: lineItems.map(({ l, i }) => ({ soItemId: l.id, itemCode: l.sku, description: l.description, itemGroup: i.item_group ?? i.itemGroup, qty: 2, unitPriceSen: 150000 })) });
const doId = doRes.j.id ?? doRes.j.deliveryOrder?.id;
if (!poId || !doId) stop(`PO ${poRes.s} ${JSON.stringify(poRes.j).slice(0, 200)} / DO ${doRes.s} ${JSON.stringify(doRes.j).slice(0, 200)}`);
const poLinesNow = (await call('GET', `/api/scm/mfg-purchase-orders/${poId}/attachments`)).j.lines ?? [];
const grRes = await call('POST', '/api/scm/grns', { supplierId, purchaseOrderId: poId, warehouseId, asDraft: true, items: poLinesNow.map((l) => ({ purchaseOrderItemId: l.id, itemCode: l.sku, materialName: l.description, materialKind: 'mfg_product', qtyReceived: 2, qtyAccepted: 2, unitPriceSen: 50000 })) });
const grId = grRes.j.id ?? grRes.j.grn?.id;
if (!grId) stop(`GR ${grRes.s} ${JSON.stringify(grRes.j).slice(0, 300)}`);
const seed = { pid: proj.j.id, soDocNo, poId, doId, grId };

// 1. document level, several files, on SO / PO / DO / GR
const red = png(200, 30, 30), green = png(30, 160, 60), blue = png(30, 60, 200);
const pdf = new Uint8Array(Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'));
const so = await put('/mfg-sales-orders', seed.soDocNo, red, { name: 'site-before.png', caption: 'Site before works' });
ok('SO doc upload', so.s === 201, JSON.stringify(so.j));
const so2 = await put('/mfg-sales-orders', seed.soDocNo, pdf, { name: 'signed-quotation.pdf' }, 'application/pdf');
ok('SO second file (PDF)', so2.s === 201);
const dup = await put('/mfg-sales-orders', seed.soDocNo, red, { name: 'site-before-again.png' });
ok('same file twice refused as duplicate', dup.s === 200 && dup.j.duplicate === true, dup.j.message);
for (const [label, prefix, id] of [['PO', '/mfg-purchase-orders', seed.poId], ['DO', '/delivery-orders-mfg', seed.doId], ['GR', '/grns', seed.grId]]) {
  const a = await put(prefix, id, green, { name: `${label}-photo-1.png` });
  const b = await put(prefix, id, blue, { name: `${label}-photo-2.png` });
  ok(`${label} two photos`, a.s === 201 && b.s === 201);
}
// 2. line level + carry forward SO line -> PO line -> GR line, and SO line -> DO line
const soList = await call('GET', `/api/scm/mfg-sales-orders/${seed.soDocNo}/attachments`);
ok('SO list has 2 doc files and 3 lines', soList.j.files?.length === 2 && soList.j.lines?.length === 3, `files=${soList.j.files?.length} lines=${soList.j.lines?.length}`);
const soLine = soList.j.lines[0];
const ln = await put('/mfg-sales-orders', seed.soDocNo, png(240, 200, 0), { name: 'cabinet-sample.png', lineId: soLine.id, caption: 'Customer chose this finish' });
ok('SO line upload', ln.s === 201);
const bad = await put('/mfg-sales-orders', seed.soDocNo, png(1, 2, 3), { name: 'x.png', lineId: '00000000-0000-4000-8000-000000000000' });
ok('upload to a line of another document refused', bad.s === 404);
const poList = await call('GET', `/api/scm/mfg-purchase-orders/${seed.poId}/attachments`);
const poLine = poList.j.lines?.[0];
ok('PO line shows the SO line file, read-only, with where it is from', poLine?.files?.some((f) => f.readOnly && /Sales order/.test(f.from ?? '')), JSON.stringify(poLine?.files?.map((f) => f.from)));
const poOwn = await put('/mfg-purchase-orders', seed.poId, png(90, 0, 90), { name: 'supplier-sample.png', lineId: poLine.id });
ok('PO line own upload', poOwn.s === 201);
const grList = await call('GET', `/api/scm/grns/${seed.grId}/attachments`);
const grFrom = grList.j.lines?.[0]?.files?.map((f) => f.from) ?? [];
ok('GR line shows PO line and SO line files', grFrom.some((f) => /Purchase order/.test(f ?? '')) && grFrom.some((f) => /Sales order/.test(f ?? '')), JSON.stringify(grFrom));
const doList = await call('GET', `/api/scm/delivery-orders-mfg/${seed.doId}/attachments`);
ok('DO line shows the SO line file', doList.j.lines?.some((l) => l.files.some((f) => /Sales order/.test(f.from ?? ''))));
const carried = grList.j.lines[0].files.find((f) => f.readOnly);
const stream = await fetch(`${E}/api/scm/grns/${seed.grId}/attachments/${carried.id}`, { headers: H });
ok('carried file streams from the GR', stream.status === 200 && (stream.headers.get('content-type') ?? '').startsWith('image/'));
const delCarried = await call('DELETE', `/api/scm/grns/${seed.grId}/attachments/${carried.id}`);
ok('carried file cannot be removed from the GR', delCarried.s === 404);
// 3. caption, remove (soft), range request
const f0 = (await call('GET', `/api/scm/grns/${seed.grId}/attachments`)).j.files[0];
ok('caption saved', (await call('PATCH', `/api/scm/grns/${seed.grId}/attachments/${f0.id}`, { caption: 'Box dented on arrival' })).s === 200);
const r = await fetch(`${E}/api/scm/grns/${seed.grId}/attachments/${f0.id}`, { headers: { ...H, range: 'bytes=0-9' } });
ok('range request answers 206', r.status === 206, r.headers.get('content-range'));
ok('remove', (await call('DELETE', `/api/scm/grns/${seed.grId}/attachments/${f0.id}`)).s === 200);
const after = (await call('GET', `/api/scm/grns/${seed.grId}/attachments`)).j.files;
ok('removed file hidden', !after.some((f) => f.id === f0.id) && after.length === 1);
// 4. the project roll-up
const roll = await call('GET', `/api/renovation/${seed.pid}/document-files`);
const g = (t) => roll.j.documents?.find((d) => d.type === t);
ok('roll-up ready with SO, PO, DO, GR', roll.j.ready && ['sales_order', 'purchase_order', 'delivery_order', 'goods_received'].every((t) => g(t)), JSON.stringify(roll.j.documents?.map((d) => [d.type, d.files.length, d.lines.length])));
ok('roll-up SO: 2 doc files and its line', g('sales_order')?.files.length === 2 && g('sales_order')?.lines.length === 1);
const rf = g('purchase_order').files[0];
const rs = await fetch(`${E}/api/renovation/${seed.pid}/document-files/purchase_order/${seed.poId}/${rf.id}`, { headers: H });
ok('roll-up file streams', rs.status === 200);
// 5. import resolve: doc, line by number, line by SKU, unknown, already attached
const res = await call('POST', '/api/scm/doc-attachments/resolve', { items: [
  { docType: 'purchase_order', docNo: poList.j.doc.no, sha256: sha(png(5, 5, 5)) },
  { docType: 'purchase_order', docNo: poList.j.doc.no, line: '2', sha256: sha(png(6, 6, 6)) },
  { docType: 'sales_order', docNo: seed.soDocNo, line: soLine.sku, sha256: sha(png(7, 7, 7)) },
  { docType: 'sales_order', docNo: seed.soDocNo, sha256: sha(red) },
  { docType: 'goods_received', docNo: 'GRN-NOPE', sha256: sha(red) },
  { docType: 'sales_order', docNo: seed.soDocNo, line: '99', sha256: sha(red) },
] });
const st = res.j.results?.map((x) => x.status);
ok('resolve statuses', JSON.stringify(st) === JSON.stringify(['new', 'new', 'new', 'attached', 'no_document', 'no_line']), JSON.stringify(st));
ok('resolve line by SKU finds line 1', res.j.results?.[2]?.lineNo === 1, JSON.stringify(res.j.results?.[2]));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
