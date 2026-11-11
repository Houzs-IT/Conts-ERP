// node --test src/lib/requestBill.test.mjs (npm test). A Direct pay request's bill fills only what is still empty
// (TODO item 19, Houzs payment-request-bill.ts): nothing typed or picked is overwritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestBillFill } from './requestBill.ts';

const EMPTY = { amountSen: null, hasSupplierOrPo: false, payeeName: '', wantedOn: '', note: '', today: '2026-11-10' };
const READ = {
  amountSen: 120050, date: '2026-11-02', vendorName: 'ACE HARDWARE SDN BHD', dueDate: '2026-12-02',
  summary: 'Door hinges, Skyline A-01', documentKind: 'invoice', supplier: { id: 'S1', code: '400-A001', name: 'ACE HARDWARE' },
};

test('an empty form takes the amount, the matched supplier, the due date and what it is for', () => {
  assert.deepEqual(requestBillFill(READ, EMPTY), {
    amountSen: 120050, supplier: { id: 'S1', code: '400-A001', name: 'ACE HARDWARE' }, wantedOn: '2026-12-02', note: 'Door hinges, Skyline A-01',
  });
});

test('what was typed or picked stays; a request against a PO or a supplier takes no supplier or payee', () => {
  const typed = { ...EMPTY, amountSen: 5000, hasSupplierOrPo: true, wantedOn: '2026-11-20', note: 'Deposit' };
  assert.deepEqual(requestBillFill(READ, typed), {});
});

test('no supplier on the list: the printed issuer goes to Pay to, unless one is typed', () => {
  const read = { ...READ, supplier: null };
  assert.equal(requestBillFill(read, EMPTY).payeeName, 'ACE HARDWARE SDN BHD');
  assert.equal(requestBillFill(read, { ...EMPTY, payeeName: 'Mr Tan' }).payeeName, undefined);
});

test('a past due date, a zero total or an unreadable bill fill nothing', () => {
  assert.equal(requestBillFill({ ...READ, dueDate: '2026-11-01' }, EMPTY).wantedOn, undefined);
  assert.equal(requestBillFill({ ...READ, amountSen: 0 }, EMPTY).amountSen, undefined);
  assert.deepEqual(requestBillFill({ amountSen: null, date: null, vendorName: null }, EMPTY), {});
});
