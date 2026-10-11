// Item codes on documents must exist in Products (owner, 11 Oct 2026): every create path refuses an unknown code
// with a message naming it, and writes nothing.
import { call, check, done } from './harness.mjs';
const tag = Date.now().toString().slice(-6);
const GOOD = `IC-${tag}`;
const BAD = `NOPE-${tag}`;
await call('POST', '/api/products', { code: GOOD, name: `Item code check ${tag}`, category: 'ACCESSORY' });
const count = async (path) => ((await call('GET', path)).json?.data ?? []).length;

const soBefore = await count('/api/sales-orders');
let r = await call('POST', '/api/sales-orders', { customerName: `IC ${tag}`, lines: [{ itemCode: BAD, description: 'Typo', qty: 1, unitPriceSen: 100 }] });
check('sales order with an unknown item code refused (409, names the code)', r.status === 409 && r.text.includes(BAD), r.text);
check('...and nothing was written', await count('/api/sales-orders') === soBefore);

r = await call('POST', '/api/suppliers', { code: `ICS${tag}`, name: `IC Supplier ${tag}` }); const SUP = r.json?.id;
r = await call('POST', '/api/purchase-orders', { supplierId: SUP, lines: [{ itemCode: BAD, description: 'Typo', qty: 1, unitPriceSen: 100 }] });
check('purchase order with an unknown item code refused (409)', r.status === 409 && r.text.includes(BAD), r.text);

r = await call('POST', '/api/sales-orders', { customerName: `IC ${tag}`, lines: [{ itemCode: GOOD, description: 'Real', qty: 1, unitPriceSen: 100 }] });
check('a sales order with a Products code is accepted', r.status === 201, r.text);
const SO = r.json?.id;
const soLine = (await call('GET', `/api/sales-orders/${SO}`)).json?.data?.lines?.[0];
r = await call('POST', '/api/delivery-orders', { salesOrderId: SO, lines: [{ salesOrderLineId: soLine?.id, itemCode: BAD, description: 'Typo', qty: 1, unitPriceSen: 100 }] });
check('delivery order with an unknown item code refused (409)', r.status === 409 && r.text.includes(BAD), r.text);
r = await call('PATCH', `/api/sales-orders/${SO}`, { lines: [{ itemCode: BAD, description: 'Typo', qty: 1, unitPriceSen: 100 }] });
check('editing a sales order onto an unknown item code refused (409)', r.status === 409 && r.text.includes(BAD), r.text);

done();
