// The unit P&L report (plan docs/superpowers/plans/2026-10-28-unit-pnl.md): guest paid spread by night, the statement
// engine's figures, and the same operating profit and company result as the Overall unit report. Limits saved by
// management only. Needs a fresh local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://postgres@127.0.0.1:55441/postgres API_BASE=http://localhost:8891 node scripts/api-checks/unit-pnl.mjs
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { call, check, done } from './harness.mjs';
import { pnl } from '../../src/lib/unitPnl.ts';
import { overallFigures } from '../../src/lib/ownerOverall.ts';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to the local test database.'); process.exit(2); }
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};

// A whole unit with an owner, and two months nobody has used (2029).
const [unit] = await db(`SELECT u.id FROM units u WHERE u.parent_unit_id IS NULL AND u.owner_id IS NOT NULL ORDER BY u.id LIMIT 1`);
check('a unit to use', !!unit);
if (!unit) { done(); process.exit(1); }
await db(`DELETE FROM reservations WHERE unit_id = $1 AND check_in >= '2029-02-01' AND check_in < '2029-06-01'`, unit.id);
await db(`DELETE FROM expenses WHERE unit_id = $1 AND incurred_on >= '2029-02-01' AND incurred_on < '2029-06-01'`, unit.id);
const stay = async (from, to, gbv, collected) => db(`INSERT INTO reservations (id, unit_id, check_in, check_out, state, channel, gross_booking_value, collected_revenue, created_at, updated_at)
  VALUES ($1, $2, $3, $4, 'checked_out', 'airbnb', $5, $6, now()::text, now()::text)`, randomUUID(), unit.id, from, to, gbv, collected);
await stay('2029-03-29', '2029-04-03', 50_001, 40_000);   // 3 nights in March, 2 in April
await stay('2029-04-10', '2029-04-12', 0, 20_000);         // no guest-paid amount: its payout stands in
await db(`INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, charge_to, created_at)
  VALUES ($1, $2, 'electricity', 'Unit P&L check', 5_000, 'MYR', '2029-03-31', 'owner', now())`, randomUUID(), unit.id);

let r = await call('GET', '/api/finance/unit-pnl?from=2029-03&to=2029-04', undefined, 'housekeeper');
check('only finance and management may see it', r.status === 403, r.status);
r = await call('GET', '/api/finance/unit-pnl?from=2029-03&to=2029-04');
check('report loads', r.status === 200, r.text.slice(0, 300));
const rows = (r.json?.rows ?? []).filter(x => x.unitId === unit.id);
const mar = rows.find(x => x.month === '2029-03'), apr = rows.find(x => x.month === '2029-04');
check('the unit is in both months', !!mar && !!apr, JSON.stringify(rows).slice(0, 300));
if (mar && apr) {
  check('a stay across a month end is split by nights', mar.guestPaid === 30_001 && apr.guestPaid === 20_000 + 20_000, `${mar.guestPaid} / ${apr.guestPaid}`);
  check('a stay with no guest-paid amount is flagged', apr.guestPaidMissing === true && mar.guestPaidMissing === false, JSON.stringify({ mar: mar.guestPaidMissing, apr: apr.guestPaidMissing }));
  check('the electricity bill is on its month', mar.electricity === 5_000 && apr.electricity === 0);
  for (const m of ['2029-03', '2029-04']) {
    const o = await call('GET', `/api/portfolio/owner-report?month=${m}`);
    const ours = rows.find(x => x.month === m), theirs = (o.json?.rows ?? []).find(x => x.unitId === unit.id);
    const a = ours && pnl(ours), b = theirs && overallFigures(theirs);
    check(`${m}: operating profit and company result equal the Overall unit report`, !!a && !!b && a.operating === b.gp && a.company === b.gainLoss,
      JSON.stringify({ a, gp: b?.gp, ownerBase: b?.ownerBase }));
  }
}
const r0 = await call('GET', '/api/finance/unit-pnl?from=2029-03&to=2029-04');
r = await call('GET', '/api/finance/unit-pnl?from=2028-01&to=2029-04');
check('the three months before the range come for the checks', Array.isArray(r0.json?.lookBack), JSON.stringify(Object.keys(r0.json ?? {})));
check('more than 12 months is refused', r.status === 422 && /12 months/.test(r.text), r.text);

r = await call('PUT', '/api/finance/unit-pnl-limits', { lines: { cleaning: { pctMax: 20 }, electricity: { perNightMax: 1500 } }, marginMin: 30 }, 'finance_admin');
check('finance may not change the limits', r.status === 403, r.status);
r = await call('PUT', '/api/finance/unit-pnl-limits', { lines: { cleaning: { pctMax: 120 } } });
check('a percent over 100 is refused', r.status === 422, r.text);
r = await call('PUT', '/api/finance/unit-pnl-limits', { lines: { cleaning: { pctMax: 20 }, electricity: { perNightMax: 1500 } }, marginMin: 30 });
check('management saves the limits', r.status === 200, r.text);
r = await call('GET', '/api/finance/unit-pnl?from=2029-03&to=2029-03');
check('the report reads them back', r.json?.limits?.lines?.cleaning?.pctMax === 20 && r.json?.limits?.marginMin === 30, JSON.stringify(r.json?.limits));
await call('PUT', '/api/finance/unit-pnl-limits', { lines: {} });

await db(`DELETE FROM reservations WHERE unit_id = $1 AND check_in >= '2029-02-01' AND check_in < '2029-06-01'`, unit.id);
await db(`DELETE FROM expenses WHERE unit_id = $1 AND incurred_on >= '2029-02-01' AND incurred_on < '2029-06-01'`, unit.id);
done();
