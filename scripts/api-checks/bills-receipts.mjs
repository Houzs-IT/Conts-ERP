// A bill the owner pays carries its receipt (staff comment sheet, Oct 2026: "issue with receipt together"), enforced by
// the server on every way a bill goes in: one bill (POST /api/expenses: owner page "Add a bill", Accounts payable "Add
// utility bill" and "Add expense") and the monthly screen (POST /api/expenses/utilities). Bills the company, a tenant or a
// guest pays, and cleaning, need none. An older bill without one stays valid and gets one attached later (PATCH with
// receiptDocumentId alone, allowed on a final month). The monthly screen also lists units with no account number on file,
// and POST /api/expenses/utility-accounts puts one on file.
// Needs a fresh local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://pos_app:local@127.0.0.1:55632/postgres API_BASE=http://localhost:8931 node scripts/api-checks/bills-receipts.mjs
import postgres from 'postgres';
import { call, check, done, receiptFor } from './harness.mjs';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to the local test database.'); process.exit(2); }
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};

// A unit with no utility account on file, whose owner has no statement for the month yet.
const month = '2026-03';
const [unit] = await db(`SELECT u.id, u.owner_id, p.name || ' ' || u.unit_number AS label FROM units u JOIN properties p ON p.id = u.property_id
  WHERE u.parent_unit_id IS NULL AND NOT EXISTS (SELECT 1 FROM unit_utility_accounts a WHERE a.unit_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM owner_statements s WHERE s.owner_id = u.owner_id AND s.period_start LIKE $1) ORDER BY u.id LIMIT 1`, `${month}%`);
check('a unit with no account on file and an open month', !!unit);
const day = `${month}-20`;

/* ---------- one bill ---------- */
let r = await call('POST', '/api/expenses', { unitId: unit.id, category: 'water', amount: 4200, incurredOn: day, chargeTo: 'owner', description: 'Water, no receipt' });
check('owner-paid water bill without a receipt is refused (422 RECEIPT_REQUIRED)', r.status === 422 && r.json?.error?.code === 'RECEIPT_REQUIRED' && !!r.json.error.fields?.receipt, r.text);
r = await call('POST', '/api/expenses', { unitId: unit.id, category: 'other', amount: 4200, incurredOn: day, description: 'Deduction, no payer given' });
check('an additional deduction with no payer given (owner by default) is refused too', r.status === 422 && r.json?.error?.code === 'RECEIPT_REQUIRED', r.text);
r = await call('POST', '/api/expenses', { unitId: unit.id, category: 'internet', amount: 9900, incurredOn: day, chargeTo: 'the_conts', description: 'Wi-Fi, company pays' });
check('a bill the company pays needs no receipt', r.status === 201, r.text);
const companyBill = r.json?.id;
r = await call('POST', '/api/expenses', { unitId: unit.id, category: 'electricity', amount: 9900, incurredOn: day, chargeTo: 'tenant', description: 'Electricity, tenant pays' });
check('a bill the tenant pays needs no receipt', r.status === 201, r.text);
r = await call('POST', '/api/expenses', { unitId: unit.id, category: 'cleaning', amount: 8000, incurredOn: day, chargeTo: 'owner', description: 'Extra clean' });
check('a cleaning cost needs no receipt', r.status === 201, r.text);
const receipt = await receiptFor(unit.id);
r = await call('POST', '/api/expenses', { unitId: unit.id, category: 'other', amount: 5500, incurredOn: day, chargeTo: 'owner', description: 'Replace aircon filter', receiptDocumentId: receipt });
check('an owner-paid deduction with its receipt is recorded', r.status === 201, r.text);

r = await call('PATCH', `/api/expenses/${companyBill}`, { chargeTo: 'owner' });
check('turning a company bill into one the owner pays needs its receipt', r.status === 422 && r.json?.error?.code === 'RECEIPT_REQUIRED', r.text);

// A bill recorded before the rule (no receipt): still valid, gets one attached later.
const [old] = await db(`INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, charge_to, created_by, created_at)
  VALUES (gen_random_uuid()::text, $1, 'water', 'Water, recorded before receipts were required', 3100, 'MYR', $2, 'owner', '11111111-1111-4111-8111-000000000002', $3) RETURNING id`, unit.id, day, new Date().toISOString());
r = await call('PATCH', `/api/expenses/${old.id}`, { description: 'Water, older bill (edited)' });
check('an older owner bill without a receipt can still be edited', r.status === 200, r.text);

