import { type Env, one, all, json, fail } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { ownerFor, VISIBLE } from '../../../../_lib/ownerScope';
import { TERMS, lineTerm, lineDetail, isSourceReference } from '../../../../../src/lib/statementTerms';

interface DetailLine { label: string; detail?: string; amount: number; type: string; category?: string; reference?: string; occurredOn?: string; items?: { label: string; amount: number; reference?: string }[] }
interface UnitBreak { id: string; label: string; gross: number; fee: number; expenses: number; adjustments: number; net: number; lines: DetailLine[] }

/** GET /api/owner/statements/:id — one statement drilled to per-unit, per-line detail.
 *  Owner-scoped: an owner sees only their own, and never a provisional one (figures can still move).
 *  The stored totals are the source of truth; the single management-fee line (and any owner-level
 *  adjustment) is allocated across units in proportion to each unit's gross, with the rounding
 *  remainder pushed onto the largest unit so the per-unit nets sum to the statement net exactly. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const owner = await ownerFor(env, session, url);
  if (owner instanceof Response) return owner;

  const st = await one<any>(env, `SELECT * FROM owner_statements WHERE id = ? AND owner_id = ? AND state IN ${VISIBLE}`, String(params.id), owner.id);
  if (!st) return fail('NOT_FOUND', 'That statement is not available.', 404);

  const lines = await all<any>(env, `
    SELECT l.line_type, l.category, l.description, l.amount, l.reference, l.occurred_on, l.unit_id,
           u.unit_number, p.name AS property_name
    FROM statement_lines l
    LEFT JOIN units u ON u.id = l.unit_id
    LEFT JOIN properties p ON p.id = u.property_id
    WHERE l.statement_id = ? ORDER BY l.sort_order, l.occurred_on`, st.id);

  const unitLabel = (l: any) => l.property_name ? `${l.property_name} ${l.unit_number}` : 'Unassigned';
  // The report's term for the line, and under it what it was (the stay, the expense), with ISO dates made readable:
  // "Hospitality Income" over "Tan · 31 Aug - 3 Sep (2 nights in Sep)".
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const named = (l: any) => {
    const detail = lineDetail({ ...l, unitLabel: unitLabel(l) })
      ?.replace(/(\d{4})-(\d{2})-(\d{2}) to (\d{4})-(\d{2})-(\d{2})/, (_m, _y1, m1, d1, _y2, m2, d2) => `${Number(d1)} ${MON[Number(m1) - 1]} - ${Number(d2)} ${MON[Number(m2) - 1]}`)
      .replace(/ in (\d{4})-(\d{2})\)/, (_m, _y, mo) => ` in ${MON[Number(mo) - 1]})`);
    return { label: lineTerm(l), ...(detail ? { detail } : {}), ...(l.reference && !isSourceReference(l.reference) ? { reference: l.reference } : {}) };
  };

  // Bucket every line that carries a unit; the fee and owner-level adjustments are allocated after.
  const buckets = new Map<string, UnitBreak>();
  const bucket = (uid: string | null, label: string): UnitBreak => {
    const key = uid ?? '_owner';
    let u = buckets.get(key);
    if (!u) { u = { id: key, label, gross: 0, fee: 0, expenses: 0, adjustments: 0, net: 0, lines: [] }; buckets.set(key, u); }
    return u;
  };

  let ownerFee = 0, ownerAdj = 0;
  for (const l of lines) {
    const amt = Number(l.amount);
    if (l.line_type === 'gross') {
      const u = bucket(l.unit_id, unitLabel(l));
      u.gross += amt;
      u.lines.push({ ...named(l), amount: amt, type: 'gross', occurredOn: l.occurred_on });
    } else if (l.line_type === 'expense') {
      const u = bucket(l.unit_id, unitLabel(l));
      u.expenses += Math.abs(amt);
      u.lines.push({ ...named(l), amount: -Math.abs(amt), type: 'expense', category: l.category ?? 'other', occurredOn: l.occurred_on });
    } else if (l.line_type === 'management_fee') {
      if (l.unit_id) { const u = bucket(l.unit_id, unitLabel(l)); u.fee += Math.abs(amt); u.lines.push({ label: lineTerm(l), amount: -Math.abs(amt), type: 'fee' }); }
      else ownerFee += Math.abs(amt);
    } else if (l.line_type === 'adjustment') {
      if (l.unit_id) { const u = bucket(l.unit_id, unitLabel(l)); u.adjustments += amt; u.lines.push({ label: lineTerm(l), amount: amt, type: 'adjustment' }); }
      else ownerAdj += amt;
    }
  }

  const units = [...buckets.values()].filter(u => u.id !== '_owner' || u.gross || u.expenses);
  const grossTotal = units.reduce((n, u) => n + u.gross, 0);

  // Largest-remainder allocation of an owner-level pool across units by gross share.
  const allocate = (pool: number, assign: (u: UnitBreak, share: number) => void) => {
    if (!pool || units.length === 0) return;
    if (grossTotal === 0) { assign(units[0], pool); return; }
    const raw = units.map(u => (pool * u.gross) / grossTotal);
    const floor = raw.map(v => (v < 0 ? Math.ceil(v) : Math.floor(v)));
    let remainder = pool - floor.reduce((n, v) => n + v, 0);
    const order = raw.map((v, i) => ({ i, frac: Math.abs(v - floor[i]) })).sort((a, b) => b.frac - a.frac);
    const shares = [...floor];
    const step = remainder >= 0 ? 1 : -1;
    for (let k = 0; k < Math.abs(remainder); k++) shares[order[k % order.length].i] += step;
    units.forEach((u, i) => assign(u, shares[i]));
  };
  allocate(ownerFee, (u, s) => { if (s) { u.fee += s; u.lines.push({ label: TERMS.toOperator, amount: -s, type: 'fee' }); } });
  allocate(ownerAdj, (u, s) => { if (s) { u.adjustments += s; u.lines.push({ label: 'Adjustment', amount: s, type: 'adjustment' }); } });

  for (const u of units) u.net = u.gross - u.fee - u.expenses + u.adjustments;

  // One row per report term (a unit's ten stays are one Hospitality Income), each with what is behind it.
  for (const u of units) {
    const rows: DetailLine[] = [];
    for (const l of u.lines) {
      const same = l.type !== 'adjustment' && rows.find(r => r.type === l.type && r.label === l.label);
      const item = { label: l.detail ?? l.label, amount: l.amount, ...(l.reference ? { reference: l.reference } : {}) };
      if (same) { same.amount += l.amount; same.items!.push(item); }
      else rows.push({ label: l.label, amount: l.amount, type: l.type, ...(l.category ? { category: l.category } : {}), items: [item] });
    }
    // Items only where they say more than the row itself.
    for (const r of rows) if (!r.items!.some(i => i.label !== r.label || i.reference)) delete r.items;
    u.lines = rows;
  }

  const unitsList = await all<any>(env, `
    SELECT u.id, u.unit_number, p.name AS property_name FROM units u JOIN properties p ON p.id = u.property_id
    WHERE u.owner_id = ? ORDER BY p.name, u.unit_number`, owner.id);

  return json({
    id: st.id,
    period: String(st.period_start).slice(0, 7),
    isFinal: st.state !== 'provisional',
    state: st.state,
    unitsLabel: unitsList.length === 1 ? `${unitsList[0].property_name} ${unitsList[0].unit_number}` : `${unitsList.length} units`,
    grossBookingValue: Number(st.gross_booking_value),
    managementFee: Number(st.management_fee),
    expensesTotal: Number(st.expenses_total),
    adjustmentsTotal: Number(st.adjustments_total),
    netPayout: Number(st.net_payout),
    units: units.map(u => ({ id: u.id, label: u.label, gross: u.gross, fee: u.fee, expenses: u.expenses, adjustments: u.adjustments, net: u.net, lines: u.lines })),
  });
};
