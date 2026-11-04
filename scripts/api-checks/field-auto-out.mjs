// The cleaner's own phone list says what the office's board says when the system marked a guest out: "Auto at 11:00" or
// "Auto at 13:00 (late checkout)", in every language of the portal. Two jobs for the seeded cleaner, one on time and one
// with a late checkout; a guest marked out by a person keeps "Guest has left".
//
//   API_BASE=http://localhost:8815 DB_URL=postgres://postgres@127.0.0.1:5432/ci node scripts/api-checks/field-auto-out.mjs
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { call, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Refusing: DB_URL must be a local database.'); process.exit(2); }
const sql = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
const run = Date.now().toString(36).slice(-6);
const now = new Date().toISOString();
const day = new Date(Date.now() + 8 * 36e5).toISOString().slice(0, 10);
const cleaner = '11111111-1111-4111-8111-000000000005';

const units = await sql`select id from units limit 3`;
const job = async (n, unitId, time, leftAt) => {
  const [{ id: res }] = await sql`insert into reservations (id, unit_id, channel, check_in, check_out, check_out_time, state, created_at, updated_at)
    values (${`fa-r${n}-${run}`}, ${unitId}, 'direct', '2026-01-01', ${day}, ${time}, 'checked_out', ${now}, ${now}) returning id`;
  const [{ id }] = await sql`insert into tasks (id, unit_id, reservation_id, kind, title, state, assignee_id, scheduled_for, guest_left_at, created_at, updated_at)
    values (${`fa-t${n}-${run}`}, ${unitId}, ${res}, 'turnover', 'Clean', 'open', ${cleaner}, ${`${day}T14:0${n}:00+08:00`}, ${leftAt}, ${now}, ${now}) returning id`;
  return id;
};
const onTime = await job(1, units[0].id, '11:00', `${day}T11:00:00+08:00`);
const late = await job(2, units[1 % units.length].id, '13:00', `${day}T13:00:00+08:00`);
const byHand = await job(3, units[2 % units.length].id, '11:00', new Date().toISOString());

const r = await call('GET', `/api/field/tasks?date=${day}`, undefined, 'housekeeper');
const list = r.json?.rows ?? [];
const of = id => list.find(j => j.id === id);
check('the list answers', r.status === 200 && list.length >= 3, r.text.slice(0, 300));
check('11:00 checkout: marked by the system, not late', of(onTime)?.guestLeftAuto === true && of(onTime)?.previous?.lateCheckOut === false, JSON.stringify(of(onTime)));
check('13:00 checkout: marked by the system, late', of(late)?.guestLeftAuto === true && of(late)?.previous?.lateCheckOut === true, JSON.stringify(of(late)));
check('marked by a person: not automatic', of(byHand)?.guestLeftAuto === false, JSON.stringify(of(byHand)));

const source = readFileSync(new URL('../../src/lib/portalI18n.ts', import.meta.url), 'utf8');
check('the old wording is gone', !/outAtCheckout|Out at checkout/.test(source));
const lines = source.split('\n').filter(l => l.includes('autoAt:'));
check('all four languages say it', lines.length === 4, lines.length);
const said = lines.map(l => new Function('time', 'late', `return ${/=> (`.*?`),/.exec(l)[1]};`));
check('English matches the board', said[0]('11:00', false) === 'Auto at 11:00' && said[0]('13:00', true) === 'Auto at 13:00 (late checkout)', said[0]('13:00', true));
for (const [i, lang] of [[1, 'Malay'], [2, 'Chinese'], [3, 'Burmese']]) {
  check(`${lang} carries the time, and says late only when late`, said[i]('13:00', false).includes('13:00') && said[i]('13:00', true).length > said[i]('13:00', false).length, said[i]('13:00', true));
}

await sql.end();
done();
