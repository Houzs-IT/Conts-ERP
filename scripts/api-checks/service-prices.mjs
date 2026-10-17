// Service prices and profit by job (owner, 17 Oct 2026): the item list with owner price and internal cost, dated prices,
// jobs priced from it, maintenance jobs built from items, invoices as a job's actual cost (else an estimate), profit per
// job and the report, CSV import/export, and owner statements unchanged throughout.
// Needs a local server (harness.mjs) on demo data.
//
//   Before/after the migration (proves a past statement is unchanged by 0127):
//     1. database at 0126:  node scripts/api-checks/service-prices.mjs --before=<file>   (seeds the old price tables, records)
//     2. apply 0127 to that database
//     3.                    node scripts/api-checks/service-prices.mjs --after=<file>    (compares, then runs the rest)
//   On a database already at 0127: node scripts/api-checks/service-prices.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { call, check, done, cookieFor, receiptFor } from './harness.mjs';

const BASE = process.env.API_BASE ?? 'http://localhost:8788';
const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const beforeFile = arg('before'), afterFile = arg('after');
const units = (await call('GET', '/api/units')).json.data;
const MONTHS = ['2026-08', '2026-09', '2026-10'];
async function figures() {
  const out = {};
  for (const u of units) for (const m of MONTHS) {
    const r = await call('GET', `/api/units/financials?unitId=${u.id}&month=${m}`);
    out[`${u.id}:${m}`] = r.status === 200 ? (r.json.pnl ?? []).map(x => [x.label, x.amount]) : r.status;
  }
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

if (beforeFile) {
  // The old tables (0126): a price table, one unit's own price, a maintenance catalog item.
  let r = await call('PUT', '/api/housekeeping/prices', { rows: [
    { kind: 'turnover', layout: 'studio', internalCost: 4500, externalCharge: 8000 },
    { kind: 'turnover', layout: '2_bedroom', internalCost: 6500, externalCharge: 12000 },
    { kind: 'deep_clean', layout: '2_bedroom', internalCost: 9000, externalCharge: 18000 },
  ] });
  check('before: the old price table is saved', r.status === 200, r.text);
  r = await call('PUT', '/api/housekeeping/unit-prices', { unitId: units[0].id, kind: 'turnover', internalCost: 5000, externalCharge: 10000 });
  check('before: a unit\'s own price is saved', r.status === 200, r.text);
  r = await call('POST', '/api/maintenance/skus', { code: 'AC-SVC', name: 'Aircon service', category: 'aircon', unitLabel: 'unit', defaultPrice: 8000 });
  check('before: a maintenance catalog item is saved', r.status === 201, r.text);
  const f = await figures();
  check('before: owner statement figures recorded', Object.values(f).some(v => Array.isArray(v) && v.some(x => x[1] !== 0)), JSON.stringify(f).slice(0, 200));
  writeFileSync(beforeFile, JSON.stringify(f));
  done();
}

/* ---------------- after 0127 ---------------- */
let r = await call('GET', '/api/operations/service-prices');
check('the service list is on (migration 0127)', r.status === 200 && r.json.ready === true, r.text.slice(0, 200));
let items = r.json.items;
const byCode = c => items.find(i => i.code === c);
if (afterFile) {
  const was = JSON.parse(readFileSync(afterFile, 'utf8'));
  const now = await figures();
  const changed = Object.keys(was).filter(k => !same(was[k], now[k]));
  check(`migration: every owner statement figure is unchanged (${Object.keys(was).length} unit-months)`, changed.length === 0, changed.map(k => `${k}: ${JSON.stringify(was[k])} -> ${JSON.stringify(now[k])}`).join(' | '));
  const std = byCode('CLN-STANDARD'), deep = byCode('CLN-DEEP'), ac = byCode('AC-SVC');
  check('migration: the price table became Standard clean, by layout', std?.byLayout && std.cleanKind === 'turnover' && std.current.studio.ownerPrice === 8000 && std.current.studio.internalCost === 4500 && std.current['2_bedroom'].ownerPrice === 12000, JSON.stringify(std).slice(0, 300));
  check('migration: deep clean prices came across', deep?.current['2_bedroom'].ownerPrice === 18000 && deep.current['2_bedroom'].internalCost === 9000, JSON.stringify(deep?.current).slice(0, 200));
  check('migration: the catalog item kept its price as the owner price, same id', ac?.domain === 'maintenance' && ac.current.all.ownerPrice === 8000 && ac.current.all.internalCost === null, JSON.stringify(ac).slice(0, 200));
  r = await call('GET', '/api/housekeeping/unit-prices');
  const own = r.json.rows.find(x => x.unitId === units[0].id)?.prices.turnover;
  check('migration: the unit\'s own price came across', own?.override?.externalCharge === 10000 && own.override.internalCost === 5000 && own.externalCharge === 10000, JSON.stringify(own));
} else {
  // A fresh 0127 database: the same starting prices, set through the new screens.
  const std = byCode('CLN-STANDARD');
  r = await call('POST', `/api/operations/service-prices/${std.id}/prices`, { effectiveFrom: '2000-01-01', rows: [{ layout: 'studio', ownerPrice: 8000, internalCost: 4500 }, { layout: '2_bedroom', ownerPrice: 12000, internalCost: 6500 }] });
  check('fresh: standard clean prices set', r.status === 200, r.text);
  r = await call('PUT', '/api/housekeeping/unit-prices', { unitId: units[0].id, kind: 'turnover', internalCost: 5000, externalCharge: 10000 });
  check('fresh: a unit\'s own price is set', r.status === 200, r.text);
  r = await call('POST', '/api/operations/service-prices', { code: 'AC-SVC', name: 'Aircon service', domain: 'maintenance', category: 'aircon', uom: 'unit', byLayout: false, prices: { effectiveFrom: '2000-01-01', rows: [{ layout: 'all', ownerPrice: 8000, internalCost: null }] } });
  check('fresh: a maintenance item is added', r.status === 201, r.text);
  items = (await call('GET', '/api/operations/service-prices')).json.items;
}
const start = await figures();
const std = byCode('CLN-STANDARD') ?? items.find(i => i.code === 'CLN-STANDARD');
const ac = items.find(i => i.code === 'AC-SVC');

// Who may do what. The demo data may have no operations staff account; those checks are then skipped.
const staff = (await call('GET', '/api/operations/service-prices', undefined, 'operations_staff')).status !== 401;
const asStaff = async (label, fn) => { if (staff) await fn(); else console.log(`skip ${label} (no operations staff account in this data)`); };
r = await call('GET', '/api/operations/service-prices', undefined, 'housekeeper');
check('a cleaner cannot read service prices (403)', r.status === 403, r.text);
await asStaff('staff price', async () => {
  r = await call('POST', `/api/operations/service-prices/${std.id}/prices`, { effectiveFrom: '2031-01-01', rows: [{ layout: 'studio', ownerPrice: 1, internalCost: 1 }] }, 'operations_staff');
  check('operations staff cannot set prices (403)', r.status === 403, r.text);
});
r = await call('POST', '/api/operations/service-prices', { code: 'X', name: 'X', domain: 'cleaning', category: 'aircon' });
check('a sub-category of the other type is refused (422)', r.status === 422, r.text);
r = await call('POST', '/api/operations/service-prices', { code: 'CLN-STANDARD', name: 'Again', domain: 'cleaning', category: 'turnover' });
check('a code in use is refused (409)', r.status === 409, r.text);

// Dated prices: a change from a date reaches jobs on or after it only.
r = await call('POST', `/api/operations/service-prices/${std.id}/prices`, { effectiveFrom: '2031-01-01', note: 'New rates', rows: [{ layout: 'studio', ownerPrice: 9900, internalCost: 5200 }] });
check('a price change from 1 Jan 2031 is scheduled', r.status === 200, r.text);
r = await call('GET', `/api/operations/service-prices/${std.id}`);
check('the history shows it as scheduled, the old price still in force', r.status === 200 && r.json.history[0].effectiveFrom === '2031-01-01' && r.json.history[0].status === 'scheduled'
  && r.json.history.some(h => h.status === 'current') && r.json.current.studio.ownerPrice === 8000 && r.json.next?.effectiveFrom === '2031-01-01', r.text.slice(0, 400));
r = await call('POST', '/api/housekeeping/tasks', { external: { address: 'Old rate street' }, layout: 'studio', serviceItemId: std.id, date: '2030-12-31', kind: 'turnover' });
const extOld = r.json?.id;
r = await call('POST', '/api/housekeeping/tasks', { external: { address: 'New rate street' }, layout: 'studio', serviceItemId: std.id, date: '2031-01-02', kind: 'turnover' });
const extNew = r.json?.id;
let a = (await call('GET', `/api/housekeeping/tasks/${extOld}`)).json, b = (await call('GET', `/api/housekeeping/tasks/${extNew}`)).json;
check('an external job charges the owner price as the client charge, by its day', a?.cost?.amount === 8000 && b?.cost?.amount === 9900, `${a?.cost?.amount} ${b?.cost?.amount}`);
check('and its cleaner\'s pay is the internal cost of that day', a?.cost?.cleanerPay === 4500 && b?.cost?.cleanerPay === 5200, `${a?.cost?.cleanerPay} ${b?.cost?.cleanerPay}`);

// A clean on a unit: priced from the list (the unit's own figures first), charged to the owner, cost by the cleaner's pay
// and then by an invoice.
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10), month = today.slice(0, 7);
r = await call('POST', '/api/housekeeping/tasks', { unitId: units[0].id, date: today, kind: 'turnover' });
check('a clean on the unit is added', r.status === 201, r.text);
const clean = r.json.id;
let t = (await call('GET', `/api/housekeeping/tasks/${clean}`)).json;
check('it takes the unit\'s own owner price and cleaner\'s pay', t.cost.amount === 10000 && t.cost.cleanerPay === 5000, JSON.stringify(t.cost));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const form = new FormData(); form.append('file', new Blob([PNG], { type: 'image/png' }), 'done.png');
await fetch(`${BASE}/api/tasks/${clean}/photos`, { method: 'POST', headers: { cookie: cookieFor('management') }, body: form });
const beforeCharge = await call('GET', `/api/units/financials?unitId=${units[0].id}&month=${month}`);
r = await call('POST', `/api/tasks/${clean}/complete`, { photoIds: [] });
check('the clean completes', r.status === 200, r.text);
let m = (await call('GET', `/api/operations/job-money?kind=cleaning&id=${clean}`)).json;
check('cleaning: billed is the owner charge on the statement, cost the cleaner\'s pay, profit the difference', m.billed === 10000 && m.billedSource === 'statement' && m.actual === 5000 && m.actualSource === 'cleaner_pay' && m.profit === 5000, JSON.stringify(m));
const afterCharge = await call('GET', `/api/units/financials?unitId=${units[0].id}&month=${month}`);
const net = x => x.json.pnl?.find(l => l.type === 'net')?.amount;
check('cleaning: the owner statement takes the owner price, as before', net(beforeCharge) - net(afterCharge) > 0, `${net(beforeCharge)} -> ${net(afterCharge)}`);
r = await call('POST', '/api/operations/job-invoices', { kind: 'cleaning', jobId: clean, supplierName: 'Sparkle Sdn Bhd', invoiceNo: 'SP-1', invoiceDate: today, amount: 6000 });
check('an invoice without its file is refused (422)', r.status === 422 && !!r.json.error.fields?.file, r.text);
r = await call('POST', '/api/operations/job-invoices', { kind: 'cleaning', jobId: clean, supplierName: 'Sparkle', invoiceNo: 'SP-1', invoiceDate: today, amount: 6000, documentId: 'x' }, 'technician');
check('a technician cannot submit an invoice (403)', r.status === 403, r.text);
let doc = await receiptFor(units[0].id);
r = await call('POST', '/api/operations/job-invoices', { kind: 'cleaning', jobId: clean, supplierName: 'Sparkle Sdn Bhd', invoiceNo: 'SP-1', invoiceDate: today, amount: 6000, documentId: doc }, staff ? 'operations_staff' : 'operations_manager');
check('the office submits the cleaner\'s invoice with its file', r.status === 201, r.text);
m = (await call('GET', `/api/operations/job-money?kind=cleaning&id=${clean}`)).json;
check('cleaning: the actual cost is now the invoice, profit follows', m.actual === 6000 && m.actualSource === 'invoice' && m.profit === 4000 && m.invoices.length === 1, JSON.stringify(m));
const afterInvoice = await call('GET', `/api/units/financials?unitId=${units[0].id}&month=${month}`);
check('the invoice never reaches the owner statement', net(afterInvoice) === net(afterCharge), `${net(afterCharge)} -> ${net(afterInvoice)}`);
const cp = JSON.stringify(afterInvoice.json.companyPnl ?? []);
check('The Conts\' P&L shows the charge and its actual cost', cp.includes('Cleaning and repairs charged to the owner') && cp.includes('Their actual cost'), cp.slice(0, 300));
r = await call('GET', `/api/operations/job-money?kind=cleaning&id=${clean}`, undefined, 'housekeeper');
check('a cleaner cannot see a job\'s cost (403)', r.status === 403, r.text);

