// The utility listing (plan docs/superpowers/plans/2026-10-28-utility-listing.md): every unit, its utility bills by bill
// month with whether the owner has been charged, and the nights booked. Read only.
// Needs a fresh local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://postgres@127.0.0.1:55441/postgres API_BASE=http://localhost:8891 node scripts/api-checks/utility-listing.mjs
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { call, check, cookieFor, done } from './harness.mjs';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to the local test database.'); process.exit(2); }
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};

// Two whole units of different owners, with months nobody has bills or statements for (2029).
const [a, b] = await db(`SELECT u.id, u.owner_id, u.property_id FROM units u WHERE u.parent_unit_id IS NULL AND u.owner_id IS NOT NULL ORDER BY u.id`)
  .then(us => [us[0], us.find(u => u.owner_id !== us[0]?.owner_id)]);
check('two units of different owners', !!a && !!b);
if (!a || !b) { done(); process.exit(1); }
for (const u of [a, b]) {
  await db(`DELETE FROM expenses WHERE unit_id = $1 AND incurred_on >= '2028-10-01' AND incurred_on < '2030-01-01'`, u.id);
  await db(`DELETE FROM owner_statements WHERE owner_id = $1 AND period_start >= '2029-01-01' AND period_start < '2030-01-01'`, u.owner_id);
}
const bill = async (o) => {
  const id = randomUUID();
  await db(`INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, deduct_month, rolled, record_only, charge_to, created_at)
    VALUES ($1, $2, $3, 'Utility check', $4, 'MYR', $5, $6, $7, $8, $9, now())`,
    id, a.id, o.kind, o.amount, o.date, o.deduct ?? o.date.slice(0, 7), !!o.rolled, !!o.recordOnly, o.chargeTo ?? 'owner');
  return id;
};
const charged = await bill({ kind: 'electricity', amount: 12345, date: '2029-03-31' });
const pending = await bill({ kind: 'water', amount: 2000, date: '2029-02-28' });
const company = await bill({ kind: 'internet', amount: 10494, date: '2029-03-31', chargeTo: 'company' });
const record = await bill({ kind: 'sewerage', amount: 800, date: '2029-03-31', recordOnly: true });
const rolled = await bill({ kind: 'water', amount: 3000, date: '2029-04-30', deduct: '2029-05', rolled: true });
const before = await bill({ kind: 'electricity', amount: 999, date: '2028-11-30' });
// March is final for unit a's owner; May is not.
await db(`INSERT INTO owner_statements (id, owner_id, period_start, period_end, state, generated_at, created_at)
  VALUES ($1, $2, '2029-03-01', '2029-03-31', 'finalised', now()::text, now()::text)`, randomUUID(), a.owner_id).catch(e => check('final March statement seeded', false, e.message));
// A stay of 3 nights in March and 2 in April (check-in 29 March, check-out 3 April).
const [guest] = await db(`SELECT id FROM guests LIMIT 1`);
await db(`INSERT INTO reservations (id, unit_id, guest_id, check_in, check_out, state, channel, created_at, updated_at)
  VALUES ($1, $2, $3, '2029-03-29', '2029-04-03', 'confirmed', 'direct', now()::text, now()::text)`, randomUUID(), a.id, guest?.id ?? null)
  .catch(e => check('stay seeded', false, e.message));

