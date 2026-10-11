// Supply chain fixes from the 11 Oct 2026 click sweep: refused input, the contract the screens rely on for
// document lines, and fleet due dates that a later record has replaced. Creates its own rows and removes them.
//
// Run: 1. BIGDATA_PORT=55445 node scripts/api-checks/hostplatform-import.mjs <data folder> --serve   (leave it running)
//      2. a local server on that database (SESSION_SECRET in .dev.vars), e.g. on :8805
//      3. BASE=http://localhost:8805 node scripts/api-checks/supply-chain-sweep.mjs
// Signs in as the local dev account (dev@local.test), which exists only in the imported local database.
const BASE = process.env.BASE ?? 'http://localhost:8805';
const EMAIL = process.env.CHECK_EMAIL ?? 'dev@local.test';
const PASSWORD = process.env.CHECK_PASSWORD ?? 'LocalTest1';

let fails = 0, passes = 0;
const check = (name, ok, more = '') => { if (ok) passes++; else fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` :: ${String(more).slice(0, 300)}`}`); };

const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
if (login.status !== 200 || !cookie) { console.error(`sign-in failed (${login.status})`); process.exit(2); }

async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
}
async function refuses(name, method, path, body, field) {
  const r = await call(method, path, body);
  check(`${name} -> 422 on ${field}`, r.status === 422 && !!r.json?.error?.fields?.[field], `${r.status} ${r.text}`);
}
const tag = `SWP${Date.now().toString(36).slice(-5).toUpperCase()}`;
const cleanup = [];

// Email addresses on the supply chain masters.
await refuses('customer with a bad email', 'POST', '/api/customers', { code: `${tag}-C`, name: 'Sweep customer', email: 'not-an-email' }, 'email');
await refuses('supplier with a bad email', 'POST', '/api/suppliers', { code: `${tag}-S`, name: 'Sweep supplier', email: 'a@b' }, 'email');
await refuses('3PL company with a bad email', 'POST', '/api/threepl-companies', { code: `${tag}-T`, name: 'Sweep carrier', email: 'ops@' }, 'email');
{
  const r = await call('POST', '/api/customers', { code: `${tag}-C`, name: 'Sweep customer', email: 'ops@sweep.test' });
  check('customer with a good email is created', r.status === 201, `${r.status} ${r.text}`);
  if (r.json?.id) {
    cleanup.push(['DELETE', `/api/customers/${r.json.id}`]);
    await refuses('customer edit to a bad email', 'PATCH', `/api/customers/${r.json.id}`, { email: 'nope' }, 'email');
    const ok = await call('PATCH', `/api/customers/${r.json.id}`, { email: '' });
    check('customer email can be cleared', ok.status === 200, `${ok.status} ${ok.text}`);
  }
}

// A rate card whose cap is below its minimum charge.
await refuses('rate card cap below minimum', 'POST', '/api/rate-cards', { name: `${tag} card`, minChargeSen: 5000, capSen: 3000, rules: [] }, 'capSen');
{
  const r = await call('POST', '/api/rate-cards', { name: `${tag} card`, minChargeSen: 5000, capSen: 9000, rules: [] });
  check('rate card with cap above minimum is created', r.status === 201, `${r.status} ${r.text}`);
  if (r.json?.id) {
    cleanup.push(['DELETE', `/api/rate-cards/${r.json.id}`]);
    await refuses('rate card edit to cap below minimum', 'PATCH', `/api/rate-cards/${r.json.id}`, { minChargeSen: 5000, capSen: 100 }, 'capSen');
  }
}

// A duplicate category id is refused (the screen used to keep the refused row on screen).
{
  const id = tag.toLowerCase();
  const a = await call('POST', '/api/categories', { id, label: 'Sweep', icon: 'box' });
  const b = await call('POST', '/api/categories', { id, label: 'Sweep again', icon: 'box' });
  check('first category is created', a.status === 201, `${a.status} ${a.text}`);
  check('a second category with the same id is refused', b.status === 409, `${b.status} ${b.text}`);
  if (a.status === 201) cleanup.push(['DELETE', `/api/categories/${id}`]);
}

// Lists send document headers only; the record carries the lines the drawers now fetch.
{
  await call('POST', '/api/products', { code: 'SWP-1', name: 'Sweep item', category: 'ACCESSORY' }); // documents only take Products codes (409 once it exists)
  const so = await call('POST', '/api/sales-orders', { customerName: `${tag} buyer`, lines: [{ itemCode: 'SWP-1', description: 'Sweep item', uom: 'UNIT', qty: 2, unitPriceSen: 1000, discountSen: 0 }] });
  check('sales order is raised', so.status === 201, `${so.status} ${so.text}`);
  if (so.json?.id) {
    const list = await call('GET', '/api/sales-orders');
    const row = list.json?.data?.find(s => s.id === so.json.id);
    check('the sales order list row has no lines', row && row.lines === undefined, JSON.stringify(row));
    const rec = await call('GET', `/api/sales-orders/${so.json.id}`);
    check('the sales order record has its lines', rec.json?.data?.lines?.length === 1 && rec.json.data.lines[0].qty === 2, rec.text);
    await call('PATCH', `/api/sales-orders/${so.json.id}`, { status: 'CANCELLED' });
  }
}

// Fleet: an overdue service that a later service replaced no longer marks the vehicle as in maintenance.
{
  const v = await call('POST', '/api/vehicles', { code: `${tag}-V`, plate: 'SWP 1', vehicleType: 'Van' });
  check('vehicle is created', v.status === 201, `${v.status} ${v.text}`);
  if (v.json?.id) {
    const old = await call('POST', '/api/fleet-health', { vehicleId: v.json.id, recordType: 'SERVICE', serviceDate: '2026-01-01', nextDueDate: '2026-02-01', status: 'DONE', costSen: 0 });
    const state = async () => (await call('GET', '/api/coverage-fleet')).json?.vehicles?.find(x => x.id === v.json.id);
    check('a past due service marks the vehicle as in maintenance', (await state())?.state === 'MAINTENANCE', JSON.stringify(await state()));
    const fresh = await call('POST', '/api/fleet-health', { vehicleId: v.json.id, recordType: 'SERVICE', serviceDate: '2026-03-01', nextDueDate: '2099-01-01', status: 'DONE', costSen: 0 });
    const after = await state();
    check('a later service clears it', after?.state === 'AVAILABLE' && after?.overdue === 0, JSON.stringify(after));
    for (const r of [old, fresh]) if (r.json?.id) cleanup.push(['DELETE', `/api/fleet-health/${r.json.id}`]);
    cleanup.push(['DELETE', `/api/vehicles/${v.json.id}`]);
  }
}

for (const [m, p] of cleanup) await call(m, p);
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