// Maintenance: items picked with quantities make the owner price; the estimate until an invoice comes in.
r = await call('POST', `/api/operations/service-prices/${ac.id}/prices`, { effectiveFrom: '2000-01-01', rows: [{ layout: 'all', ownerPrice: 8000, internalCost: 5000 }] });
check('the aircon item gets its internal cost', r.status === 200, r.text);
r = await call('POST', '/api/maintenance/issues', { unitId: units[1].id, title: 'Aircon not cooling', category: 'aircon',
  items: [{ itemId: ac.id, qty: 2 }, { itemId: null, name: 'Gas top-up', qty: 1, ownerPrice: 5000, internalCost: 3000 }] }, staff ? 'operations_staff' : 'operations_manager');
check('the office adds a job by picking items', r.status === 201, r.text);
const job = r.json.id;
let jobs = (await call('GET', '/api/maintenance/issues')).json.data;
check('the quote is the items\' total (2 x RM 80 + RM 50)', jobs.find(j => j.id === job)?.quotedAmount === 21000, JSON.stringify(jobs.find(j => j.id === job)).slice(0, 200));
m = (await call('GET', `/api/operations/job-money?kind=maintenance&id=${job}`)).json;
check('maintenance: estimated cost from the items (2 x RM 50 + RM 30), profit estimated', m.lines.length === 2 && m.billed === 21000 && m.billedSource === 'quote' && m.actual === 13000 && m.actualSource === 'estimate' && m.profit === 8000, JSON.stringify(m).slice(0, 400));
r = await call('PUT', `/api/maintenance/issues/${job}/items`, { items: [{ itemId: ac.id, qty: 3 }] });
check('the items can change before the job is done; the quote follows', r.status === 200 && r.json.quotedAmount === 24000, r.text);
r = await call('PUT', `/api/maintenance/issues/${job}/items`, { items: [{ itemId: null, name: '', qty: 1, ownerPrice: 100 }] });
check('an Other line needs a name (422)', r.status === 422, r.text);
r = await call('POST', `/api/maintenance/issues/${job}/complete`, { finalAmount: 24000 });
check('the job is finished at its quote', r.status === 200, r.text);
r = await call('PUT', `/api/maintenance/issues/${job}/items`, { items: [{ itemId: ac.id, qty: 1 }] });
check('a finished job\'s items stay (409)', r.status === 409, r.text);
doc = await receiptFor(units[1].id);
r = await call('POST', '/api/operations/job-invoices', { kind: 'maintenance', jobId: job, supplierName: 'Cool Air Sdn Bhd', invoiceNo: 'CA-77', invoiceDate: today, amount: 10000, documentId: doc });
doc = await receiptFor(units[1].id);
const second = await call('POST', '/api/operations/job-invoices', { kind: 'maintenance', jobId: job, supplierName: 'Parts Sdn Bhd', invoiceNo: 'P-1', invoiceDate: today, amount: 6000, documentId: doc });
check('two invoices go on the job', r.status === 201 && second.status === 201, r.text + second.text);
m = (await call('GET', `/api/operations/job-money?kind=maintenance&id=${job}`)).json;
check('maintenance: billed is the statement charge, actual the invoices\' total, profit the difference', m.billed === 24000 && m.billedSource === 'statement' && m.actual === 16000 && m.actualSource === 'invoice' && m.profit === 8000, JSON.stringify(m).slice(0, 300));
r = await call('DELETE', `/api/operations/job-invoices/${second.json.id}`, undefined, 'technician');
check('a technician cannot take back an invoice (403)', r.status === 403, r.text);
r = await call('DELETE', `/api/operations/job-invoices/${second.json.id}`);
m = (await call('GET', `/api/operations/job-money?kind=maintenance&id=${job}`)).json;
check('management takes one back; the cost follows', r.status === 200 && m.actual === 10000 && m.profit === 14000, JSON.stringify(m).slice(0, 200));

