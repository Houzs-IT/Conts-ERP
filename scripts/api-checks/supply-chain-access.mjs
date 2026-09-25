// Who can read supply chain records. Field accounts (housekeeper, technician) get none of it;
// operations staff get the stock and order screens but not invoices, payments or accounting;
// management and finance get everything. Read-only: writes nothing.
import { call, callAsUser, check, done } from './harness.mjs';
const staff = { userId: '11111111-1111-4111-8111-00000000aa01', email: 'ops-check@theconts.test', role: 'operations_staff' };
const tech = { userId: '11111111-1111-4111-8111-00000000aa02', email: 'tech-check@theconts.test', role: 'technician' };

const ordersAndStock = ['/api/products', '/api/suppliers', '/api/purchase-orders', '/api/sales-orders', '/api/stock', '/api/delivery-orders', '/api/goods-receipts'];
const money = ['/api/sales-invoices', '/api/purchase-invoices', '/api/payment-vouchers', '/api/unbilled-deliveries', '/api/accounting'];

for (const p of [...ordersAndStock, ...money]) {
  check(`housekeeper refused ${p}`, (await call('GET', p, undefined, 'housekeeper')).status === 403);
  check(`technician refused ${p}`, (await callAsUser(tech, 'GET', p)).status === 403);
  check(`finance admin allowed ${p}`, (await call('GET', p, undefined, 'finance_admin')).status === 200);
  check(`management allowed ${p}`, (await call('GET', p)).status === 200);
}
for (const p of ordersAndStock) check(`operations staff allowed ${p}`, (await callAsUser(staff, 'GET', p)).status === 200);
for (const p of money) check(`operations staff refused ${p}`, (await callAsUser(staff, 'GET', p)).status === 403);
check('housekeeper still reaches their own field screen', (await call('GET', '/api/field/today', undefined, 'housekeeper')).status !== 403);

done();
