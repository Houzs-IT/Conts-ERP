// The yearly unit report (PLAN-yearly-report.md): the statement engine's figures per unit and month, plus what The Conts
// paid cleaners. Needs a fresh local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://postgres@127.0.0.1:55441/postgres API_BASE=http://localhost:8891 node scripts/api-checks/yearly-report.mjs
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { call, check, done } from './harness.mjs';
import { figures } from '../../src/lib/yearlyReport.ts';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to the local test database.'); process.exit(2); }
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};

const year = String(new Date(Date.now() + 8 * 3600e3).getUTCFullYear());
const month = `${year}-01`, next = `${year}-02`;
const [unit] = await db(`SELECT u.id FROM units u WHERE u.parent_unit_id IS NULL AND u.owner_id IS NOT NULL ORDER BY u.id LIMIT 1`);
check('a unit to use', !!unit);
if (!unit) { done(); process.exit(1); }
const clear = async () => {
  await db(`DELETE FROM reservations WHERE unit_id = $1 AND check_in >= $2 AND check_in < $3`, unit.id, `${month}-01`, `${next}-01`);
  await db(`DELETE FROM expenses WHERE unit_id = $1 AND incurred_on >= $2 AND incurred_on < $3`, unit.id, `${month}-01`, `${next}-01`);
  await db(`DELETE FROM tasks WHERE unit_id = $1 AND id LIKE 'yr-%'`, unit.id);
};
await clear();
await db(`INSERT INTO reservations (id, unit_id, check_in, check_out, state, channel, gross_booking_value, collected_revenue, created_at, updated_at)
  VALUES ($1, $2, $3, $4, 'checked_out', 'airbnb', 60_000, 50_000, now()::text, now()::text)`, randomUUID(), unit.id, `${month}-10`, `${month}-13`);
await db(`INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, charge_to, created_at)
  VALUES ($1, $2, 'electricity', 'Yearly report check', 5_000, 'MYR', $3, 'owner', now())`, randomUUID(), unit.id, `${month}-20`);
await db(`INSERT INTO cleaners (id, full_name, employment_type, is_active, created_at, updated_at) VALUES ('yr-cleaner', 'Yearly check', 'internal', 1, now(), now()) ON CONFLICT (id) DO NOTHING`);
const clean = (id, cleaner, pay) => db(`INSERT INTO tasks (id, unit_id, kind, state, title, due_at, completed_at, cleaner_id, cleaner_pay, requires_photo, created_at, updated_at)
  VALUES ($1, $2, 'turnover', 'resolved', 'Yearly check', $3, $3, $4, $5, 0, now(), now())`, id, unit.id, `${month}-13T12:00:00+08:00`, cleaner, pay);
await clean('yr-a', 'yr-cleaner', 6_000);
await clean('yr-b', 'yr-cleaner', 4_000);
await clean('yr-nobody', null, 9_999);   // no cleaner did it: the pay screen skips it, so does the report

let r = await call('GET', `/api/reports/yearly?year=${year}`, undefined, 'housekeeper');
check('only finance and management may see it', r.status === 403, r.status);
r = await call('GET', `/api/reports/yearly?year=${Number(year) + 1}`);
check('a year ahead is refused', r.status === 422, r.status);
r = await call('GET', `/api/reports/yearly?year=${year}`);
check('report loads', r.status === 200, r.text.slice(0, 300));
check('twelve months', r.json?.months?.length === 12, JSON.stringify(r.json?.months));
const row = (r.json?.rows ?? []).find(x => x.unitId === unit.id && x.month === month);
check('the unit is in the month', !!row, JSON.stringify((r.json?.rows ?? []).filter(x => x.unitId === unit.id).slice(0, 2)));
if (row) {
  check('cleaner cost counts the two finished cleans a cleaner did', row.cleanerCost === 10_000, row.cleanerCost);
  check('the electricity bill is on its month', row.electricity === 5_000, row.electricity);
  const o = await call('GET', `/api/portfolio/owner-report?month=${month}`);
  const theirs = (o.json?.rows ?? []).find(x => x.unitId === unit.id);
  const f = figures(row);
  check('revenue and gross profit equal the Overall unit report', !!theirs && f.revenue === theirs.revenue && f.gp === theirs.revenue - (theirs.cleaning + theirs.utilities + theirs.additional + theirs.misc),
    JSON.stringify({ f, theirs }));
  const pay = await call('GET', `/api/housekeeping/pay?month=${month}`);
  const unitPay = (pay.json?.rows ?? []).reduce((n, x) => n + x.unitPay, 0);
  const total = (r.json.rows ?? []).filter(x => x.month === month).reduce((n, x) => n + x.cleanerCost, 0) + (r.json.notInGrid ?? 0);
  check('cleaner cost across the grid ties to the cleaner pay screen', total === unitPay, `${total} vs ${unitPay}`);
}
await clear();
done();