// Profit by job.
r = await call('GET', `/api/operations/job-profit?kind=maintenance&month=${month}`);
const row = r.json?.rows?.find(x => x.id === job);
check('the report lists the job with billed, cost and profit', r.status === 200 && row?.billed === 24000 && row.actual === 10000 && row.profit === 14000 && row.actualSource === 'invoice', JSON.stringify(row));
check('and the month\'s totals add up', r.json.totals.billed === r.json.rows.reduce((n, x) => n + x.billed, 0) && r.json.totals.profit === r.json.rows.reduce((n, x) => n + (x.profit ?? 0), 0), JSON.stringify(r.json.totals));
r = await call('GET', `/api/operations/job-profit?kind=cleaning&month=${month}`);
check('the cleaning report has the clean at its invoice cost', r.json?.rows?.find(x => x.id === clean)?.profit === 4000, JSON.stringify(r.json?.rows?.find(x => x.id === clean)));
r = await call('GET', `/api/operations/job-profit?kind=cleaning&month=${month}`, undefined, 'housekeeper');
check('a cleaner does not see profit by job (403)', r.status === 403, r.text);
await asStaff('staff profit', async () => {
  r = await call('GET', `/api/operations/job-profit?kind=cleaning&month=${month}`, undefined, 'operations_staff');
  check('operations staff do not see profit by job (403)', r.status === 403, r.text);
});