/* ---------- the monthly screen ---------- */
r = await call('GET', `/api/expenses/utilities?month=${month}&unitId=${encodeURIComponent(unit.id)}`);
check('a unit with no account is listed as such', r.status === 200 && r.json.data.length === 0 && r.json.unitsWithoutAccount?.some(u => u.unitId === unit.id), r.text);
r = await call('GET', `/api/expenses/utilities?month=${month}`);
check('the all-units screen lists it too', r.json?.unitsWithoutAccount?.some(u => u.unitId === unit.id), '');
r = await call('POST', '/api/expenses/utility-accounts', { unitId: unit.id, kind: 'water', accountNo: '' });
check('an account needs its number', r.status === 422 && !!r.json?.error?.fields?.accountNo, r.text);
r = await call('POST', '/api/expenses/utility-accounts', { unitId: unit.id, kind: 'water', accountNo: 'AIR-CHK-1', provider: 'Air Selangor' });
check('account number put on file', r.status === 201 && !!r.json?.id, r.text);
const accountId = r.json?.id;
r = await call('POST', '/api/expenses/utility-accounts', { unitId: unit.id, kind: 'water', accountNo: 'air-chk-1' });
check('the same account twice is refused', r.status === 409, r.text);
r = await call('POST', '/api/expenses/utility-accounts', { unitId: unit.id, kind: 'water', accountNo: 'X' }, 'housekeeper');
check('a field role cannot add one', r.status === 403, r.text);
r = await call('GET', `/api/expenses/utilities?month=${month}&unitId=${encodeURIComponent(unit.id)}`);
check('the unit now has its account line and is off the no-account list', r.json?.data?.some(a => a.accountId === accountId) && !r.json.unitsWithoutAccount.some(u => u.unitId === unit.id), r.text);

r = await call('POST', '/api/expenses/utilities', { month, date: day, rows: [{ accountId, amount: 6100, chargeTo: 'owner' }] });
check('monthly screen: an owner-paid bill without a receipt is refused, naming the line', r.status === 422 && r.json?.error?.code === 'RECEIPT_REQUIRED' && !!r.json.error.fields?.[accountId], r.text);
r = await call('POST', '/api/expenses/utilities', { month, date: day, rows: [{ accountId, amount: 6100, chargeTo: 'the_conts' }] });
check('monthly screen: the company paying needs none', r.status === 201 && r.json?.saved === 1, r.text);
const r2 = await receiptFor(unit.id);
r = await call('POST', '/api/expenses/utilities', { month, date: day, rows: [{ accountId, amount: 6200, chargeTo: 'owner', receiptDocumentId: r2 }] });
check('monthly screen: owner-paid bill with its receipt recorded', r.status === 201 && r.json?.saved === 1, r.text);
let [bill] = await db(`SELECT id, amount, receipt_document_id FROM expenses WHERE unit_id = $1 AND reference = 'AIR-CHK-1' AND incurred_on LIKE $2`, unit.id, `${month}%`);
check('...the bill carries the receipt', bill?.receipt_document_id === r2 && Number(bill.amount) === 6200, JSON.stringify(bill));
r = await call('GET', `/api/expenses/utilities?month=${month}&unitId=${encodeURIComponent(unit.id)}`);
check('...and the screen shows it on file', r.json?.data?.find(a => a.accountId === accountId)?.receiptDocumentId === r2, r.text);
r = await call('POST', '/api/expenses/utilities', { month, date: day, rows: [{ accountId, amount: 6300, chargeTo: 'owner' }] });
check('re-entering the month keeps the receipt already on that bill', r.status === 201, r.text);
[bill] = await db(`SELECT id, amount, receipt_document_id FROM expenses WHERE unit_id = $1 AND reference = 'AIR-CHK-1' AND incurred_on LIKE $2`, unit.id, `${month}%`);
check('...same receipt, new amount', bill?.receipt_document_id === r2 && Number(bill.amount) === 6300, JSON.stringify(bill));

/* ---------- final month: a receipt can still be attached ---------- */
r = await call('POST', '/api/statements/generate', { period: month, ownerIds: [unit.owner_id] });
check('statement generated', r.status < 300, r.text);
const [st] = await db(`SELECT id FROM owner_statements WHERE owner_id = $1 AND period_start LIKE $2`, unit.owner_id, `${month}%`);
r = await call('POST', '/api/statements/finalise', { statementIds: [st.id] });
check('statement finalised', r.status === 200, r.text);
r = await call('PATCH', `/api/expenses/${old.id}`, { amount: 3200 });
check('the older bill is locked for money changes', r.status === 409, r.text);
const r3 = await receiptFor(unit.id);
r = await call('PATCH', `/api/expenses/${old.id}`, { receiptDocumentId: r3 });
check('...but its receipt can be attached', r.status === 200, r.text);
const [after] = await db(`SELECT amount, receipt_document_id FROM expenses WHERE id = $1`, old.id);
check('...receipt on the bill, amount unchanged', after.receipt_document_id === r3 && Number(after.amount) === 3100, JSON.stringify(after));
r = await call('GET', `/api/statements/${st.id}`);
check('the statement line now links that receipt', r.json?.data?.lines?.some(l => l.expenseId === old.id && l.receipt?.id === r3), '');
const [audited] = await db(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'expense.receipt' AND entity_id = $1`, old.id);
check('attaching it is audited', audited.n === 1, JSON.stringify(audited));
r = await call('PATCH', `/api/expenses/${old.id}`, { receiptDocumentId: 'no-such-document' });
check('an unknown receipt is refused', r.status === 422, r.text);
done();