let r = await call('GET', '/api/expenses/utility-listing?from=2029-01&to=2029-06', undefined, 'housekeeper');
check('only finance and management may see it', r.status === 403, r.status);
r = await call('GET', '/api/expenses/utility-listing?from=2029-01&to=2029-06');
check('listing loads', r.status === 200, r.text);
const j = r.json ?? {};
check('months newest first', j.months?.[0] === '2029-06' && j.months?.length === 6, JSON.stringify(j.months));
check('both units are listed, also the one with no bills', [a.id, b.id].every(id => j.units?.some(u => u.id === id)), JSON.stringify(j.units?.length));
r = await call('GET', `/api/expenses/utility-listing?from=2029-01&to=2029-06&building=${a.property_id}`);
check('one building only', r.status === 200 && r.json?.units?.length > 0 && r.json.units.every(u => u.buildingId === a.property_id) && r.json.units.some(u => u.id === a.id), r.text.slice(0, 300));
const by = Object.fromEntries((j.bills ?? []).map(x => [x.id, x]));
check('a bill on a final statement is final', by[charged]?.final === true && by[charged]?.chargeTo === 'owner', JSON.stringify(by[charged]));
check('a bill not yet deducted is not final', by[pending]?.final === false, JSON.stringify(by[pending]));
check('a company-paid bill says so', by[company]?.chargeTo !== 'owner', JSON.stringify(by[company]));
check('a record-only bill says so', by[record]?.recordOnly === true, JSON.stringify(by[record]));
check('a late bill sits in its bill month with its deduction month', by[rolled]?.billMonth === '2029-04' && by[rolled]?.deductMonth === '2029-05' && by[rolled]?.rolled === true, JSON.stringify(by[rolled]));
check('kinds are the expense categories', by[record]?.kind === 'sewerage' && by[charged]?.kind === 'electricity');
check('the three months before the range come for the unusual check, not as months', by[before]?.billMonth === '2028-11' && !j.months?.includes('2028-11'), JSON.stringify(by[before]));
check('nights booked per month', j.nights?.[a.id]?.['2029-03'] === 3 && j.nights?.[a.id]?.['2029-04'] === 2, JSON.stringify(j.nights?.[a.id]));
r = await call('GET', `/api/expenses/utility-listing?from=2029-01&to=2029-06&unit=${b.id}`);
check('one unit only', r.json?.units?.length === 1 && r.json?.units?.[0]?.id === b.id && (r.json?.bills ?? []).length === 0, r.text.slice(0, 300));
r = await call('GET', '/api/expenses/utility-listing?from=2027-01&to=2029-06');
check('more than 24 months is refused', r.status === 422 && /24 months/.test(r.text), r.text);
r = await call('GET', '/api/expenses/utility-listing?from=2029-06&to=2029-01');
check('a range back to front is refused', r.status === 422, r.text);
r = await call('GET', '/api/expenses/utility-listing');
check('the default is the twelve months to this month', r.status === 200 && r.json?.months?.length === 12, JSON.stringify(r.json?.months));

// By payment request (chew, 5 Nov 2026; SOP 3.10; migration 0219): a February bill requested on 10 April sits in April.
const [co] = await db(`SELECT id FROM public.companies ORDER BY id LIMIT 1`);
const reqA = randomUUID(), reqB = randomUUID();
await db(`INSERT INTO scm.payment_requests (id, company_id, request_no, type, requester_user_id, payee_name, amount_sen, status, created_at)
  VALUES ($1, $3, 'PRQ-CHK-001', 'PAYMENT', 'chk', 'TNB', 2000, 'PART_PAID', '2029-04-10T10:00:00+08:00'),
         ($2, $3, 'PRQ-CHK-002', 'PAYMENT', 'chk', 'TNB', 12345, 'REJECTED', '2029-06-01T00:30:00+08:00')`, reqA, reqB, co.id)
  .catch(e => check('payment requests seeded', false, e.message));
await db(`UPDATE expenses SET payment_request_id = $1, payment_request_no = 'PRQ-CHK-001' WHERE id = $2`, reqA, pending);
await db(`UPDATE expenses SET payment_request_id = $1, payment_request_no = 'PRQ-CHK-002' WHERE id = $2`, reqB, charged);
r = await call('GET', '/api/expenses/utility-listing?from=2029-01&to=2029-06&by=request');
const byReq = Object.fromEntries((r.json?.bills ?? []).map(x => [x.id, x]));
check('by request: only bills whose request was made in the months', r.status === 200 && !!byReq[pending] && !byReq[company] && !byReq[record], r.text.slice(0, 300));
check('by request: the February bill carries its April request (MYT month), number and status', byReq[pending]?.billMonth === '2029-02' && byReq[pending]?.request?.month === '2029-04'
  && byReq[pending]?.request?.no === 'PRQ-CHK-001' && byReq[pending]?.request?.status === 'PART_PAID' && byReq[pending]?.request?.amount === 2000, JSON.stringify(byReq[pending]));
check('by request: a rejected request still comes, with its status, for the screen to leave out', byReq[charged]?.request?.status === 'REJECTED' && byReq[charged]?.request?.month === '2029-06', JSON.stringify(byReq[charged]));
r = await call('GET', '/api/expenses/utility-listing?from=2029-01&to=2029-06');
const byMonth = Object.fromEntries((r.json?.bills ?? []).map(x => [x.id, x]));
check('by bill month: a bill shows its request too, and one with none has null', byMonth[pending]?.request?.no === 'PRQ-CHK-001' && byMonth[company]?.request === null, JSON.stringify([byMonth[pending]?.request, byMonth[company]?.request]));
check('each unit says its purpose (rental, showroom, warehouse)', (r.json?.units ?? []).every(u => ['rental', 'showroom', 'warehouse'].includes(u.purpose)), JSON.stringify((r.json?.units ?? []).slice(0, 3)));

