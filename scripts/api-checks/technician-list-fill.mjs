// Migration 0144's fill-in against messy jobs: a technician login, an operations manager with a job, one contractor typed
// two ways. Re-runs the migration twice on the demo data. Run it first, on a fresh throwaway database (scripts/dev-pglite.mjs),
// before workers-technicians.mjs, which needs the entries it makes:
//   DB_URL=postgres://pos_app:local@127.0.0.1:55441/postgres node scripts/api-checks/technician-list-fill.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const c = postgres(process.env.DB_URL ?? 'postgres://pos_app:local@127.0.0.1:55441/postgres', { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
let fails = 0;
const check = (name, ok, more = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: ${JSON.stringify(more).slice(0, 400)}`}`); };

const jobs = await c.unsafe('SELECT id FROM maintenance_issues ORDER BY id');
const HAFIZ = '11111111-1111-4111-8111-000000000006', AINA = '11111111-1111-4111-8111-000000000001';
// Job 1: given to technician Hafiz by login. Job 2: the ops manager by login. Jobs 3-4: one contractor typed two ways.
await c.unsafe(`UPDATE maintenance_issues SET vendor_name = 'Hafiz Rahman', assignee_user_id = $1, assignee_kind = 'in_house' WHERE id = $2`, [HAFIZ, jobs[0].id]);
await c.unsafe(`UPDATE maintenance_issues SET vendor_name = 'Aina Zulkifli', assignee_user_id = $1, assignee_kind = 'in_house' WHERE id = $2`, [AINA, jobs[1].id]);
await c.unsafe(`UPDATE maintenance_issues SET vendor_name = 'Ah Seng Plumbing', assignee_user_id = NULL, assignee_kind = 'contractor' WHERE id = $1`, [jobs[2].id]);
await c.unsafe(`UPDATE maintenance_issues SET vendor_name = '  ah seng plumbing ', assignee_user_id = NULL, assignee_kind = 'contractor' WHERE id = $1`, [jobs[3].id]);

await c.unsafe(readFileSync(ROOT + '/migrations-pg/0144_technician_list.sql', 'utf8'));
await c.unsafe(readFileSync(ROOT + '/migrations-pg/0144_technician_list.sql', 'utf8'));

const list = await c.unsafe('SELECT id, full_name, employment_type, user_id FROM technicians ORDER BY employment_type, full_name');
console.log(list.map(t => `${t.employment_type} ${t.full_name} ${t.user_id ?? '-'}`).join('\n'));
check('Hafiz (technician login) in-house, linked', list.some(t => t.user_id === HAFIZ && t.employment_type === 'internal'));
check('Aina (ops manager with a job) in-house, linked', list.some(t => t.user_id === AINA && t.employment_type === 'internal'));
check('one contractor for both spellings', list.filter(t => t.employment_type === 'outsourced' && t.full_name.toLowerCase().trim() === 'ah seng plumbing').length === 1, list);
check('running it twice adds nothing', list.length === new Set(list.map(t => t.full_name.toLowerCase().trim())).size, list);
const linked = await c.unsafe('SELECT m.vendor_name, t.full_name, t.employment_type FROM maintenance_issues m LEFT JOIN technicians t ON t.id = m.technician_id ORDER BY m.id');
check('every named job linked to an entry', linked.every(r => r.full_name), linked);
check('both contractor spellings on the same entry', new Set(linked.filter(r => r.employment_type === 'outsourced').map(r => r.full_name)).size === 1, linked);
await c.end();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
