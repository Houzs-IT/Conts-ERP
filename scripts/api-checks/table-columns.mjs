// Each person's column order and visibility for a list, kept with their account (chew, 13 Nov 2026: "这个header 可以拖动
// 自己排吗？根据user"): dragging a header, or the Columns menu, saves it, and the list opens that way on any computer.
// Kept in table_layouts as one working row per person and table (functions/api/table-layouts/columns.ts), never listed
// among the saved views; a view cannot take its reserved name.
// Needs a local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://pos_app:local@127.0.0.1:55442/postgres API_BASE=http://localhost:8788 node scripts/api-checks/table-columns.mjs
import postgres from 'postgres';
import { call, callAsUser, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to the local test database.'); process.exit(2); }
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};
const TABLE = 'check.table-columns';
// A second desk person of the check's own (the demo data's other desk logins differ between CI and a local copy).
const OTHER = { userId: 'chk-columns-2', email: 'columns2.check@local.test', role: 'management', fullName: 'Check Columns Two' };
const clean = async () => {
  await db(`DELETE FROM table_layouts WHERE table_key = $1`, TABLE);
  await db(`DELETE FROM users WHERE id = $1`, OTHER.userId);
};
await clean();
const now = new Date().toISOString();
await db(`INSERT INTO users (id, email, full_name, password_hash, role, must_change_password, is_active, created_at, updated_at)
  VALUES ($1, $2, $3, 'not-a-password', $4, 0, 1, $5, $5)`, OTHER.userId, OTHER.email, OTHER.fullName, OTHER.role, now);

const order = [{ key: 'unit', hidden: false }, { key: 'code', hidden: false }, { key: 'note', hidden: true }];
let r = await call('PUT', '/api/table-layouts/columns', { table: TABLE, columns: order });
check('a person saves their column order for a list, and is told when it was kept', r.status === 200 && typeof r.json?.at === 'string', r.text);
const at = r.json?.at;
r = await call('GET', `/api/table-layouts?table=${TABLE}`);
check('… and the list reads it back with their views', r.status === 200 && JSON.stringify(r.json?.columns) === JSON.stringify(order), r.text);
// The list takes the account's order only when it is newer than the browser's own (src/lib/columnOrder.ts).
check('… with the time it was kept', r.status === 200 && typeof at === 'string' && r.json?.columnsAt === at, `${r.json?.columnsAt} vs ${at}`);
check('… and it is not one of their saved views', r.status === 200 && Array.isArray(r.json?.mine) && r.json.mine.length === 0, JSON.stringify(r.json?.mine));

const again = [{ key: 'code', hidden: false }, { key: 'unit', hidden: false }, { key: 'note', hidden: false }];
r = await call('PUT', '/api/table-layouts/columns', { table: TABLE, columns: again });
const rows = await db(`SELECT count(*)::int AS n FROM table_layouts WHERE table_key = $1`, TABLE);
check('saving again replaces it: one row per person and list', r.status === 200 && rows[0]?.n === 1, `${r.text} rows ${rows[0]?.n}`);

r = await callAsUser(OTHER, 'GET', `/api/table-layouts?table=${TABLE}`);
check("another person does not get someone else's order", r.status === 200 && (r.json?.columns ?? null) === null, r.text);

r = await call('POST', '/api/table-layouts', { table: TABLE, name: '__columns__', scope: 'mine', isDefault: false, layout: { columns: again, sort: null, pageSize: null, filters: {} } });
check("a saved view cannot take the order's reserved name", r.status === 422, r.text);
r = await call('POST', '/api/table-layouts', { table: TABLE, name: 'Mine', scope: 'mine', isDefault: false, layout: { columns: again, sort: null, pageSize: null, filters: {} } });
r = r.status === 201 ? await call('PATCH', `/api/table-layouts/${r.json.id}`, { name: '__columns__' }) : r;
check('… nor be renamed to it', r.status === 422, r.text);

r = await call('PUT', '/api/table-layouts/columns', { table: TABLE, columns: [{ key: 7, hidden: 'no' }] });
check('a column list that is not keys and hidden flags is refused', r.status === 422, r.text);
r = await call('PUT', '/api/table-layouts/columns', { table: 'Not A Table!', columns: again });
check('a table name the views do not allow is refused', r.status === 422, r.text);

await clean();
done();