// "Owner paid this bill" on a bill entered by hand: shared as usual, the whole bill back to the owner as O2, nothing to pay.
r = await call('POST', '/api/expenses', { unitId: a.id, category: 'water', amount: 4321, incurredOn: '2029-06-30', chargeTo: 'the_conts', ownerPaid: true, description: 'Utility check' });
const paidId = r.json?.id;
const [paidRow] = paidId ? await db(`SELECT owner_paid FROM expenses WHERE id = $1`, paidId) : [];
const paidAdj = paidId ? await db(`SELECT amount, kind, state, owner_id FROM owner_adjustments WHERE expense_id = $1`, paidId) : [];
check('owner paid by hand: recorded with the tick, an open O2 credit of the whole bill on the owner, nothing to pay',
  r.status === 201 && paidRow?.owner_paid === true && paidAdj.length === 1 && paidAdj[0].amount === 4321 && paidAdj[0].kind === 'credit' && paidAdj[0].state === 'open' && paidAdj[0].owner_id === a.owner_id && (r.json?.toPay ?? []).length === 0,
  JSON.stringify({ r: r.json, paidRow, paidAdj }));
r = await call('POST', '/api/expenses', { unitId: a.id, category: 'internet', amount: 9900, incurredOn: '2029-06-30', chargeTo: 'the_conts', description: 'Utility check' });
check('a bill the company pays comes back to be sent for payment, under its kind when no account names a provider',
  r.status === 201 && r.json?.toPay?.length === 1 && r.json.toPay[0].provider === 'Internet' && r.json.toPay[0].expenseIds?.[0] === r.json.id && r.json.toPay[0].amountSen === 9900, r.text.slice(0, 300));
r = await call('POST', '/api/expenses', { unitId: a.id, category: 'cleaning', amount: 100, incurredOn: '2029-06-30', chargeTo: 'the_conts', ownerPaid: true });
check('only a utility bill can be marked as paid by the owner', r.status === 422, r.text.slice(0, 200));

// A bill already sent for payment is not replaced from "Enter this month's bills".
const acc = randomUUID();
await db(`INSERT INTO unit_utility_accounts (id, unit_id, kind, account_no, provider, created_at, updated_at) VALUES ($1, $2, 'electricity', 'CHK-ACC-1', 'TNB', now()::text, now()::text)`, acc, a.id)
  .catch(e => check('account seeded', false, e.message));
const sentBill = await bill({ kind: 'electricity', amount: 5000, date: '2029-05-31', chargeTo: 'the_conts' });
await db(`UPDATE expenses SET reference = 'CHK-ACC-1', payment_request_id = $1, payment_request_no = 'PRQ-CHK-001' WHERE id = $2`, reqA, sentBill);
r = await call('POST', '/api/expenses/utilities', { month: '2029-05', rows: [{ accountId: acc, amount: 7000, chargeTo: 'the_conts' }] });
const [still] = await db(`SELECT amount FROM expenses WHERE id = $1`, sentBill);
check('a bill already sent for payment is skipped, not replaced', r.status === 201 && r.json?.requested?.includes('CHK-ACC-1') && r.json?.saved === 0 && still?.amount === 5000, JSON.stringify({ r: r.json, still }));
r = await call('GET', `/api/expenses/utilities?month=2029-05&unitId=${a.id}`);
const line = (r.json?.data ?? []).find(x => x.accountId === acc);
check('the month screen shows the bill as sent for payment', line?.paymentRequestNo === 'PRQ-CHK-001' && line?.ownerPaid === false, JSON.stringify(line));
r = await call('POST', '/api/expenses/utilities', { month: '2029-06', rows: [{ accountId: acc, amount: 6100, chargeTo: 'the_conts', ownerPaid: true }] });
const [june] = await db(`SELECT id, owner_paid FROM expenses WHERE unit_id = $1 AND reference = 'CHK-ACC-1' AND incurred_on >= '2029-06-01' AND incurred_on < '2029-07-01'`, a.id);
const juneAdj = june ? await db(`SELECT amount FROM owner_adjustments WHERE expense_id = $1`, june.id) : [];
check('owner paid on the month screen: the tick is kept, the whole bill back as O2, nothing to pay', r.status === 201 && june?.owner_paid === true && juneAdj.length === 1 && juneAdj[0].amount === 6100 && (r.json?.toPay ?? []).length === 0, JSON.stringify({ r: r.json, june, juneAdj }));
r = await call('POST', '/api/expenses/utilities', { month: '2029-06', rows: [{ accountId: acc, amount: 6200, chargeTo: 'the_conts' }] });
const [june2] = await db(`SELECT id FROM expenses WHERE unit_id = $1 AND reference = 'CHK-ACC-1' AND incurred_on >= '2029-06-01' AND incurred_on < '2029-07-01'`, a.id);
const juneAdj2 = await db(`SELECT 1 FROM owner_adjustments WHERE expense_id = $1`, june?.id ?? '');
check('re-entered without the tick: the O2 line goes with the replaced bill, and the TNB bill comes back to be paid',
  r.status === 201 && juneAdj2.length === 0 && r.json?.toPay?.length === 1 && r.json.toPay[0].provider === 'TNB' && r.json.toPay[0].expenseIds?.[0] === june2?.id, JSON.stringify({ r: r.json, juneAdj2 }));