// The spreadsheet: export, then import a new item and a price change.
const exp = await fetch(`${BASE}/api/operations/service-prices/export`, { headers: { cookie: cookieFor('management') } });
const csv = await exp.text();
check('export: a CSV with the columns and every item', exp.status === 200 && csv.includes('"Owner price (RM)"') && csv.includes('"CLN-STANDARD"') && csv.includes('"AC-SVC"'), csv.slice(0, 200));
const rows = [
  { Code: 'CLN-LAUNDRY', Name: 'Laundry, one set', Type: 'Cleaning', 'Sub-category': 'Laundry', 'Unit of measure': 'Set', 'Priced by layout': 'No', Layout: 'All', 'Owner price (RM)': '25.00', 'Internal cost (RM)': '12', Active: 'Yes' },
  { Code: 'AC-SVC', 'Owner price (RM)': '90.00', 'Internal cost (RM)': '' },
  { Code: 'BAD', Name: 'Bad', Type: 'Cleaning', 'Sub-category': 'Aircon' },
];
r = await call('POST', '/api/operations/service-prices/import', { rows, effectiveFrom: '2031-02-01', dryRun: true });
check('import: a bad row stops the file, with its row named', r.status === 200 && r.json.ok === false && r.json.errors.some(e => e.message.startsWith('BAD')), r.text.slice(0, 300));
r = await call('POST', '/api/operations/service-prices/import', { rows: rows.slice(0, 2), effectiveFrom: '2031-02-01', dryRun: true });
check('import: the dry run says 1 new item and 2 price changes', r.json.ok === true && r.json.created === 1 && r.json.priceChanges === 2, r.text.slice(0, 300));
await asStaff('staff import', async () => {
  r = await call('POST', '/api/operations/service-prices/import', { rows: rows.slice(0, 2), effectiveFrom: '2031-02-01' }, 'operations_staff');
  check('import: a file that changes prices needs management', r.json?.ok === false && r.json.errors.some(e => e.message.includes('management')), r.text.slice(0, 200));
});
r = await call('POST', '/api/operations/service-prices/import', { rows: rows.slice(0, 2), effectiveFrom: '2031-02-01' }, 'technician');
check('import: a technician cannot import (403)', r.status === 403, r.text.slice(0, 200));
r = await call('POST', '/api/operations/service-prices/import', { rows: rows.slice(0, 2), effectiveFrom: '2031-02-01' });
check('import: applied', r.status === 200 && r.json.ok === true && r.json.dryRun === false, r.text.slice(0, 200));
r = await call('GET', `/api/operations/service-prices/${ac.id}`);
check('import: the new price is dated, the old one still in force, the blank internal cost kept', r.json.current.all.ownerPrice === 8000 && r.json.next?.effectiveFrom === '2031-02-01' && r.json.next.rows.all.ownerPrice === 9000 && r.json.next.rows.all.internalCost === 5000, JSON.stringify({ c: r.json.current, n: r.json.next }));
items = (await call('GET', '/api/operations/service-prices?domain=cleaning')).json.items;
check('import: the new cleaning item is on the list, priced from the date', items.some(i => i.code === 'CLN-LAUNDRY' && i.current.all.ownerPrice === null && i.next?.rows.all.ownerPrice === 2500 && i.next.rows.all.internalCost === 1200), JSON.stringify(items.find(i => i.code === 'CLN-LAUNDRY')));

// Past statements: none of the above moved a past month.
const end = await figures();
const moved = MONTHS.slice(0, 2).flatMap(mo => units.map(u => `${u.id}:${mo}`)).filter(k => !same(start[k], end[k]));
check('past owner statements (Aug, Sep) are unchanged after all of it', moved.length === 0, moved.join(', '));
done();
