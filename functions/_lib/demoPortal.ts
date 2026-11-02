import { type Env, all, one, fail } from './db';
import { daysIn, todayMyt } from './ops';

/** The sample owner portal (Owner B > Owner portal (sample); Owner Hub plan, owner, 2 Nov 2026). The owner portal's own
 *  screens, fed from Demo mode: the same answers as /api/owner/*, built from demo.v_* for a sample owner, each with
 *  sample: true. Only sample owners (ids demo-) are served, so a real owner's money is never shown to a prospect,
 *  and nothing here reads or writes owner statements or payouts: a sample statement is worked out from the sample
 *  owner's sample reservations, gross less the operator's share. */

export interface SampleOwner { id: string; display_name: string; default_management_fee_pct: number | null }
export interface SampleUnit { id: string; label: string }

/** The share a sample statement takes when the sample owner has none set. */
const DEFAULT_SHARE = 25;
const COUNTED = `r.state NOT IN ('cancelled', 'no_show') AND r.channel NOT IN ('maintenance_block', 'owner_stay')`;

export async function sampleOwnerFor(env: Env, url: URL): Promise<{ owner: SampleOwner; units: SampleUnit[] } | Response> {
  const id = url.searchParams.get('ownerId') ?? '';
  if (!id.startsWith('demo-')) return fail('VALIDATION', 'Pick a sample owner.', 422);
  const owner = await one<SampleOwner>(env, 'SELECT id, display_name, default_management_fee_pct FROM demo.owners WHERE id = ? AND shadow_of IS NULL', id);
  if (!owner) return fail('NOT_FOUND', 'That sample owner no longer exists.', 404);
  const units = await all<{ id: string; unit_number: string; property_name: string }>(env, `
    SELECT u.id, u.unit_number, p.name AS property_name FROM demo.v_units u JOIN properties p ON p.id = u.property_id
    WHERE u.owner_id = ? ORDER BY p.name, u.unit_number`, id);
  return { owner, units: units.map(u => ({ id: u.id, label: `${u.property_name} ${u.unit_number}` })) };
}

export const shareOf = (o: SampleOwner) => Number(o.default_management_fee_pct ?? DEFAULT_SHARE);
const ym = (d: string) => d.slice(0, 7);

/** Each unit's gross, nights and stays in a month, by check-in (sen). */
async function monthRows(env: Env, unitIds: string[], period: string) {
  if (!unitIds.length) return [];
  return all<{ unit_id: string; gross: number; nights: number; stays: number }>(env, `
    SELECT r.unit_id, COALESCE(SUM(r.gross_booking_value), 0)::bigint AS gross, COALESCE(SUM(r.check_out::date - r.check_in::date), 0)::int AS nights, COUNT(*)::int AS stays
    FROM demo.v_reservations r WHERE r.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND ${COUNTED} AND substr(r.check_in, 1, 7) = ?
    GROUP BY r.unit_id`, JSON.stringify(unitIds), period);
}

/** The months that have a sample statement: every month up to this one with a counted sample stay, newest first. */
export async function statementMonths(env: Env, unitIds: string[]): Promise<string[]> {
  if (!unitIds.length) return [];
  const rows = await all<{ m: string }>(env, `
    SELECT DISTINCT substr(r.check_in, 1, 7) AS m FROM demo.v_reservations r
    WHERE r.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND ${COUNTED} AND substr(r.check_in, 1, 7) <= ?
    ORDER BY m DESC`, JSON.stringify(unitIds), ym(todayMyt()));
  return rows.map(r => r.m);
}

export const statementId = (ownerId: string, period: string) => `sample-${period}-${ownerId}`;
export function parseStatementId(id: string): { period: string; ownerId: string } | null {
  const m = /^sample-(\d{4}-\d{2})-(demo-.+)$/.exec(id);
  return m ? { period: m[1], ownerId: m[2] } : null;
}

/** One month's sample statement: per unit, gross, the operator's share and the net, in the owner portal's shape. */
export async function sampleStatement(env: Env, owner: SampleOwner, units: SampleUnit[], period: string) {
  const share = shareOf(owner);
  const rows = new Map((await monthRows(env, units.map(u => u.id), period)).map(r => [r.unit_id, r]));
  const perUnit = units.map(u => {
    const r = rows.get(u.id);
    const gross = Number(r?.gross ?? 0), fee = Math.round(gross * share / 100);
    return {
      id: u.id, label: u.label, gross, fee, expenses: 0, adjustments: 0, net: gross - fee, stays: Number(r?.stays ?? 0), nights: Number(r?.nights ?? 0),
      lines: [
        { label: r?.stays ? `Gross Income · ${r.stays} ${r.stays === 1 ? 'reservation' : 'reservations'}` : 'Gross Income', amount: gross, type: 'gross' as const },
        { label: `${share}% To Operator`, amount: -fee, type: 'fee' as const },
      ],
    };
  });
  const gross = perUnit.reduce((s, u) => s + u.gross, 0), fee = perUnit.reduce((s, u) => s + u.fee, 0);
  return {
    id: statementId(owner.id, period), period, isFinal: period < ym(todayMyt()), share,
    unitsLabel: units.length === 1 ? units[0].label : `${units.length} units`,
    grossBookingValue: gross, managementFee: fee, expensesTotal: 0, adjustmentsTotal: 0, netPayout: gross - fee,
    nights: perUnit.reduce((s, u) => s + u.nights, 0), stays: perUnit.reduce((s, u) => s + u.stays, 0),
    units: perUnit,
  };
}

export async function sampleRating(env: Env, unitIds: string[]) {
  if (!unitIds.length) return { rating: null as number | null, reviews: 0 };
  const r = await one<{ rating: number | null; n: number }>(env, `
    SELECT ROUND(AVG(v.rating)::numeric, 2) AS rating, COUNT(*)::int AS n FROM demo.v_reviews v
    WHERE v.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND v.reviewed_at >= to_char(now() - interval '12 months', 'YYYY-MM-DD')`, JSON.stringify(unitIds));
  return { rating: Number(r?.n) ? Number(r!.rating) : null, reviews: Number(r?.n ?? 0) };
}

export const occupancy = (nights: number, unitCount: number, period: string) => {
  const available = unitCount * daysIn(period);
  return available ? Math.round((nights / available) * 1000) / 10 : 0;
};

/** Net Payout to Owner by month for the sample owner, every month at once: gross by check-in month less the share. */
export async function monthlyNet(env: Env, owner: SampleOwner, unitIds: string[]): Promise<{ period: string; netPayout: number }[]> {
  if (!unitIds.length) return [];
  const share = shareOf(owner);
  const rows = await all<{ m: string; gross: number }>(env, `
    SELECT substr(r.check_in, 1, 7) AS m, COALESCE(SUM(r.gross_booking_value), 0)::bigint AS gross FROM demo.v_reservations r
    WHERE r.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND ${COUNTED} AND substr(r.check_in, 1, 7) <= ?
    GROUP BY 1 ORDER BY 1`, JSON.stringify(unitIds), ym(todayMyt()));
  return rows.map(r => { const g = Number(r.gross); return { period: r.m, netPayout: g - Math.round(g * share / 100) }; });
}
