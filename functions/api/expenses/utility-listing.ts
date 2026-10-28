import { type Env, one, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { todayMyt } from '../../_lib/ops';
import { LOCKED_SQL } from '../../_lib/expenses';
import { months } from '../../../src/lib/utilityGrid';

/** GET /api/expenses/utility-listing?from=YYYY-MM&to=YYYY-MM[&building=<propertyId>][&unit=<unitId>]
 *  The utility listing (plan docs/superpowers/plans/2026-10-28-utility-listing.md): every unit, its electricity, water,
 *  internet and Indah Water bills whose bill month is in the range, each with whether its deduction month's owner
 *  statement is final, and the nights booked per unit and month (the stays the owner statement counts). Read only.
 *  Default range: the twelve months ending this month; at most 24 months. */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const shift = (m: string, by: number) => {
  const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are seen by finance and management.', 403);
  const url = new URL(request.url);
  const to = url.searchParams.get('to') || todayMyt().slice(0, 7);
  const from = url.searchParams.get('from') || shift(to, -11);
  if (!MONTH.test(from) || !MONTH.test(to)) return fail('VALIDATION', 'Months must look like 2026-09.', 422);
  if (from > to) return fail('VALIDATION', 'The first month must come before the last.', 422);
  const list = months(from, to);
  if (list.length > 24) return fail('VALIDATION', 'Choose up to 24 months.', 422);
  const building = url.searchParams.get('building'), unit = url.searchParams.get('unit');
  const scope = `${building ? 'AND u.property_id = $4' : ''} ${unit ? `AND u.id = $${building ? 5 : 4}` : ''}`;
  const start = `${from}-01`, endEx = `${shift(to, 1)}-01`;

  // Units: every whole unit, and any other unit (a room of a split flat) that has a utility bill in the range.
  const row = await one<{ units: any[] | null; bills: any[] | null; nights: any[] | null }>(env, `
    WITH b AS (
      SELECT e.id, e.unit_id, e.category, e.incurred_on, e.deduct_month, e.amount, e.charge_to, e.record_only, e.rolled,
             e.receipt_document_id, e.reference, ${LOCKED_SQL} AS final
      FROM expenses e JOIN units u ON u.id = e.unit_id
      WHERE e.category IN ('electricity','water','internet','sewerage') AND e.incurred_on >= $1 AND e.incurred_on < $2 ${scope}),
    su AS (
      SELECT u.id, u.property_id, p.name AS property, u.unit_number, o.display_name AS owner
      FROM units u JOIN properties p ON p.id = u.property_id LEFT JOIN owners o ON o.id = u.owner_id
      WHERE (u.parent_unit_id IS NULL OR u.id IN (SELECT unit_id FROM b)) ${scope}),
    m AS (SELECT x AS month, (x || '-01')::date AS s, ((x || '-01')::date + interval '1 month')::date AS e FROM jsonb_array_elements_text($3::text::jsonb) x),
    n AS (
      SELECT r.unit_id, m.month, sum(least(r.check_out::date, m.e) - greatest(r.check_in::date, m.s))::int AS nights
      FROM reservations r JOIN m ON r.check_in::date < m.e AND r.check_out::date > m.s
      WHERE r.state IN ('confirmed','checked_in','checked_out') AND r.channel NOT IN ('maintenance_block','owner_stay')
        AND r.unit_id IN (SELECT id FROM su)
      GROUP BY r.unit_id, m.month)
    SELECT
      (SELECT json_agg(su ORDER BY su.property, su.unit_number) FROM su) AS units,
      (SELECT json_agg(b ORDER BY b.incurred_on, b.id) FROM b WHERE b.unit_id IN (SELECT id FROM su)) AS bills,
      (SELECT json_agg(n) FROM n) AS nights`,
    start, endEx, JSON.stringify(list), ...(building ? [building] : []), ...(unit ? [unit] : []));

  const nights: Record<string, Record<string, number>> = {};
  for (const x of row?.nights ?? []) (nights[x.unit_id] ??= {})[x.month] = Number(x.nights);
  return json({
    generatedAt: nowIso(), from, to, months: list,
    units: (row?.units ?? []).map(u => ({ id: u.id, buildingId: u.property_id, building: u.property, number: u.unit_number, owner: u.owner ?? null })),
    bills: (row?.bills ?? []).map(b => ({
      id: b.id, unitId: b.unit_id, kind: b.category, billMonth: String(b.incurred_on).slice(0, 7), deductMonth: b.deduct_month,
      amount: Number(b.amount), chargeTo: b.charge_to, recordOnly: !!b.record_only, final: !!b.final,
      receiptId: b.receipt_document_id ?? null, reference: b.reference ?? null, rolled: !!b.rolled,
    })),
    nights,
  });
};
