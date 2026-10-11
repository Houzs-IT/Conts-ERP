import { type Env, all, one, json } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { ownerFor, VISIBLE } from '../../_lib/ownerScope';
import { daysIn, todayMyt } from '../../_lib/ops';
import { TERMS, summaryRows, type SummaryRow } from '../../../src/lib/statementTerms';

/** GET /api/owner/summary?period=YYYY-MM — the gross-to-net for one finalised statement (the latest by default), payout and month stats. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const owner = await ownerFor(env, session, url);
  if (owner instanceof Response) return owner;

  const units = await all<any>(env, `
    SELECT u.id, u.unit_number, p.name AS property_name FROM units u JOIN properties p ON p.id = u.property_id
    WHERE u.owner_id = ? ORDER BY p.name, u.unit_number`, owner.id);
  const label = (u: any) => `${u.property_name} ${u.unit_number}`;

  const asked = url.searchParams.get('period');
  const st = await one<any>(env, `
    SELECT * FROM owner_statements WHERE owner_id = ? AND state IN ${VISIBLE} ${asked && /^\d{4}-\d{2}$/.test(asked) ? 'AND substr(period_start, 1, 7) = ?' : ''}
    ORDER BY period_start DESC LIMIT 1`, ...(asked && /^\d{4}-\d{2}$/.test(asked) ? [owner.id, asked] : [owner.id]));

  const period = st ? String(st.period_start).slice(0, 7) : (asked ?? todayMyt().slice(0, 7));
  const start = `${period}-01`, end = `${period}-${String(daysIn(period)).padStart(2, '0')}`;

  // In the owner's report words (statementTerms.ts): never the unit, the import's tags or internal categories.
  let grossToNet: SummaryRow[] = [];
  if (st) {
    const lines = await all<any>(env, 'SELECT line_type, category, description, amount FROM statement_lines WHERE statement_id = ? ORDER BY sort_order', st.id);
    grossToNet = lines.length ? summaryRows(lines, Number(st.net_payout)) : [
      { label: TERMS.grossIncome, amount: Number(st.gross_booking_value), type: 'gross' },
      ...(Number(st.expenses_total) ? [{ label: TERMS.totalDeduction, amount: -Math.abs(Number(st.expenses_total)), type: 'expense' as const }] : []),
      { label: TERMS.toOperator, amount: -Math.abs(Number(st.management_fee)), type: 'fee' },
      { label: TERMS.netPayout, amount: Number(st.net_payout), type: 'net' },
    ];
  }

  const payout = st ? await one<any>(env, 'SELECT state, amount, paid_at, bank_last4 FROM payouts WHERE statement_id = ? AND owner_id = ? ORDER BY created_at DESC LIMIT 1', st.id, owner.id) : null;

  const perf = await one<any>(env, `
    SELECT COUNT(*) AS bookings, COALESCE(SUM(r.check_out::date - r.check_in::date), 0) AS nights, COALESCE(SUM(r.collected_revenue), 0) AS revenue
    FROM reservations r JOIN units u ON u.id = r.unit_id
    WHERE u.owner_id = ? AND r.state IN ('confirmed','checked_in','checked_out') AND r.channel NOT IN ('maintenance_block','owner_stay') AND r.check_in BETWEEN ? AND ?`, owner.id, start, end);
  const reviews = await one<any>(env, `
    SELECT ROUND(AVG(v.rating)::numeric, 2) AS rating, COUNT(*) AS n FROM reviews v JOIN units u ON u.id = v.unit_id
    WHERE u.owner_id = ? AND v.reviewed_at >= to_char(now() - interval '12 months', 'YYYY-MM-DD')`, owner.id);
  const nights = Number(perf?.nights ?? 0), available = units.length * daysIn(period);

  return json({
    generatedAt: new Date().toISOString(), period, isFinal: !!st, statementId: st?.id ?? '',
    unitsLabel: units.length === 1 ? label(units[0]) : `${units.length} units`,
    units: units.map(u => ({ id: u.id, label: label(u) })),
    payout: {
      amount: Number(payout?.amount ?? st?.net_payout ?? 0), state: payout?.state ?? 'pending',
      paidAt: payout?.paid_at ?? null, scheduledFor: null,
      bankName: owner.bank_name, bankLast4: payout?.bank_last4 ?? owner.bank_account_last4,
    },
    grossToNet,
    stats: {
      occupancy: available ? Math.round((nights / available) * 1000) / 10 : 0,
      adr: nights ? Math.round(Number(perf?.revenue ?? 0) / nights) : 0,
      bookings: Number(perf?.bookings ?? 0),
      rating: Number(reviews?.n) ? Number(reviews.rating) : null, reviews: Number(reviews?.n ?? 0),
    },
  });
};
