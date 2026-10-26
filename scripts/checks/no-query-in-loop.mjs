// A database call inside a loop runs once per item, one after another: the N+1 that made Houzs's backfill die
// with "Worker exceeded resource limits" and, here, made a year of weekend prices for 10 units take 6,300
// queries (two minutes) and a 500-row booking import 4,000 (70 seconds). Each query is its own connection.
// Read the set once, write it with one INSERT ... SELECT FROM jsonb_to_recordset(...), or cap the rows per
// request. A loop that is short by construction is allow-listed below, with why.
import { runCheck, runIfMain, walk, stripComments } from './_lib.mjs';

const CALL = /\bawait\s+(?:all|one|run|audit|notify|db\.all|db\.run|tx\.unsafe)\s*[<(]/g;

/** Line numbers of DB calls inside the body of a for/while loop. */
export function queriesInLoops(text) {
  const code = stripComments(text);
  const hits = [];
  const loop = /\b(?:for|while)\s*\(/g;
  let m;
  while ((m = loop.exec(code))) {
    let depth = 0, j = m.index + m[0].length - 1;
    for (; j < code.length; j++) { if (code[j] === '(') depth++; else if (code[j] === ')' && --depth === 0) break; }
    let k = j + 1;
    while (/\s/.test(code[k] ?? '')) k++;
    let end;
    if (code[k] === '{') { let d = 0; for (end = k; end < code.length; end++) { if (code[end] === '{') d++; else if (code[end] === '}' && --d === 0) break; } }
    else end = code.indexOf(';', k);
    const body = code.slice(k, end);
    for (const c of body.matchAll(CALL)) {
      const line = code.slice(0, k + c.index).split('\n').length;
      if (!hits.some(h => h.line === line)) hits.push({ line, msg: 'database call inside a loop (one query per item)', text: code.split('\n')[line - 1].trim().slice(0, 140) });
    }
  }
  return hits;
}

const BOUNDED = 'Loop is short by construction';
export const allow = {
  // Short by construction.
  'functions/api/housekeeping/rules.ts': `${BOUNDED}: a handful of fixed setting keys.`,
  'functions/api/settings/index.ts': `${BOUNDED}: the setting keys of one form.`,
  'functions/api/users/access.ts': `${BOUNDED}: the access changes of one person.`,
  'functions/api/users/[id]/access.ts': `${BOUNDED}: the access changes of one person.`,
  'functions/api/users/org-chart.ts': `${BOUNDED}: the managers of one team.`,
  'functions/_lib/bookingLifecycle.ts': `${BOUNDED}: the cleaning tasks of one booking.`,
  'functions/_lib/channexSync.ts': `${BOUNDED}: at most three booking sites per unit.`,
  'functions/_lib/repairBlocks.ts': `${BOUNDED}: the calendar blocks of one repair job.`,
  'functions/_lib/twoFactor.ts': `${BOUNDED}: ten backup codes.`,
  'functions/_lib/payroll.ts': `${BOUNDED}: one payslip per in-house cleaner or technician (tens of people), run by hand once a month.`,
  'functions/_lib/properties.ts': `${BOUNDED}: the monthly cost lines typed on one unit form.`,
  'functions/_lib/history.ts': 'Writes in parts of 1,000 rows per INSERT; the loop is over parts, not rows.',
  'functions/api/statements/generate.ts': 'Writes statement lines in parts of 2,000 rows per INSERT; the loop is over parts.',
  'functions/api/rates/bulk.ts': 'One INSERT per unit and date range (at most 20 ranges), then one queue insert per unit (channexQueue.enqueueRestrictionsMany).',
  'functions/api/reservations/import.ts': 'At most 100 rows per request (the screen sends 50); each row must be checked against the bookings before it.',
  // Background work: the cron worker and the queue flush, not a person waiting on a request.
  'functions/_lib/channexQueue.ts': 'Queue flush: one Channex call per property and kind, at most 10 per minute each (their rate limit).',
  'functions/_lib/channexMessageSync.ts': 'Cron sync of one page of Channex threads and reviews.',
  'functions/_lib/cronJobs.ts': 'Cron worker: retries due messages and runs each job; not on a request.',
  'functions/_lib/notify.ts': 'Email copies of one in-app notice, one per staff member it went to (a team, not a customer list); the notices themselves are one INSERT.',
  'functions/api/statements/send.ts': 'One email per owner (notify: its log row, the send, the result); every database write before it is batched. Open in TODO.md: a month of about 100 emails is more than the free plan 50 outside calls per request.',
};

const SUPPLY_CHAIN = /functions\/(api\/(consignment-notes|customers|delivery-orders|delivery-schedule|delivery-zones|driver-leave|drivers|fabrics|fleet-health|coverage-fleet|goods-receipts|loading-list|mrp|payment-vouchers|product-models|products|purchase-consignment|purchase-invoices|purchase-orders|purchase-returns|racks|rate-cards|sales-invoices|sales-orders|sales-returns|so-amendments|stock|stock-takes|stock-transfers|suppliers|threepl-companies|unbilled-deliveries|vehicles|warehouses|credit-notes|accounting|residence-rules)\/|_lib\/(consignment-notes|credit-notes|customers|delivery-|driver-leave|fabric|fleet-maintenance|goods-receipts|payment-vouchers|product|purchase-|racks|rate-card|residence-rules|sales-|scm-util|so-amendments|stock|suppliers|threepl|transport|warehouses)[^/]*$)/;

export const def = {
  name: 'no-query-in-loop',
  rule: 'no database call inside a loop in functions/ (rental side); batch it, or allow-list a short loop with why',
  files: () => walk('functions').filter(f => !SUPPLY_CHAIN.test(f)),
  allow,
  scan: (text) => queriesInLoops(text),
  selfTest: {
    bad: [{ path: 'functions/api/x.ts', text: "export const onRequestPost = async ({ env }) => {\n  for (const id of ids) {\n    await run(env, 'UPDATE t SET a = 1 WHERE id = ?', id);\n  }\n};\n" }],
    good: [{ path: 'functions/api/x.ts', text: "export const onRequestPost = async ({ env }) => {\n  // for (const id of ids) await run(env, 'x');\n  const rows = ids.map(id => ({ id }));\n  await run(env, 'UPDATE t SET a = 1 FROM jsonb_to_recordset(?::text::jsonb) x(id text) WHERE t.id = x.id', JSON.stringify(rows));\n};\n" }],
  },
};

runIfMain(import.meta.url, def);