r = await call('POST', '/api/expenses/utilities/payment-requests', { expenseIds: [june2?.id], provider: 'TNB' });
const [june3] = await db(`SELECT payment_request_id FROM expenses WHERE id = $1`, june2?.id ?? '');
check('with no finance system to reach, the request is not made and the bill keeps no request', r.status >= 400 && june3?.payment_request_id === null, `${r.status} ${r.text.slice(0, 200)}`);
r = await call('POST', '/api/expenses/utilities/payment-requests', { expenseIds: [june2?.id], provider: 'TNB' }, 'housekeeper');
check('only finance and management send utility bills for payment', r.status === 403, r.status);

// A request finance sent back, or its sender withdrew (chew, 13 Nov 2026: change it and send it again; SOP 3.10): its
// bills are fixed on the month screen and keep the request, the screens say why it came back, and "Send again" sends the
// same request with the bills as they are now.
const reqC = randomUUID(), reqD = randomUUID();
await db(`INSERT INTO scm.payment_requests (id, company_id, request_no, type, requester_user_id, payee_name, amount_sen, status, reason, decided_by, created_at)
  VALUES ($1, $3, 'PRQ-CHK-003', 'PAYMENT', 'chk', 'TNB', 5100, 'REJECTED', 'The July bill is RM 71.00, not RM 51.00', 'Chew', '2029-08-02T10:00:00+08:00'),
         ($2, $3, 'PRQ-CHK-004', 'PAYMENT', 'chk', 'TNB', 1500, 'WITHDRAWN', null, null, '2029-08-03T10:00:00+08:00')`, reqC, reqD, co.id)
  .catch(e => check('returned payment requests seeded', false, e.message));
const julyBill = await bill({ kind: 'electricity', amount: 5100, date: '2029-07-31', chargeTo: 'the_conts' });
await db(`UPDATE expenses SET reference = 'CHK-ACC-1', payment_request_id = $1, payment_request_no = 'PRQ-CHK-003' WHERE id = $2`, reqC, julyBill);
r = await call('GET', `/api/expenses/utilities?month=2029-07&unitId=${a.id}`);
const julyLine = (r.json?.data ?? []).find(x => x.accountId === acc);
check('the month screen says the request came back, and why', julyLine?.paymentRequestNo === 'PRQ-CHK-003' && julyLine?.paymentRequestStatus === 'REJECTED'
  && julyLine?.paymentRequestReason === 'The July bill is RM 71.00, not RM 51.00', JSON.stringify(julyLine));
r = await call('POST', '/api/expenses/utilities', { month: '2029-07', rows: [{ accountId: acc, amount: 7100, chargeTo: 'the_conts' }] });
const [julyFixed] = await db(`SELECT id, amount, payment_request_id, payment_request_no FROM expenses WHERE unit_id = $1 AND reference = 'CHK-ACC-1' AND incurred_on >= '2029-07-01' AND incurred_on < '2029-08-01'`, a.id);
check('a bill on a request that came back is fixed on the month screen and keeps the request, so it is not sent as a new one',
  r.status === 201 && r.json?.saved === 1 && !(r.json?.requested ?? []).length && (r.json?.toPay ?? []).length === 0
  && julyFixed?.amount === 7100 && julyFixed?.payment_request_id === reqC && julyFixed?.payment_request_no === 'PRQ-CHK-003', JSON.stringify({ r: r.json, julyFixed }));
