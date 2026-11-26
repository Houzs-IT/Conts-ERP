// node --test src/lib/mcpMore.test.mjs. AI Connector round 3 (functions/_lib/mcpMore.ts, mcpXlsx.ts): the four new
// quick answers, the daily brief, export_excel's paging / columns / cells, the .xlsx writer and the rate limit.
// The replies below have the shapes the real handlers return (functions/api/portfolio/performance.ts,
// reservations/index.ts, sales-invoices/index.ts, statements/index.ts, attendance/index.ts, leaves/index.ts,
// nav/badges.ts, tasks/index.ts, approvals/index.ts, sales-orders, purchase-orders, maintenance/issues.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { inflateRawSync } from 'node:zlib';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; }
}`));
const M = await import('../../functions/_lib/mcpMore.ts');
const X = await import('../../functions/_lib/mcpXlsx.ts');

const O = 'https://erp.example';

test('days', () => {
  assert.equal(M.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(M.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(M.daysBetween('2026-11-01', '2026-11-26'), 25);
});

test('occupancy_summary: totals, buildings, lowest units, money only when present', () => {
  const perf = {
    period: '2026-11', days: 10, units: 3, buildings: 2,
    rows: [
      { unitNumber: 'A-1', propertyId: 'pa', propertyName: 'Alpha', nights: 10, occupancy: 100, revenue: 0, exception: null },
      { unitNumber: 'A-2', propertyId: 'pa', propertyName: 'Alpha', nights: 5, occupancy: 50, revenue: 0, exception: { label: 'Needs cleaning', tone: 'warning' } },
      { unitNumber: 'B-1', propertyId: 'pb', propertyName: 'Beta', nights: 0, occupancy: 0, revenue: 0, exception: { label: 'Blocked', tone: 'warning' } },
    ],
  };
  const s = M.summariseOccupancy('2026-11', '2026-11-10', perf, { kpis: [{ key: 'occupancy', value: '52.3' }] }, { counts: { inhouse: 2 }, facets: { building: [{ value: 'pa', count: 1 }, { value: 'pb', count: 1 }] } });
  assert.equal(s.nightsSold, 15);
  assert.equal(s.occupancyPct, 50);
  assert.equal(s.dashboardOccupancyPct, 52.3);
  assert.equal(s.staysInHouseNow, 2);
  assert.deepEqual(s.tonightByBuilding, [
    { building: 'Beta', units: 1, occupiedNow: 1, occupancyPct: 100 },
    { building: 'Alpha', units: 2, occupiedNow: 1, occupancyPct: 50 },
  ]);
  assert.deepEqual(s.byBuilding.map(b => [b.building, b.occupancyPct]), [['Alpha', 75], ['Beta', 0]]);
  assert.equal(s.lowestUnits[0].unit, 'Beta B-1');
  assert.equal('incomeRm' in s.lowestUnits[0], false); // no finance access: the endpoint sent 0s
  assert.equal(s.unitsNeedingAttention.count, 2);
  assert.match(s.note, /in progress/);
  const money = M.summariseOccupancy('2026-10', '2026-11-10', { ...perf, rows: [{ ...perf.rows[0], revenue: 123456 }] }, null, null);
  assert.equal(money.lowestUnits[0].incomeRm, 1234.56);
  assert.equal('staysInHouseNow' in money, false);
});

test('arrears_summary: guest balances and overdue customer invoices by age', () => {
  const guests = {
    todos: { unpaid: { count: 3, outstanding: 45000 }, payout: { count: 2, outstanding: 10000 } },
    data: [{ id: 'r1', externalRef: 'D-1', guestName: 'Ali', propertyName: 'Alpha', unitNumber: 'A-1', checkIn: '2026-11-01', checkOut: '2026-11-03', outstanding: 15000 }],
  };
  const invoices = { data: [
    { invoiceNumber: 'SI-1', customerName: 'X', dueDate: '2026-11-20', status: 'SENT', outstandingSen: 10000 }, // 6 days
    { invoiceNumber: 'SI-2', customerName: 'Y', dueDate: '2026-08-01', status: 'OVERDUE', outstandingSen: 50000 }, // 117 days
    { invoiceNumber: 'SI-3', customerName: 'Z', dueDate: '2026-12-20', status: 'SENT', outstandingSen: 7000 }, // not due
    { invoiceNumber: 'SI-4', customerName: 'W', dueDate: '2026-01-01', status: 'PAID', outstandingSen: 0 },
    { invoiceNumber: 'SI-5', customerName: 'V', dueDate: '2026-01-01', status: 'CANCELLED', outstandingSen: 9000 },
  ] };
  const s = M.summariseArrears('2026-11-26', O, guests, invoices);
  assert.equal(s.guests.directGuestsOwing, 3);
  assert.equal(s.guests.owedRm, 450);
  assert.equal(s.guests.oldest[0].daysSinceCheckIn, 25);
  assert.equal(s.guests.oldest[0].link, `${O}/reservations/bookings?view=all&open=r1`);
  assert.deepEqual(s.guests.hostPayoutsOutstanding, { count: 2, owedRm: 100 });
  assert.equal('ageingByDaysRm' in s.guests, false); // the page did not hold all 3 guests owing
  const all = M.summariseArrears('2026-11-26', O, { todos: { unpaid: { count: 1, outstanding: 15000 } }, data: guests.data }, null);
  assert.deepEqual(all.guests.ageingByDaysRm, { '0-30': 150, '31-60': 0, '61-90': 0, '90+': 0 });
  assert.match(all.note, /rent arrears cannot be reported/);
  assert.equal(s.customers.openInvoices, 3);
  assert.equal(s.customers.openRm, 670);
  assert.equal(s.customers.overdueInvoices, 2);
  assert.equal(s.customers.overdueRm, 600);
  assert.deepEqual(s.customers.overdueByDaysRm, { '0-30': 100, '31-60': 0, '61-90': 0, '90+': 500 });
  assert.equal(s.customers.biggestOverdue[0].invoice, 'SI-2');
  // Either part missing (refused): it is simply absent.
  const only = M.summariseArrears('2026-11-26', O, null, invoices);
  assert.equal('guests' in only, false);
  assert.equal(only.customers.overdueInvoices, 2);
});

test('owner_statement_summary', () => {
  const reply = {
    period: '2026-10', total: 3, totals: { gross: 1000000, fee: 200000, expenses: 50000, net: 750000 }, summary: { notSent: 1 },
    periods: [{ period: '2026-10', count: 3, net: 750000, provisional: 1, finalised: 1, sent: 1, paid: 0 }, { period: '2026-09', count: 2, net: 500000, provisional: 0, finalised: 0, sent: 0, paid: 2 }],
    data: [
      { id: 's1', ownerName: 'A', unitsLabel: 'Alpha A-1', state: 'sent', netPayout: 500000, sentAt: '2026-11-05T02:00:00Z' },
      { id: 's2', ownerName: 'B', unitsLabel: 'Alpha A-2', state: 'finalised', netPayout: 300000 },
      { id: 's3', ownerName: 'C', unitsLabel: 'Beta B-1', state: 'provisional', netPayout: -50000 },
    ],
  };
  const s = M.summariseStatements(O, reply);
  assert.equal(s.period, '2026-10');
  assert.deepEqual(s.byStatus, { draft: 1, final: 1, sent: 1, paid: 0 });
  assert.equal(s.finalNotSent, 1);
  assert.deepEqual(s.totals, { guestTotalRm: 10000, operatorShareRm: 2000, expensesRm: 500, netPayoutToOwnerRm: 7500 });
  assert.deepEqual(s.waitingToSend, [{ owner: 'B', netPayoutToOwnerRm: 3000, link: `${O}/finance/statements/s2` }]);
  assert.deepEqual(s.stillDraft.map(x => x.owner), ['C']);
  assert.deepEqual(s.sent, [{ owner: 'A', sentAt: '2026-11-05', link: `${O}/finance/statements/s1` }]);
  assert.equal(s.biggestPayouts[0].status, 'sent');
  assert.equal(s.ownersOwingUs, 1);
  assert.equal(s.biggestPayouts[0].link, `${O}/finance/statements/s1`);
  assert.equal(s.recentMonths.length, 2);
});

test('attendance_today', () => {
  const att = { date: '2026-11-26', data: [
    { employee: { name: 'Aina' }, punch: { clockInAt: 'x', clockOutAt: null, forgotOut: false }, leave: null },
    { employee: { name: 'Ben' }, punch: { clockInAt: 'x', clockOutAt: 'y', forgotOut: true }, leave: null },
    { employee: { name: 'Chong' }, punch: null, leave: 'annual' },
    { employee: { name: 'Dev' }, punch: null, leave: null },
  ] };
  const leaves = { leaves: [
    { name: 'Ezra', type: 'annual', startDate: '2026-11-28', endDate: '2026-11-29', status: 'pending', days: 2 },
    { name: 'Faiz', type: 'medical', startDate: '2026-11-30', endDate: '2026-11-30', status: 'approved', days: 1 },
    { name: 'Gina', type: 'annual', startDate: '2026-12-20', endDate: '2026-12-21', status: 'approved', days: 2 },
  ] };
  const s = M.summariseAttendance('2026-11-26', att, leaves);
  assert.equal(s.people, 4);
  assert.equal(s.clockedIn, 2);
  assert.equal(s.stillIn, 1);
  assert.equal(s.forgotToClockOut, 1);
  assert.deepEqual(s.onLeave, { count: 1, people: [{ name: 'Chong', type: 'annual' }] });
  assert.deepEqual(s.notClockedIn, { count: 1, people: ['Dev'] });
  assert.equal(s.leaveRequestsWaiting.count, 1);
  assert.deepEqual(s.leaveNext7Days.map(l => l.name), ['Faiz']);
  assert.equal('leaveRequestsWaiting' in M.summariseAttendance('2026-11-26', att, null), false);
});

test('daily_brief: sections, top 5, refusals, the bell without a duplicate approvals line', () => {
  const today = '2026-11-26';
  const tasks = { data: Array.from({ length: 7 }, (_, i) => ({ title: `Task ${i}`, kind: 'inspection', state: 'open', date: M.addDays(today, i - 3), propertyName: 'Alpha', unitNumber: 'A-1' })) };
  const approvals = { data: [
    { kindLabel: 'Refund', summary: 'Refund D-1', amount: 12000, requestedBy: { name: 'Lim' }, requestedAt: '2026-11-25T01:00:00Z', can: { approve: true } },
    { kindLabel: 'Refund', summary: 'Own request', amount: 1000, requestedBy: { name: 'Me' }, requestedAt: '2026-11-25T01:00:00Z', can: { approve: false } },
  ] };
  const salesOrders = { data: [
    { docNo: 'SO-1', customerName: 'X', targetDate: '2026-11-20', status: 'IN_PRODUCTION' },
    { docNo: 'SO-2', customerName: 'Y', targetDate: '2026-11-20', status: 'DELIVERED' },
    { docNo: 'SO-3', customerName: 'Z', targetDate: '2026-12-20', status: 'CONFIRMED' },
  ] };
  const purchaseOrders = { data: [{ poNumber: 'PO-1', supplierName: 'S', expectedAt: '2026-11-27', status: 'SUBMITTED' }, { poNumber: 'PO-2', supplierName: 'S', expectedAt: '2026-11-01', status: 'RECEIVED' }] };
  const maintenance = { data: [{ id: 'm1', title: 'Leak', state: 'open', dueOn: '2026-11-26', propertyName: 'Alpha', unitNumber: 'A-2' }, { id: 'm2', title: 'Old', state: 'resolved', dueOn: '2026-11-01' }] };
  const badges = { alerts: [
    { key: 'approvals', title: '1 money request waiting', body: '', target: '/finance/approvals', count: 1 },
    { key: 'statements', title: '2 statements final, not sent', body: 'Owners cannot see them', target: '/owners?view=statements', count: 2 },
  ] };
  const b = M.buildBrief({ today, origin: O, name: 'Me', badges, tasks, approvals, salesOrders, purchaseOrders, maintenance, noAccess: [] });
  const by = Object.fromEntries(b.sections.map(s => [s.section, s]));
  const t = by['My jobs overdue or due in 3 days'];
  assert.equal(t.count, 7);
  assert.equal(t.top.length, 5);
  assert.equal(t.top[0].due, 'overdue 3 d');
  assert.equal(by['Approvals waiting for you'].count, 1);
  assert.equal(by['Sales orders to deliver (overdue or in 3 days)'].count, 1);
  assert.equal(by['Purchase orders expected (overdue or in 3 days)'].top[0].due, 'due in 1 d');
  assert.equal(by['Maintenance jobs overdue or due in 3 days'].top[0].link, `${O}/operations/maintenance?id=m1`);
  const bell = by['Also waiting (the ERP bell)'];
  assert.equal(bell.top.length, 1); // the approvals alert is already its own section
  assert.equal(bell.top[0].link, `${O}/owners?view=statements`);
  assert.match(b.notCovered, /Mail Center/);
  assert.equal('noAccess' in b, false);

  const staff = M.buildBrief({ today, origin: O, name: 'Staff', badges: { alerts: [] }, tasks: { data: [] }, approvals: null, salesOrders: null, purchaseOrders: null, maintenance: null, noAccess: ['Approvals', 'Sales orders'] });
  assert.equal(staff.sections.length, 0);
  assert.match(staff.nothing, /Nothing overdue/);
  assert.equal(staff.noAccess, 'Your account does not have access to: Approvals, Sales orders. Those are left out.');
  assert.ok(JSON.stringify(b).length < 30_000); // under the connector's reply cap
});

test('payables_summary: supplier invoices aged past due, due this week, contractor claims', () => {
  const today = '2026-11-26';
  const invoices = { data: [
    { supplierName: 'Acme', dueDate: '2026-11-30', status: 'SENT', outstandingSen: 20000 }, // due this week
    { supplierName: 'Acme', dueDate: '2026-09-01', status: 'PARTIALLY_PAID', outstandingSen: 30000 }, // 86 days past due
    { supplierName: 'Beta', dueDate: '', status: 'SENT', outstandingSen: 5000 }, // no due date
    { supplierName: 'Gone', dueDate: '2026-01-01', status: 'PAID', outstandingSen: 0 },
  ] };
  const claims = { counts: { unpaid: 1, paid: 4 }, owed: 12345, data: [{ title: 'Pipe', payee: 'Ah Kow', billingDate: '2026-10-01', amount: 12345, paidOn: null, propertyName: 'Alpha', unitNumber: 'A-1' }] };
  const s = M.summarisePayables(today, O, invoices, claims);
  assert.equal(s.suppliers.openInvoices, 3);
  assert.equal(s.suppliers.owedRm, 550);
  assert.deepEqual(s.suppliers.ageingByDaysPastDueRm, { '0-30': 250, '31-60': 0, '61-90': 300, '90+': 0 });
  assert.deepEqual(s.suppliers.dueThisWeek, { invoices: 1, owedRm: 200 });
  assert.deepEqual(s.suppliers.bySupplier[0], { supplier: 'Acme', invoices: 2, owedRm: 500, overdueRm: 300 });
  assert.equal(s.contractors.unpaidClaims, 1);
  assert.equal(s.contractors.owedRm, 123.45);
  assert.deepEqual(s.contractors.ageingByDaysRm, { '0-30': 0, '31-60': 123.45, '61-90': 0, '90+': 0 });
  assert.equal('contractors' in M.summarisePayables(today, O, invoices, null), false);
});

test('today lists: who checks in and out', () => {
  const t = M.todayStays(O, { total: 1, data: [{ id: 'r9', externalRef: 'HM9', guestName: 'Siti', propertyName: 'Alpha', unitNumber: 'A-1', channel: 'airbnb', checkInTime: '15:00' }] });
  assert.deepEqual(t, { count: 1, list: [{ ref: 'HM9', guest: 'Siti', unit: 'Alpha A-1', channel: 'airbnb', time: '15:00', link: `${O}/reservations/bookings?view=all&open=r9` }] });
});

test('export_excel: allowlist, query, paging, columns, cells', () => {
  const r = M.EXPORT_LISTS.reservations;
  assert.deepEqual(M.exportQuery(r, { st: 'confirmed', evil: 'x', q: { nested: 1 } }, 2, '2026-11-01', '2026-11-30'),
    { view: 'all', st: 'confirmed', from: '2026-11-01', to: '2026-11-30', page: '2', size: '1000', export: '1' });
  assert.deepEqual(M.exportQuery(M.EXPORT_LISTS.statements, { period: '2026-10' }, 1), { period: '2026-10', page: '1', pageSize: '500' });
  assert.deepEqual(M.exportQuery(M.EXPORT_LISTS.sales_orders, { status: 'CONFIRMED' }, 1), { status: 'CONFIRMED' });
  // Paging stops at the total, at a short page, at the cap, and never for a one-reply list.
  assert.equal(M.morePages(r, 1000, 1000, 2500), true);
  assert.equal(M.morePages(r, 500, 2500, 2500), false);
  assert.equal(M.morePages(r, 1000, 1000, null), true);
  assert.equal(M.morePages(r, 999, 999, null), false);
  assert.equal(M.morePages(r, 1000, 5000, 9000), false);
  assert.equal(M.morePages(M.EXPORT_LISTS.units, 50, 50, null), false);
  // Columns: defaults the rows have (no money keys for an account without finance), or the caller's fields.
  const rows = [{ externalRef: 'D-1', guestName: 'Ali', checkIn: '2026-11-01', nested: { a: 1 }, outstanding: 15050 }];
  assert.deepEqual(M.exportColumns(r, rows, []).map(c => c.key), ['externalRef', 'guestName', 'checkIn', 'outstanding']);
  assert.deepEqual(M.exportColumns(r, rows, ['guestName', 'nope']).map(c => c.key), ['guestName']);
  assert.deepEqual(M.exportColumns(r, rows, []).map(c => c.header), ['Reference', 'Guest name', 'Check in', 'Outstanding (RM)']);
  assert.equal(M.exportColumns(r, [{ grossBookingValue: 1 }], [])[0].header, 'Guest total (RM)');
  const so = M.exportColumns(M.EXPORT_LISTS.sales_orders, [{ docNo: 'SO-1', totalSen: 100 }], []);
  assert.deepEqual(so.map(c => [c.header, c.money]), [['Doc no', false], ['Total (RM)', true]]);
  assert.equal(M.exportColumns(M.EXPORT_LISTS.suppliers, [{ code: 'S1', name: 'A', tags: ['x'] }], []).length, 2);
  assert.equal(M.cellValue(15050, true), 150.5);
  assert.equal(M.cellValue(null, true), null);
  assert.equal(M.cellValue(true, false), 'Yes');
  assert.equal(M.cellValue('x', false), 'x');
});

/** The files of a zip, read with Node's own inflate (an independent check of the hand-written writer). */
function unzip(buf) {
  const b = Buffer.from(buf);
  const files = {};
  const end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = b.readUInt16LE(end + 10);
  let at = b.readUInt32LE(end + 16);
  for (let i = 0; i < n; i++) {
    assert.equal(b.readUInt32LE(at), 0x02014b50);
    const method = b.readUInt16LE(at + 10), crc = b.readUInt32LE(at + 16), size = b.readUInt32LE(at + 20), raw = b.readUInt32LE(at + 24);
    const nameLen = b.readUInt16LE(at + 28), off = b.readUInt32LE(at + 42);
    const name = b.subarray(at + 46, at + 46 + nameLen).toString();
    const lNameLen = b.readUInt16LE(off + 26);
    const body = b.subarray(off + 30 + lNameLen, off + 30 + lNameLen + size);
    const data = method === 8 ? inflateRawSync(body) : body;
    assert.equal(data.length, raw);
    assert.equal(X.crc32(new Uint8Array(data)), crc);
    files[name] = data.toString('utf8');
    at += 46 + nameLen;
  }
  return files;
}

test('xlsx: a valid zip with the workbook parts, header, numbers and RM', async () => {
  assert.equal(X.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(X.colName(0), 'A'); assert.equal(X.colName(25), 'Z'); assert.equal(X.colName(26), 'AA'); assert.equal(X.colName(701), 'ZZ');
  assert.equal(X.xmlText('a<b>&"\u0001c'), 'a&lt;b&gt;&amp;&quot;c');
  assert.equal(X.sheetName('Guest invoices / receipts: [all]'), 'Guest invoices   receipts   all');
  const cols = [{ header: 'Ref' }, { header: 'Amount (RM)', money: true }];
  const rows = [['=HYPERLINK("x")', 150.5], ['D-2', null]];
  for (const compress of [true, false]) {
    const f = unzip(await X.buildXlsx('Reservations', cols, rows, compress));
    assert.deepEqual(Object.keys(f).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
    const sheet = f['xl/worksheets/sheet1.xml'];
    assert.match(sheet, /<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Ref<\/t>/);
    assert.match(sheet, /<c r="B2" s="2"><v>150.5<\/v><\/c>/);
    assert.match(sheet, /<c r="A2" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK\(&quot;x&quot;\)<\/t>/); // text, never a formula
    assert.ok(!sheet.includes('r="B3"')); // empty cell left out
    assert.match(sheet, /state="frozen"/);
    assert.match(sheet, /<autoFilter ref="A1:B3"\/>/);
    assert.match(f['xl/workbook.xml'], /<sheet name="Reservations"/);
    assert.match(f['xl/styles.xml'], /numFmtId="4"/);
  }
  // 5,000 rows x 14 columns builds and compresses well.
  const big = Array.from({ length: 5000 }, (_, i) => Array.from({ length: 14 }, (_, j) => (j % 2 ? i * 1.5 : `Row ${i} col ${j}`)));
  const t0 = Date.now();
  const bytes = await X.buildXlsx('Big', Array.from({ length: 14 }, (_, j) => ({ header: `C${j}`, money: j % 2 === 1 })), big);
  const ms = Date.now() - t0;
  assert.ok(bytes.length < 1_500_000, `size ${bytes.length}`);
  assert.ok(ms < 5000, `took ${ms} ms`);
  assert.equal(Object.keys(unzip(bytes)).length, 6);
});

test('rate limit: per minute, per day, and the count query', () => {
  assert.equal(M.limitVerdict({ minute: 29, day: 599 }), null);
  assert.match(M.limitVerdict({ minute: 30, day: 100 }), /^Too many requests — wait a minute/);
  assert.match(M.limitVerdict({ minute: 0, day: 600 }), /^Daily limit reached/);
  assert.match(M.limitVerdict({ minute: 31, day: 600 }), /^Daily limit reached/);
  assert.equal(M.limitVerdict({ minute: 2, day: 2 }, 2, 10) !== null, true);
  assert.match(M.RATE_SQL, /status IS DISTINCT FROM 429/);
});

test('rate limit count on a real Postgres (PGlite) with the 0378 table and index', async () => {
  const fs = await import('node:fs');
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  const sql = fs.readFileSync(new URL('../../migrations-pg/0378_mcp_connector.sql', import.meta.url), 'utf8');
  // Only the call log table and its indexes are needed here.
  const table = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS mcp_calls'));
  await pg.exec(table.slice(0, table.indexOf(');') + 2).replace(/REFERENCES \w+\s*\(\w+\)( ON DELETE \w+( \w+)?)?/g, ''));
  await pg.exec('CREATE INDEX IF NOT EXISTS mcp_calls_user_idx ON mcp_calls (user_id, created_at)');
  const now = Date.parse('2026-11-26T04:00:00Z');
  const at = ms => new Date(now - ms).toISOString();
  let n = 0;
  const add = (user, ms, status) => pg.query(`INSERT INTO mcp_calls (id, token_id, user_id, client_id, tool, target, status, ok, note, ms, created_at) VALUES ($1, 't', $2, 'c', 'erp_get', '', $3, 1, '', 1, $4)`, [`k${n++}`, user, status, at(ms)]);
  await add('u1', 10_000, 200); await add('u1', 30_000, 200); await add('u1', 59_000, 400);
  await add('u1', 120_000, 200); await add('u1', 23 * 3600_000, 200); await add('u1', 25 * 3600_000, 200);
  await add('u1', 5_000, 429); // a refused-for-limit call is not counted
  await add('u2', 1_000, 200);
  const q = M.RATE_SQL.replace(/\?/g, (() => { let i = 0; return () => `$${++i}`; })());
  const r = (await pg.query(q, [at(60_000), 'u1', at(24 * 3600_000)])).rows[0];
  assert.deepEqual({ minute: Number(r.minute), day: Number(r.day) }, { minute: 3, day: 5 });
  // The door's version: both counts as scalar subqueries in one statement (mcpStore resolveAccessToken withCounts).
  const door = (await pg.query(`SELECT (${M.RATE_COUNT_SQL("'u1'").replace('?', '$1')}) AS minute, (${M.RATE_COUNT_SQL("'u1'").replace('?', '$2')}) AS day`, [at(60_000), at(24 * 3600_000)])).rows[0];
  assert.deepEqual({ minute: Number(door.minute), day: Number(door.day) }, { minute: 3, day: 5 });
  await pg.close();
});
