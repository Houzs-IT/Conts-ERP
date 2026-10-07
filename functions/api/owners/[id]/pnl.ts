import { type Env, all, one, json, fail, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { daysIn, todayMyt } from '../../../_lib/ops';

const CATEGORY_LABEL: Record<string, string> = {
  housekeeping: 'Housekeeping', cleaning: 'Cleaning', maintenance: 'Maintenance', utilities: 'Utilities',
  internet: 'Internet', electricity: 'Electricity', water: 'Water', consumables: 'Consumables',
  furniture: 'Furniture', management_fee: 'Management fee', channel_fee: 'Channel fees', other: 'Other',
};
const label = (c: string) => CATEGORY_LABEL[c] ?? c.replace(/_/g, ' ').replace(/^./, x => x.toUpperCase());

/**
 * GET /api/owners/:id/pnl?month=YYYY-MM — per-unit profit and loss for one of an
 * owner's units, for the given month (defaults to the current month). Owner-scoped
 * aggregation that REUSES the same gross-to-net chain as GET /api/units/detail:
 * gross booking value → management fee (on collected revenue) → owner-charged
 * expenses by category → net. GRR units pay the guaranteed rent and carry no
 * owner expenses.
 *
 * The management fee falls back unit contract → owner default → 25%, and each
 * unit reports which level its fee came from so the UI can show it. Finance and
 * management only — the same access gate as the unit P&L.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Owner financials are visible to finance and management roles.', 403);

  const ownerId = String(params.id);
  const url = new URL(request.url);
  const month = (url.searchParams.get('month') ?? todayMyt().slice(0, 7)).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return fail('VALIDATION', 'A month like 2026-08 is required.', 422);
  const days = daysIn(month);

  const owner = await one<{ id: string; default_management_fee_pct: number | null }>(env,
    'SELECT id, default_management_fee_pct FROM owners WHERE id = ?', ownerId);
  if (!owner) return fail('NOT_FOUND', 'That owner no longer exists.', 404);
  const ownerDefault = owner.default_management_fee_pct != null ? Number(owner.default_management_fee_pct) : null;

  const units = await all<any>(env, `
    SELECT u.id, u.unit_number, p.name AS property_name,
           c.model, c.management_fee_pct, c.grr_amount
    FROM units u JOIN properties p ON p.id = u.property_id
    LEFT JOIN owner_contracts c ON c.id = u.contract_id
    WHERE u.owner_id = ? ORDER BY p.name, u.unit_number`, ownerId);

  if (units.length === 0) return json({ month, generatedAt: nowIso(), defaultManagementFeePct: ownerDefault, units: [] });

  const ids = units.map(u => u.id);
  const inClause = ids.map(() => '?').join(',');

  const perf = await all<any>(env, `
    SELECT unit_id,
           COALESCE(SUM(check_out::date - check_in::date), 0) AS nights,
           COALESCE(SUM(collected_revenue), 0) AS revenue,
           COALESCE(SUM(gross_booking_value), 0) AS gross
    FROM reservations
    WHERE unit_id IN (${inClause}) AND state IN ('confirmed','checked_in','checked_out')
      AND channel NOT IN ('maintenance_block','owner_stay') AND substr(check_in, 1, 7) = ?
    GROUP BY unit_id`, ...ids, month);
  const perfBy = new Map<string, any>(perf.map(r => [r.unit_id, r]));

  const exp = await all<any>(env, `
    SELECT unit_id, category, SUM(amount) AS total
    FROM expenses
    WHERE unit_id IN (${inClause}) AND charge_to = 'owner' AND substr(incurred_on, 1, 7) = ?
    GROUP BY unit_id, category
    ORDER BY category`, ...ids, month);
  const expBy = new Map<string, any[]>();
  for (const e of exp) { const l = expBy.get(e.unit_id) ?? []; l.push(e); expBy.set(e.unit_id, l); }

  const out = units.map(u => {
    const pf = perfBy.get(u.id) ?? { nights: 0, revenue: 0, gross: 0 };
    const nights = Number(pf.nights), revenue = Number(pf.revenue), gross = Number(pf.gross);
    const isGrr = (u.model ?? 'management') === 'grr';

    // Fee resolution: unit contract → owner default → 25%.
    const unitPct = u.management_fee_pct != null ? Number(u.management_fee_pct) : null;
    const feePct = isGrr ? null : (unitPct ?? ownerDefault ?? 25);
    const feeSource: 'unit' | 'owner-default' | 'fallback' =
      unitPct != null ? 'unit' : ownerDefault != null ? 'owner-default' : 'fallback';

    const rows = expBy.get(u.id) ?? [];
    const expensesList = isGrr ? [] : rows.map(r => ({
      label: label(r.category), category: r.category, amount: -Number(r.total),
    }));
    const expensesTotal = expensesList.reduce((s, e) => s + Math.abs(e.amount), 0);
    const fee = isGrr ? 0 : Math.round(revenue * ((feePct ?? 0) / 100));
    const grrAmount = isGrr ? Number(u.grr_amount ?? 0) : null;
    const net = isGrr ? (grrAmount ?? 0) : revenue - fee - expensesTotal;

    const pnl = isGrr
      ? [
          { label: 'Gross booking value', amount: gross, type: 'gross' },
          { label: 'Guaranteed rent', amount: net, type: 'net' },
        ]
      : [
          { label: 'Gross booking value', amount: gross, type: 'gross' },
          { label: `Management fee · ${feePct}%`, amount: -fee, type: 'fee' },
          ...expensesList.map(e => ({ label: e.label, amount: e.amount, type: 'expense' })),
          { label: 'Net payout', amount: net, type: 'net' },
        ];

    return {
      unitId: u.id, unitLabel: `${u.property_name} ${u.unit_number}`,
      model: isGrr ? 'grr' : 'management', feePct, grrAmount, feeSource,
      occupancy: Math.min(100, Math.round((nights / days) * 100)),
      adr: nights ? Math.round(revenue / nights) : 0,
      gross, revenue, expensesTotal, net, pnl, expenses: expensesList,
    };
  });

  return json({ month, generatedAt: nowIso(), defaultManagementFeePct: ownerDefault, units: out });
};
