// The bank transfer file's grouping, chosen at each download (chew, 13 Nov 2026: "每次下载时选"). An owner's payout is
// still one payout; the file splits it into transfers:
//   building  (as before)  one transfer per owner, building and bank account;
//   owner                  one transfer per owner and bank account, whatever the building;
//   unit                   one transfer per unit (and account).
// A payout that cannot be split that way (a unit, building or account at zero or below) stays whole and is flagged for
// a check by hand. An unknown grouping is refused.
// Needs a fresh local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://pos_app:local@127.0.0.1:55442/postgres API_BASE=http://localhost:8788 node scripts/api-checks/payout-export.mjs
// Account numbers below are made up.
import postgres from 'postgres';
import { call, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to the local test database.'); process.exit(2); }
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};
const now = new Date().toISOString();
const OWNER = 'pxe-owner', ST = 'pxe-s', PAY = 'pxe-pay';
const dropAll = async () => {
  await db(`DELETE FROM payouts WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM statement_lines WHERE statement_id = $1`, ST);
  await db(`DELETE FROM owner_statements WHERE owner_id = $1`, OWNER);
  await db(`UPDATE units SET bank_account_id = NULL WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM owner_bank_accounts WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM units WHERE owner_id = $1`, OWNER);
  await db(`DELETE FROM properties WHERE id IN ('pxe-p1', 'pxe-p2')`);
  await db(`DELETE FROM owners WHERE id = $1`, OWNER);
};
await dropAll();
await db(`INSERT INTO owners (id, display_name, email, bank_name, bank_account_number, bank_account_last4, created_at, updated_at)
  VALUES ($1, 'Export Check Owner', 'export-check@example.invalid', 'Check Bank', '000111222333', '2333', $2, $2)`, OWNER, now);
await db(`INSERT INTO properties (id, name, address_line, city, state, created_at, updated_at)
  VALUES ('pxe-p1', 'Export Court A', 'Check', 'Check', 'Check', $1, $1), ('pxe-p2', 'Export Court B', 'Check', 'Check', 'Check', $1, $1)`, now);
await db(`INSERT INTO units (id, property_id, owner_id, unit_number, base_rate, created_at, updated_at)
  VALUES ('pxe-u1', 'pxe-p1', $1, 'E-01', 0, $2, $2), ('pxe-u2', 'pxe-p1', $1, 'E-02', 0, $2, $2), ('pxe-u3', 'pxe-p2', $1, 'E-03', 0, $2, $2)`, OWNER, now);
// October, sent: each unit's income less the operator's share. E-01 RM 700, E-02 RM 350, E-03 RM 210; RM 1,260 in all.
await db(`INSERT INTO owner_statements (id, owner_id, period_start, period_end, state, net_payout, generated_at, created_at)
  VALUES ($1, $2, '2026-10-01', '2026-10-31', 'sent', 126000, $3, $3)`, ST, OWNER, now);
const line = (id, unit, type, amount) => db(`INSERT INTO statement_lines (id, statement_id, unit_id, line_type, description, occurred_on, amount)
  VALUES ($1, $2, $3, $4, 'Check', '2026-10-31', $5)`, id, ST, unit, type, amount);
await line('pxe-l1', 'pxe-u1', 'gross', 100000); await line('pxe-l2', 'pxe-u1', 'management_fee', -30000);
await line('pxe-l3', 'pxe-u2', 'gross', 50000); await line('pxe-l4', 'pxe-u2', 'management_fee', -15000);
await line('pxe-l5', 'pxe-u3', 'gross', 30000); await line('pxe-l6', 'pxe-u3', 'management_fee', -9000);
await db(`INSERT INTO payouts (id, statement_id, owner_id, amount, currency, state, method, bank_last4, created_at)
  VALUES ($1, $2, $3, 126000, 'MYR', 'pending', 'bank_transfer', '2333', $4)`, PAY, ST, OWNER, now);

const rows = async group => {
  const r = await call('GET', `/api/payouts/export?ids=${PAY}${group ? `&group=${group}` : ''}`);
  return { status: r.status, text: r.text, list: (r.json?.data ?? []).map(x => ({ units: x.units, amount: x.amount, account: x.accountNumber, byHand: x.checkByHand })).sort((a, b) => a.units.localeCompare(b.units)) };
};
const amounts = list => list.map(x => x.amount).join(',');

let r = await rows(null);
check('the usual file: one transfer per building', r.status === 200 && r.list.length === 2 && amounts(r.list) === '105000,21000', JSON.stringify(r.list));
r = await rows('building');
check('… the same when asked for by building', r.status === 200 && amounts(r.list) === '105000,21000', JSON.stringify(r.list));
r = await rows('owner');
check('by owner: one transfer for every building', r.status === 200 && r.list.length === 1 && r.list[0].amount === 126000 && /E-01/.test(r.list[0].units) && /E-03/.test(r.list[0].units), JSON.stringify(r.list));
r = await rows('unit');
check('by unit: one transfer per unit', r.status === 200 && r.list.length === 3 && amounts(r.list) === '70000,35000,21000' && r.list.every(x => !x.byHand), JSON.stringify(r.list));
r = await rows('bogus');
check('an unknown grouping is refused', r.status === 422, r.text);

// A unit on another account: by owner still splits by account (one transfer cannot go to two accounts).
await db(`INSERT INTO owner_bank_accounts (id, owner_id, label, bank_name, account_number, account_holder, account_last4, created_at, updated_at)
  VALUES ('pxe-acc2', $1, 'Second', 'Other Bank', '999888777666', 'Export Check Owner', '7666', $2, $2)`, OWNER, now);
await db(`UPDATE units SET bank_account_id = 'pxe-acc2' WHERE id = 'pxe-u2'`);
r = await rows('owner');
check('by owner: a unit on another account is its own transfer', r.status === 200 && r.list.length === 2
  && r.list.some(x => x.amount === 35000 && x.account === '999888777666') && r.list.some(x => x.amount === 91000 && x.account === '000111222333'), JSON.stringify(r.list));
await db(`UPDATE units SET bank_account_id = NULL WHERE id = 'pxe-u2'`);

// A unit whose costs are bigger than its income cannot be a transfer of its own: by unit, the payout stays whole and
// is flagged. E-03 now owes RM 190, so the payout is RM 700 + RM 350 - RM 190 = RM 860.
await line('pxe-l7', 'pxe-u3', 'expense', -40000);
await db(`UPDATE payouts SET amount = 86000 WHERE id = $1`, PAY);
await db(`UPDATE owner_statements SET net_payout = 86000 WHERE id = $1`, ST);
r = await rows('unit');
check('by unit: a unit at zero or below keeps the payout whole, flagged', r.status === 200 && r.list.length === 1 && r.list[0].amount === 86000 && r.list[0].byHand === true, JSON.stringify(r.list));
r = await rows('building');
check('by building: the building at zero or below keeps it whole too (as before)', r.status === 200 && r.list.length === 1 && r.list[0].amount === 86000, JSON.stringify(r.list));
r = await rows('owner');
check('by owner: one account adding up above zero is one transfer', r.status === 200 && r.list.length === 1 && r.list[0].amount === 86000 && !r.list[0].byHand, JSON.stringify(r.list));

await dropAll();
done();
