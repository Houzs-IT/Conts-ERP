// Negative-stock rules, copied from Houzs ERP:
//   refused outright  — manual adjustment decrease, stock transfer, cancelling a goods receipt
//                       whose goods already left
//   asks first        — delivery order and purchase return (409 SHORT_STOCK, then resend with
//                       confirmShortStock: true)
// Every refusal must leave nothing written.
import { call, check, done } from './harness.mjs';
const tag = Date.now().toString().slice(-6);
const ITEM = `NEG-${tag}`;
await call('POST', '/api/products', { code: ITEM, name: `Neg item ${tag}`, category: 'ACCESSORY' }); // documents only take Products codes
const onHand = async (wh) => ((await call('GET', `/api/stock?warehouseId=${wh}`)).json?.data ?? []).find(s => s.itemCode === ITEM)?.onHand ?? 0;
const count = async (path) => ((await call('GET', path)).json?.data ?? []).length;

let r = await call('POST', '/api/warehouses', { code: `WA${tag}`, name: `Neg A ${tag}` }); const A = r.json?.id;
r = await call('POST', '/api/warehouses', { code: `WB${tag}`, name: `Neg B ${tag}` }); const B = r.json?.id;
check('two warehouses created', !!A && !!B, r.text);

// --- manual adjustment: hard block ---
r = await call('POST', '/api/stock', { itemCode: ITEM, warehouseId: A, qtyDelta: 3 }); check('adjust +3 allowed', r.status === 201, r.text);
r = await call('POST', '/api/stock', { itemCode: ITEM, warehouseId: A, qtyDelta: -5 });
check('adjust -5 with 3 on hand refused (422 INSUFFICIENT_STOCK)', r.status === 422 && r.json?.error?.code === 'INSUFFICIENT_STOCK', r.text);
check('refused adjustment wrote nothing (still 3)', await onHand(A) === 3, await onHand(A));
r = await call('POST', '/api/stock', { itemCode: ITEM, warehouseId: A, qtyDelta: -3 }); check('adjust -3 down to exactly 0 allowed', r.status === 201, r.text);
r = await call('POST', '/api/stock', { itemCode: ITEM, warehouseId: A, qtyDelta: 4 }); check('adjust +4 allowed', r.status === 201, r.text);

// --- stock transfer: hard block, two lines of the same item judged together ---
r = await call('POST', '/api/stock-transfers', { fromWarehouseId: A, toWarehouseId: B, lines: [{ itemCode: ITEM, qty: 3 }, { itemCode: ITEM, qty: 2 }] });
check('transfer 3+2 with 4 on hand refused (409 INSUFFICIENT_STOCK)', r.status === 409 && r.json?.error?.code === 'INSUFFICIENT_STOCK', r.text);
check('refused transfer wrote nothing (A 4, B 0)', await onHand(A) === 4 && await onHand(B) === 0, `${await onHand(A)}/${await onHand(B)}`);
r = await call('POST', '/api/stock-transfers', { fromWarehouseId: A, toWarehouseId: B, lines: [{ itemCode: ITEM, qty: 4 }] });
check('transfer 4 with 4 on hand allowed', r.status === 201, r.text);
check('after transfer A 0, B 4', await onHand(A) === 0 && await onHand(B) === 4, `${await onHand(A)}/${await onHand(B)}`);

// --- goods receipt into A, then deliver it away, then try to cancel the receipt ---
r = await call('POST', '/api/suppliers', { code: `SN${tag}`, name: `Neg Supplier ${tag}` }); const SUP = r.json?.id;
r = await call('POST', '/api/purchase-orders', { supplierId: SUP, warehouseId: A, lines: [{ itemCode: ITEM, description: 'Neg item', qty: 2, unitPriceSen: 10000 }] }); const PO = r.json?.id;
const poLine = (await call('GET', `/api/purchase-orders/${PO}`)).json?.data?.lines?.[0];
r = await call('POST', '/api/goods-receipts', { purchaseOrderId: PO, warehouseId: A, lines: [{ purchaseOrderLineId: poLine?.id, itemCode: ITEM, description: 'Neg item', qtyReceived: 2, qtyAccepted: 2, unitPriceSen: 10000 }] });
const GRN = r.json?.id; check('receive 2 into A', r.status === 201 && await onHand(A) === 2, r.text);

r = await call('POST', '/api/sales-orders', { customerName: `Neg Customer ${tag}`, lines: [{ itemCode: ITEM, description: 'Neg item', qty: 5, unitPriceSen: 20000 }] }); const SO = r.json?.id;
const soLine = (await call('GET', `/api/sales-orders/${SO}`)).json?.data?.lines?.[0];
const doBody = (qty, confirm) => ({ salesOrderId: SO, warehouseId: A, lines: [{ salesOrderLineId: soLine?.id, itemCode: ITEM, description: 'Neg item', qty, unitPriceSen: 20000 }], ...(confirm ? { confirmShortStock: true } : {}) });

// --- delivery order: asks first ---
const dosBefore = await count('/api/delivery-orders');
r = await call('POST', '/api/delivery-orders', doBody(3));
check('deliver 3 with 2 on hand asks (409 SHORT_STOCK)', r.status === 409 && r.json?.error?.code === 'SHORT_STOCK', r.text);
check('the question names need/available/short', /need 3, available 2 \(short 1\)/.test(r.json?.error?.message ?? ''), r.json?.error?.message);
check('asking wrote nothing (no new DO, A still 2)', await count('/api/delivery-orders') === dosBefore && await onHand(A) === 2, '');
r = await call('POST', '/api/delivery-orders', doBody(2));
check('deliver 2 with 2 on hand goes straight through', r.status === 201, r.text);
check('A now 0', await onHand(A) === 0, await onHand(A));

// --- cancelling the receipt now would take A below zero: refused ---
r = await call('PATCH', `/api/goods-receipts/${GRN}`, { status: 'CANCELLED' });
check('cancel receipt whose goods left refused (409 STOCK_ALREADY_USED)', r.status === 409 && r.json?.error?.code === 'STOCK_ALREADY_USED', r.text);
check('refused cancel changed nothing (A 0, receipt still posted)', await onHand(A) === 0 && (await call('GET', `/api/goods-receipts/${GRN}`)).json?.data?.status !== 'CANCELLED', '');

// --- purchase return: asks first, confirm goes through ---
const grnLine = (await call('GET', `/api/goods-receipts/${GRN}`)).json?.data?.lines?.[0];
const prBody = (confirm) => ({ grnId: GRN, lines: [{ grnLineId: grnLine?.id, itemCode: ITEM, description: 'Neg item', qtyReturned: 1, unitPriceSen: 10000 }], ...(confirm ? { confirmShortStock: true } : {}) });
const prsBefore = await count('/api/purchase-returns');
r = await call('POST', '/api/purchase-returns', prBody(false));
check('return 1 with 0 on hand asks (409 SHORT_STOCK)', r.status === 409 && r.json?.error?.code === 'SHORT_STOCK', r.text);
check('asking wrote nothing (no new return)', await count('/api/purchase-returns') === prsBefore, '');
r = await call('POST', '/api/purchase-returns', prBody(true));
check('confirmed return goes through', r.status === 201, r.text);
check('confirmed return took A to -1', await onHand(A) === -1, await onHand(A));

// --- delivery confirmed anyway ---
r = await call('POST', '/api/delivery-orders', doBody(1, true));
check('confirmed delivery goes through', r.status === 201, r.text);
check('A now -2', await onHand(A) === -2, await onHand(A));

done();
