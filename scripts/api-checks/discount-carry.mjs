// A sales order line's discount carries through to its delivery orders and invoices (owner, 11 Oct 2026), shared
// out by quantity: delivering half the line carries half the discount, and the pieces add up to the whole.
import { call, check, done } from './harness.mjs';
const tag = Date.now().toString().slice(-6);

const code = `DSC-${tag}`;
await call('POST', '/api/products', { code, name: `Discount item ${tag}`, category: 'ACCESSORY', sellPriceSen: 10000 });
let r = await call('POST', '/api/sales-orders', { customerName: `Discount Customer ${tag}`, lines: [{ itemCode: code, description: 'Discount item', qty: 2, unitPriceSen: 10000, discountSen: 4000 }] });
const SO = r.json?.id;
const soLine = (await call('GET', `/api/sales-orders/${SO}`)).json?.data?.lines?.[0];
check('sales order line: 2 x RM 100 less RM 40 = RM 160', soLine?.lineTotalSen === 16000, JSON.stringify(soLine));

const deliver = (qty) => call('POST', '/api/delivery-orders', { salesOrderId: SO, lines: [{ salesOrderLineId: soLine?.id, itemCode: code, description: 'Discount item', qty, unitPriceSen: 10000 }] });
r = await deliver(1); const DO1 = r.json?.id;
let line = (await call('GET', `/api/delivery-orders/${DO1}`)).json?.data?.lines?.[0];
check('first delivery of 1 carries half the discount (RM 80, discount RM 20)', line?.lineTotalSen === 8000 && line?.discountSen === 2000, JSON.stringify(line));
r = await deliver(1); const DO2 = r.json?.id;
line = (await call('GET', `/api/delivery-orders/${DO2}`)).json?.data?.lines?.[0];
check('second delivery carries the rest, never the whole discount again', line?.lineTotalSen === 8000 && line?.discountSen === 2000, JSON.stringify(line));

r = await call('POST', '/api/sales-invoices', { deliveryOrderId: DO1 });
const si = (await call('GET', `/api/sales-invoices/${r.json?.id}`)).json?.data;
check('the invoice carries the delivery line net of its discount', si?.totalSen === 8000 && si?.lines?.[0]?.discountSen === 2000, JSON.stringify(si));

done();
