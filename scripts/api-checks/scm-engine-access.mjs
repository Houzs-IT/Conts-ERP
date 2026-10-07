// The Permissions chart inside the supply chain engine: a sign-on carries the role's level per area and
// the engine enforces it page by page. Runs against a local engine (wrangler dev on :8790 in
// engine/backend) with its CONTS_SSO_SECRET from engine/backend/.dev.vars. Reads only, plus refused writes.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ENGINE = process.env.ENGINE ?? 'http://localhost:8790';
const secret = readFileSync(new URL('../../engine/backend/.dev.vars', import.meta.url), 'utf8').match(/^CONTS_SSO_SECRET\s*=\s*"?([^"\r\n]+)"?/m)?.[1];
if (!secret) { console.error('CONTS_SSO_SECRET not found in engine/backend/.dev.vars'); process.exit(1); }
const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const AREAS = ['scSales', 'scInvoices', 'scConsignment', 'scProcurement', 'scTransportPlan', 'scWarehouse', 'serviceCases', 'projects'];
const levels = (base, over = {}) => ({ ...Object.fromEntries(AREAS.map(k => [k, base])), ...over });

async function signIn(role, access, email = `chart-${role}@theconts.test`) {
  const body = b64url(JSON.stringify({ email, name: `Chart check (${role})`, role, access, exp: Date.now() + 45_000 }));
  const r = await fetch(`${ENGINE}/api/conts-sso`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assertion: `${body}.${b64url(createHmac('sha256', secret).update(body).digest())}` }) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, token: j.token, error: j.error };
}
const as = token => async (method, path, body) => {
  const r = await fetch(ENGINE + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, text: (await r.text()).slice(0, 160) };
};
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ' :: ' + extra}`); };

// Operations staff on the standard levels: day-to-day supply chain, no invoices or accounting.
let s = await signIn('operations_staff', levels('edit', { scInvoices: 'none', projects: 'view' }));
check('operations staff sign in', s.status === 200 && !!s.token, `${s.status} ${s.error}`);
let call = as(s.token);
let r = await call('GET', '/api/scm/mfg-sales-orders?limit=1');
check('standard: sales orders open', r.status === 200, `${r.status} ${r.text}`);
r = await call('GET', '/api/scm/inventory/warehouses');
check('standard: warehouses open', r.status === 200, `${r.status} ${r.text}`);
r = await call('POST', '/api/scm/sales-invoices/from-dos', { picks: [] });
check('standard: raising a sales invoice is refused (403)', r.status === 403, `${r.status} ${r.text}`);
r = await call('GET', '/api/scm/purchase-invoices');
check('standard: purchase invoices are closed (403)', r.status === 403, `${r.status} ${r.text}`);
r = await call('GET', '/api/scm/accounting/accounts');
check('standard: accounting is closed (403)', r.status === 403, `${r.status} ${r.text}`);

// View only on Warehouse: reading works, a change is refused.
s = await signIn('operations_staff', levels('edit', { scInvoices: 'none', scWarehouse: 'view' }));
call = as(s.token);
r = await call('GET', '/api/scm/inventory/warehouses');
check('view on Warehouse: the list opens', r.status === 200, `${r.status} ${r.text}`);
r = await call('POST', '/api/scm/inventory/warehouses', {});
check('view on Warehouse: adding one is refused (403)', r.status === 403, `${r.status} ${r.text}`);
r = await call('POST', '/api/scm/mfg-sales-orders', {});
check('...while Sales order at Edit still reaches the form checks (not 403)', r.status !== 403, `${r.status} ${r.text}`);

// No access to Procurement at all.
s = await signIn('operations_staff', levels('edit', { scInvoices: 'none', scProcurement: 'none' }));
call = as(s.token);
r = await call('GET', '/api/scm/mfg-purchase-orders');
check('no access to Procurement: purchase orders are closed (403)', r.status === 403, `${r.status} ${r.text}`);
r = await call('GET', '/api/scm/mfg-sales-orders?limit=1');
check('...and Sales order is unaffected', r.status === 200, `${r.status} ${r.text}`);

// Nothing at all, a field role, a forged or malformed sign-on.
s = await signIn('operations_staff', levels('none'));
check('no access anywhere: sign-on refused (403)', s.status === 403, `${s.status} ${s.error}`);
s = await signIn('housekeeper', levels('full'));
check('field role refused even with full levels (403)', s.status === 403, `${s.status} ${s.error}`);
s = await signIn('operations_staff', { scSales: 'full' });
check('sign-on missing areas refused (401)', s.status === 401, `${s.status} ${s.error}`);
s = await signIn('operations_staff', levels('owner'));
check('sign-on with an unknown level refused (401)', s.status === 401, `${s.status} ${s.error}`);

// Full everywhere keeps the full-access role, as before the chart.
s = await signIn('management', levels('full'));
call = as(s.token);
r = await call('GET', '/api/scm/purchase-invoices');
check('full everywhere: purchase invoices open', r.status === 200, `${r.status} ${r.text}`);
r = await call('GET', '/api/scm/accounting/accounts');
check('full everywhere: accounting open', r.status === 200, `${r.status} ${r.text}`);

// Leave the test role on the standard levels.
await signIn('operations_staff', levels('edit', { scInvoices: 'none', projects: 'view' }));
console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0);
