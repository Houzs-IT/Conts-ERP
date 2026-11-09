// Payroll generation is all-or-nothing, and approve refuses while anyone on payroll has no slip (Hookka #1181).
// Runs the library straight against a throwaway database, no web server:
//   node scripts/dev-pglite.mjs            (leave it running; PORT=... to pick a port)
//   DATABASE_URL=postgres://pos_app:local@127.0.0.1:<port>/postgres node scripts/api-checks/payroll-atomic.mjs
// Never point DATABASE_URL at staging or production: it writes payslips and a trigger, then removes them.
import { register } from 'node:module';
import postgres from 'postgres';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));

const url = process.env.DATABASE_URL;
if (!url || !/127\.0\.0\.1|localhost/.test(url)) { console.error('DATABASE_URL must be a local throwaway database.'); process.exit(2); }
const env = { HYPERDRIVE: { connectionString: url }, DB_SEARCH_PATH: 'pos,public' };
const { generateDrafts, missingSlips, onPayroll } = await import('../../functions/_lib/payroll.ts');
const { listEmployees } = await import('../../functions/_lib/hr.ts');
const USER = '11111111-1111-4111-8111-000000000002'; // the seeded management user
const sql = postgres(url, { max: 1, connection: { options: '-c search_path=pos,public' } });

let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: ${extra}`}`); };

// The month just ended, so generation covers a whole month.
const now = new Date(Date.now() + 8 * 3600e3);
const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
// Two extra in-house cleaners, so a cut-off run has people before the failing one whose slips must not be kept.
const extra = ['Atomic Check One', 'Atomic Check Two'];
for (const name of extra) await sql`insert into pos.cleaners (id, full_name, employment_type, is_active, created_at, updated_at) values (${crypto.randomUUID()}, ${name}, 'internal', 1, now()::text, now()::text)`;
// A first clean run gives everyone an HR record (ensureEmployeeId), so the failing row can be picked by id.
await sql`delete from pos.payslips where period = ${prev}`;
await generateDrafts(env, prev, USER);
const people = (await listEmployees(env)).filter((e) => onPayroll(e, prev));
check(`there are people on ${prev}'s payroll to test with`, people.length >= 3, `${people.length}`);
await sql`delete from pos.payslips where period = ${prev}`;

// A slip write that fails part-way: the last person's row is refused. Before the fix, everyone before them kept a slip.
const victim = people[people.length - 1];
await sql.unsafe(`create or replace function pos.test_fail_victim() returns trigger language plpgsql as $$
  begin if new.employee_id = '${victim.id}' then raise exception 'test: payslip write cut off'; end if; return new; end $$`);
await sql.unsafe('drop trigger if exists test_fail_victim on pos.payslips');
await sql.unsafe('create trigger test_fail_victim before insert or update on pos.payslips for each row execute function pos.test_fail_victim()');

let threw = null;
try { await generateDrafts(env, prev, USER); } catch (e) { threw = e; }
const [{ n: afterFail }] = await sql`select count(*)::int as n from pos.payslips where period = ${prev}`;
check('a run cut off part-way throws', !!threw);
check('and saves nothing (no half-month of slips)', afterFail === 0, `${afterFail} slips kept`);

await sql.unsafe('drop trigger test_fail_victim on pos.payslips');
await sql.unsafe('drop function pos.test_fail_victim()');
const done = await generateDrafts(env, prev, USER);
const [{ n: afterOk }] = await sql`select count(*)::int as n from pos.payslips where period = ${prev}`;
check('a clean run writes everyone on payroll', done.written === people.length && afterOk === people.length, `${done.written}/${afterOk}/${people.length}`);
check('nobody is missing a slip after a clean run', (await missingSlips(env, prev)).length === 0);

await sql`delete from pos.payslips where period = ${prev} and employee_id = ${victim.id}`;
const missing = await missingSlips(env, prev);
check('a person without a slip is listed by name', missing.length === 1 && missing[0].name === victim.name, JSON.stringify(missing));

await sql`delete from pos.payslips where period = ${prev}`;
await sql`delete from pos.employees where cleaner_id in (select id from pos.cleaners where full_name in ${sql(extra)})`.catch(() => {});
await sql`delete from pos.cleaners where full_name in ${sql(extra)}`;
await sql.end();
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
