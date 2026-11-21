// Conts only (ported from Houzs scm/routes/accounting-aging.ts on 21 Nov 2026): GET /accounting/ar-aging and
// GET /accounting/ap-aging — the formal debtor and creditor aging, built from the control accounts' own lines so it
// always ties to the general ledger. The rules are acc/aging.ts; the reading is conts/aging-load.ts; this is the door.
// Mounted in scm/routes/accounting.ts on the two paths the old view-backed aging used, so the Ledger guard stands in
// front and the Reports › AR aging / AP aging entries open it unchanged.
//
// Query (every part optional):
//   asOf        YYYY-MM-DD, the day the aging is as at (default today, Malaysia)
//   basis       invoice | due — age by the bill's date (default) or its due date (a bill with none ages by its date)
//   buckets     month | day — This month · 1 · 2 · 3 · 4 months + (default), or 0–30 · 31–60 · 61–90 · 91–120 · 120+
//   control     all | trade | other | an account code — every customer (SDC) or supplier (SCC) control, the trade
//               controls (all but Other Debtors / Other Creditors), the Other one alone, or one control
//   department  rental | supply | shared — that department's lines only (a line names one, as on the trial balance)
// Answer: { asOf, basis, buckets, control, department, accounts, rows, totals, controls, differenceSen, outside,
//           opening }. Each row is a debtor or creditor: its balance, its open bills in the five columns, its 未冲,
// and both lists. `controls` are the control accounts' balances as at the date and `differenceSen` what the rows miss
// of them — zero, by construction. `opening` says how much of the OPENING journal the opening documents explain.
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { todayMyt } from '../scm/lib/my-time';
import { BAD_DEPARTMENT, departmentQuery, type Department } from '../acc/rules';
import { ageEntries, agingTotals, type AgingBasis, type AgingBuckets } from '../acc/aging';
import { agingControls, loadApAging, loadArAging, type AgingLoad, type AgingSide } from './aging-load';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context, untyped as in the routes it sits beside */
type Ctx = any;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Query = { asOf: string; basis: AgingBasis; buckets: AgingBuckets; control: string; department: Department | null };

function readQuery(c: Ctx): Query | { error: string; message: string } {
  const asOfQ = String(c.req.query('asOf') ?? '').trim();
  if (asOfQ && !DAY.test(asOfQ)) return { error: 'bad_date', message: 'The date must be YYYY-MM-DD.' };
  const department = departmentQuery(c.req.query('department'));
  if (department === false) return BAD_DEPARTMENT;
  return {
    asOf: asOfQ || todayMyt(),
    basis: c.req.query('basis') === 'due' ? 'due' : 'invoice',
    buckets: c.req.query('buckets') === 'day' ? 'day' : 'month',
    control: String(c.req.query('control') ?? '').trim() || 'all',
    department,
  };
}

async function agingHandler(c: Ctx, side: AgingSide): Promise<Response> {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const q = readQuery(c);
  if ('error' in q) return c.json(q, 400);
  const sb = c.get('supabase');

  const ctl = await agingControls(sb, co.companyId, side);
  if (!ctl.ok) return c.json({ error: 'load_failed', reason: ctl.reason }, 500);
  const all = ctl.accounts;
  const picked = q.control === 'all' ? all
    : q.control === 'trade' ? all.filter((a) => !a.other)
      : q.control === 'other' ? all.filter((a) => a.other)
        : all.filter((a) => a.code === q.control);
  if (picked.length === 0 && q.control !== 'other' && q.control !== 'trade') {
    return c.json({ error: 'bad_control', message: `${q.control} is not a ${side === 'AR' ? 'customer' : 'supplier'} control of the chart.` }, 400);
  }
  const codes = picked.map((a) => a.code);

  const loaded: AgingLoad = side === 'AR'
    ? await loadArAging(sb, co.companyId, codes, q.asOf, q.department, ctl.roles)
    : await loadApAging(sb, co.companyId, codes, q.asOf, q.department, ctl.roles);
  if (!loaded.ok) return c.json({ error: 'load_failed', reason: loaded.reason }, 500);

  const rows = ageEntries(loaded.entries, { asOf: q.asOf, basis: q.basis, buckets: q.buckets });
  const totals = agingTotals(rows);
  const booksSen = loaded.controls.reduce((n, k) => n + k.balanceSen, 0);
  return c.json({
    ...q,
    accounts: all,
    rows,
    totals,
    controls: loaded.controls,
    differenceSen: totals.balanceSen - booksSen,
    outside: loaded.outside,
    opening: loaded.opening,
  });
}

export const arAgingHandler = (c: Ctx): Promise<Response> => agingHandler(c, 'AR');
export const apAgingHandler = (c: Ctx): Promise<Response> => agingHandler(c, 'AP');
