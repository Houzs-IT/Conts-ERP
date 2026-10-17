// Utility bills with receipts reaching the owner statement (staff comment sheet, Oct 2026). A Water bill and an
// Additional deduction ("Other fees") paid by the owner, each with a receipt, entered on a unit through the bill form's
// calls (POST /api/documents, POST /api/expenses); a Wi-Fi bill the company pays. Then the owner's statement for the
// month: each owner-paid bill is a line with its receipt (staff statement and the owner portal), the deduction keeps its
// description, the company's bill is not there, and only that owner can open the receipt.
// Needs a fresh local database (see harness.mjs) and DB_URL pointing at it, e.g.
//   DB_URL=postgres://postgres@127.0.0.1:55492/postgres API_BASE=http://localhost:8891 node scripts/api-checks/utility-bills.mjs
import postgres from 'postgres';
import { call, callAsUser, cookieFor, check, done } from './harness.mjs';

const DB_URL = process.env.DB_URL;
if (!DB_URL || !/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error('Set DB_URL to the local test database.'); process.exit(2); }
const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const db = async (text, ...values) => {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {}, connection: { search_path: 'pos' } });
  try { return await c.unsafe(text, values); } finally { await c.end({ timeout: 5 }); }
};

// A unit whose owner has a portal login, and another owner's login to check the receipt is not theirs to open.
const [unit] = await db(`SELECT u.id, u.owner_id, o.user_id, ou.email, ou.full_name FROM units u JOIN owners o ON o.id = u.owner_id JOIN users ou ON ou.id = o.user_id
  WHERE u.parent_unit_id IS NULL ORDER BY u.id LIMIT 1`);
check('a unit whose owner has a portal login', !!unit, 'none in the demo data');
const owner = { userId: unit.user_id, email: unit.email, role: 'owner', fullName: unit.full_name };
const [other] = await db(`SELECT o.user_id, ou.email, ou.full_name FROM owners o JOIN users ou ON ou.id = o.user_id WHERE o.id <> $1 LIMIT 1`, unit.owner_id);
// A month this owner has no statement for yet, so it is open.
const taken = new Set((await db(`SELECT substr(period_start, 1, 7) AS m FROM owner_statements WHERE owner_id = $1`, unit.owner_id)).map(x => x.m));
const month = ['2026-10', '2026-11', '2026-12', '2025-12', '2025-11'].find(m => !taken.has(m));
check('an open month for this owner', !!month, [...taken].join(','));

async function upload(name) {
  const fd = new FormData();
  fd.append('file', new Blob([`%PDF-1.4 receipt ${name}`], { type: 'application/pdf' }), name);
  fd.append('unitId', unit.id); fd.append('kind', 'receipt');
  const r = await fetch(`${BASE}/api/documents`, { method: 'POST', headers: { cookie: cookieFor('management') }, body: fd });
  const j = await r.json().catch(() => null);
  check(`receipt ${name} uploaded`, r.status === 201 && !!j?.id, JSON.stringify(j));
  return j?.id;
}
const waterReceipt = await upload('water-bill.pdf');
const dedReceipt = await upload('aircon-filter.pdf');

let r = await call('POST', '/api/expenses', { unitId: unit.id, category: 'water', amount: 4321, incurredOn: `${month}-28`, chargeTo: 'owner', reference: 'AIR-0001', description: `Water ${month}`, receiptDocumentId: waterReceipt });
check('water bill recorded with its receipt', r.status === 201, r.text);
const waterId = r.json?.id;
r = await call('POST', '/api/expenses', { unitId: unit.id, category: 'other', amount: 5500, incurredOn: `${month}-28`, chargeTo: 'owner', description: 'Replace aircon filter', receiptDocumentId: dedReceipt });
check('additional deduction recorded with its receipt', r.status === 201, r.text);
const dedId = r.json?.id;
r = await call('POST', '/api/expenses', { unitId: unit.id, category: 'internet', amount: 9900, incurredOn: `${month}-28`, chargeTo: 'the_conts', description: `Wi-Fi ${month}` });
check('company-paid Wi-Fi bill recorded', r.status === 201, r.text);
const wifiId = r.json?.id;

r = await call('POST', '/api/statements/generate', { period: month, ownerIds: [unit.owner_id] });
check('owner statement generated', r.status < 300 && r.json?.count >= 1, `${r.status} ${r.text}`);
const [st] = await db(`SELECT id FROM owner_statements WHERE owner_id = $1 AND period_start LIKE $2`, unit.owner_id, `${month}%`);
check('statement exists', !!st);

r = await call('GET', `/api/statements/${st.id}`);
const lines = r.json?.data?.lines ?? [];
const water = lines.find(l => l.expenseId === waterId), ded = lines.find(l => l.expenseId === dedId);
check('staff statement: water line carries its receipt', water?.category === 'water' && water?.receipt?.id === waterReceipt, JSON.stringify(water));
check('staff statement: additional deduction keeps its description and receipt', ded?.category === 'additional' && /aircon filter/i.test(ded?.description) && ded?.receipt?.id === dedReceipt, JSON.stringify(ded));
check('staff statement: the company-paid Wi-Fi bill is not deducted', !lines.some(l => l.expenseId === wifiId));

r = await callAsUser(owner, 'GET', `/api/owner/statements/${st.id}`);
check('owner cannot see a draft statement', r.status === 404, r.text);
r = await callAsUser(owner, 'GET', `/api/documents/${waterReceipt}/download`);
check('owner cannot open the receipt while the statement is a draft', r.status === 404, r.text);

r = await call('POST', '/api/statements/finalise', { statementIds: [st.id] });
check('statement finalised', r.status === 200, r.text);

r = await callAsUser(owner, 'GET', `/api/owner/statements/${st.id}`);
const ol = (r.json?.units ?? []).flatMap(u => u.lines);
const ow = ol.find(l => l.receipt?.id === waterReceipt), od = ol.find(l => l.receipt?.id === dedReceipt);
check('owner portal: water line with receipt, in the report\'s words', r.status === 200 && /^Water Usage/.test(ow?.label ?? ''), JSON.stringify(ow));
check('owner portal: Additional Deduction line with its description and receipt', /^Additional Deduction · Replace aircon filter/.test(od?.label ?? ''), JSON.stringify(od));
r = await callAsUser(owner, 'GET', `/api/documents/${waterReceipt}/download`);
check('owner opens the receipt of a bill on their final statement', r.status === 200 && /^%PDF/.test(r.text), `${r.status} ${r.text.slice(0, 80)}`);
if (other) {
  r = await callAsUser({ userId: other.user_id, email: other.email, role: 'owner', fullName: other.full_name }, 'GET', `/api/documents/${waterReceipt}/download`);
  check("another owner cannot open it", r.status === 404, `${r.status}`);
}
done();