r = await call('GET', '/api/expenses/utility-listing?from=2029-07&to=2029-08&by=request');
const sentBack = (r.json?.bills ?? []).find(x => x.id === julyFixed?.id);
check('by request: a returned request carries why it came back and who sent it back', sentBack?.request?.status === 'REJECTED'
  && sentBack?.request?.reason === 'The July bill is RM 71.00, not RM 51.00' && sentBack?.request?.decidedBy === 'Chew', JSON.stringify(sentBack));
r = await call('POST', `/api/expenses/utilities/payment-requests/${reqA}/resend`, {});
check('"Send again" is refused while finance still has the request', r.status === 409, `${r.status} ${r.text.slice(0, 200)}`);
const ownerPaidBill = await bill({ kind: 'water', amount: 1500, date: '2029-07-31', chargeTo: 'the_conts' });
await db(`UPDATE expenses SET owner_paid = true, payment_request_id = $1, payment_request_no = 'PRQ-CHK-004' WHERE id = $2`, reqD, ownerPaidBill);
r = await call('POST', `/api/expenses/utilities/payment-requests/${reqD}/resend`, {});
const [paidOff] = await db(`SELECT payment_request_id FROM expenses WHERE id = $1`, ownerPaidBill);
check('"Send again" with no bill left for the company to pay is refused, and the owner-paid bill lets go of the request (so it leaves Sent back to fix)',
  r.status === 422 && paidOff?.payment_request_id === null, `${r.status} ${r.text.slice(0, 200)} ${JSON.stringify(paidOff)}`);
r = await call('POST', `/api/expenses/utilities/payment-requests/${reqC}/resend`, {});
const [julyAfter] = await db(`SELECT payment_request_id FROM expenses WHERE id = $1`, julyFixed?.id ?? '');
check('"Send again" goes to the finance system (not reachable here), and the bill keeps its request', r.status >= 400 && ![404, 409, 422].includes(r.status) && julyAfter?.payment_request_id === reqC,
  `${r.status} ${r.text.slice(0, 200)}`);
r = await call('POST', `/api/expenses/utilities/payment-requests/${reqC}/resend`, {}, 'housekeeper');
check('only finance and management send a utility request again', r.status === 403, r.status);
// Demo mode sends nothing to finance (review, 13 Nov 2026): not Send again, nor a utility request made from bills.
const inDemo = async (path, body) => {
  const x = await fetch(`${process.env.API_BASE}${path}`, { method: 'POST', headers: { cookie: `${cookieFor('management')}; tc_demo=1`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: x.status, text: await x.text() };
};
r = await inDemo(`/api/expenses/utilities/payment-requests/${reqC}/resend`, {});
check('in Demo mode, Send again sends nothing to finance', r.status === 409 && /Demo/.test(r.text), `${r.status} ${r.text.slice(0, 200)}`);
r = await inDemo('/api/expenses/utilities/payment-requests', { expenseIds: [june2?.id], provider: 'TNB' });
check('in Demo mode, bills are not sent to finance either', r.status === 409 && /Demo/.test(r.text), `${r.status} ${r.text.slice(0, 200)}`);

await db(`DELETE FROM owner_adjustments WHERE expense_id IN (SELECT id FROM expenses WHERE unit_id = $1 AND incurred_on >= '2029-01-01' AND incurred_on < '2030-01-01')`, a.id);
await db(`DELETE FROM unit_utility_accounts WHERE id = $1`, acc);
await db(`DELETE FROM scm.payment_requests WHERE id IN ($1, $2, $3, $4)`, reqA, reqB, reqC, reqD);
for (const u of [a, b]) await db(`DELETE FROM expenses WHERE unit_id = $1 AND incurred_on >= '2028-10-01' AND incurred_on < '2030-01-01'`, u.id);
await db(`DELETE FROM owner_statements WHERE owner_id = $1 AND period_start = '2029-03-01'`, a.owner_id);
await db(`DELETE FROM reservations WHERE unit_id = $1 AND check_in = '2029-03-29'`, a.id);
done();
