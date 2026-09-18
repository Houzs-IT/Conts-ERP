import { type Env, one, all, json, fail } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

/**
 * GET /api/owner/portal            the signed-in owner's own portal
 * GET /api/owner/portal?ownerId=…  finance and management viewing as an owner
 *
 * One request for the whole page. Every query below is filtered by the owner id
 * resolved here, which is the only boundary between one owner's money and another's.
 */
const VISIBLE = `('finalised','sent','paid')`; // provisional figures are never shown to owners
const BOOKED = `r.state IN ('confirmed','checked_in','checked_out') AND r.channel NOT IN ('maintenance_block','owner_stay')`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const asOwner = new URL(request.url).searchParams.get('ownerId');
  let owner: any;
  if (session.role === 'owner') {
    owner = await one(env, 'SELECT id, display_name, bank_name, bank_account_last4 FROM owners WHERE user_id = ?', session.userId);
    if (!owner) return fail('NOT_LINKED', 'Your account is not linked to a property yet. Contact The Conts.', 404);
  } else if (canSeeFinance(session.role) && asOwner) {
    owner = await one(env, 'SELECT id, display_name, bank_name, bank_account_last4 FROM owners WHERE id = ?', asOwner);
    if (!owner) return fail('NOT_FOUND', 'That owner no longer exists.', 404);
  } else {
    return fail('FORBIDDEN', 'The owner portal is for owners, or finance and management viewing as one.', 403);
  }
  const ownerId: string = owner.id;

  const units = await all<any>(env, `
    SELECT u.id, u.unit_number, p.name AS property_name
    FROM units u JOIN properties p ON p.id = u.property_id
    WHERE u.owner_id = ? ORDER BY p.name, u.unit_number`, ownerId);

  const statements = await all<any>(env, `
    SELECT id, period_start, period_end, state, gross_booking_value, management_fee,
           expenses_total, adjustments_total, net_payout, finalised_at, sent_at
    FROM owner_statements
    WHERE owner_id = ? AND state IN ${VISIBLE}
    ORDER BY period_start DESC LIMIT 12`, ownerId);
  const latest = statements[0] ?? null;

  let lines: { label: string; amount: number }[] = [];
  let payout: any = null;
  if (latest) {
    const contract = await one<any>(env, `
      SELECT management_fee_pct FROM owner_contracts
      WHERE owner_id = ? AND starts_on <= ? ORDER BY starts_on DESC LIMIT 1`, ownerId, latest.period_end);
    const byCategory = await all<any>(env, `
      SELECT category, SUM(amount) AS amount FROM statement_lines
      WHERE statement_id = ? AND line_type = 'expense'
      GROUP BY category ORDER BY SUM(amount)`, latest.id);
    const fee = contract ? `Management fee ${Number(contract.management_fee_pct)}%` : 'Management fee';
    lines = [
      { label: 'Gross booking value', amount: latest.gross_booking_value },
      { label: fee, amount: -Math.abs(latest.management_fee) },
      ...(byCategory.length
        ? byCategory.map(c => ({ label: label(c.category), amount: -Math.abs(c.amount) }))
        : latest.expenses_total ? [{ label: 'Expenses', amount: -Math.abs(latest.expenses_total) }] : []),
      ...(latest.adjustments_total ? [{ label: 'Adjustments', amount: latest.adjustments_total }] : []),
    ];
    payout = await one(env, `
      SELECT state, amount, paid_at, bank_last4 FROM payouts
      WHERE statement_id = ? AND owner_id = ? ORDER BY created_at DESC LIMIT 1`, latest.id, ownerId);
  }

  // Performance for the statement month, or this month before the first statement.
  const periodStart = latest?.period_start ?? new Date().toISOString().slice(0, 7) + '-01';
  const periodEnd = latest?.period_end ?? await monthEnd(env, periodStart);
  const perf = await one<any>(env, `
    SELECT COUNT(*) AS bookings, COUNT(DISTINCT r.channel) AS channels,
           COALESCE(SUM(julianday(r.check_out) - julianday(r.check_in)), 0) AS nights,
           COALESCE(SUM(r.collected_revenue), 0) AS revenue,
           CAST(julianday(?) - julianday(?) + 1 AS INTEGER) AS days
    FROM reservations r JOIN units u ON u.id = r.unit_id
    WHERE u.owner_id = ? AND ${BOOKED} AND r.check_in BETWEEN ? AND ?`,
    periodEnd, periodStart, ownerId, periodStart, periodEnd);
  const available = units.length * (perf?.days ?? 30);
  const nights = Math.round(perf?.nights ?? 0);

  const reviews = await one<any>(env, `
    SELECT ROUND(AVG(v.rating), 2) AS rating, COUNT(*) AS n
    FROM reviews v JOIN units u ON u.id = v.unit_id
    WHERE u.owner_id = ? AND v.reviewed_at >= date('now', '-12 months')`, ownerId);

  const issues = await all<any>(env, `
    SELECT m.id, m.title, m.detail, m.state, m.vendor_name, m.quoted_amount, m.final_amount,
           m.charge_to, m.reported_at, m.resolved_at, u.unit_number, p.name AS property_name,
           (m.owner_approval_required = 1 AND m.owner_approved_at IS NULL AND m.state <> 'resolved') AS needs_approval
    FROM maintenance_issues m
    JOIN units u ON u.id = m.unit_id JOIN properties p ON p.id = u.property_id
    WHERE u.owner_id = ?
    ORDER BY needs_approval DESC, m.reported_at DESC LIMIT 10`, ownerId);

  return json({
    generatedAt: new Date().toISOString(),
    owner: { id: ownerId, displayName: owner.display_name },
    units: units.map(u => ({ id: u.id, unitNumber: u.unit_number, propertyName: u.property_name })),
    statement: latest && {
      id: latest.id, periodStart: latest.period_start, periodEnd: latest.period_end, state: latest.state,
      netPayout: latest.net_payout, finalisedAt: latest.finalised_at, lines,
    },
    payout: payout && {
      state: payout.state, amount: payout.amount, paidAt: payout.paid_at,
      bankName: owner.bank_name, bankLast4: payout.bank_last4 ?? owner.bank_account_last4,
    },
    stats: {
      periodStart, periodEnd,
      occupancy: available ? Math.round((nights / available) * 1000) / 10 : 0,
      nightsBooked: nights, nightsAvailable: available,
      adr: nights ? Math.round((perf?.revenue ?? 0) / nights) : 0,
      bookings: perf?.bookings ?? 0, channels: perf?.channels ?? 0,
      rating: reviews?.n ? reviews.rating : null, reviews: reviews?.n ?? 0,
    },
    earnings: statements.slice(0, 8).reverse().map(s => ({ periodStart: s.period_start, netPayout: s.net_payout })),
    issues: issues.map(i => ({
      id: i.id, title: i.title, detail: i.detail, state: i.state, vendorName: i.vendor_name,
      quotedAmount: i.quoted_amount, finalAmount: i.final_amount, chargeTo: i.charge_to,
      reportedAt: i.reported_at, resolvedAt: i.resolved_at, needsApproval: !!i.needs_approval,
      unitNumber: i.unit_number, propertyName: i.property_name,
    })),
  });
};

const LABELS: Record<string, string> = {
  housekeeping: 'Housekeeping', maintenance: 'Maintenance', utilities: 'Utilities',
  consumables: 'Consumables', furniture: 'Furniture', channel_fee: 'Channel fees', other: 'Other',
};
const label = (c: string | null) => (c && LABELS[c]) || 'Other';

async function monthEnd(env: Env, start: string) {
  const r = await one<{ d: string }>(env, `SELECT date(?, '+1 month', '-1 day') AS d`, start);
  return r?.d ?? start;
}
