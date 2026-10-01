import { type Env, all, json, fail, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

const WEEKEND_MULTIPLIER = 1.22;
/** Until someone sets an uplift by hand, each channel adds this share of the base rate. */
const DEFAULT_UPLIFT: Record<string, number> = { airbnb: 0.12, booking_com: 0.18, agoda: 0.16 };
const CHANNELS = ['airbnb', 'booking_com', 'agoda'];
const SYNC: Record<string, 'synced' | 'queued' | 'failed'> = { connected: 'synced', degraded: 'queued', expired: 'failed', failed: 'failed' };

/** GET /api/pricing/rules — per unit: base web rate, cost floor and each channel's uplift with its sync state. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role) && session.role !== 'operations_manager') return fail('FORBIDDEN', 'Pricing is visible to finance, operations managers and management.', 403);

  // Every unit, listed or not: a new unit starts unlisted with no base rate, and it needs one set here
  // before it can be sold anywhere (Channex setup refuses a unit without a base price).
  const units = await all<any>(env, `
    SELECT u.id, u.unit_number, u.base_rate, u.cost_floor, p.name AS property_name
    FROM units u JOIN properties p ON p.id = u.property_id ORDER BY p.name, u.unit_number`);
  const uplifts = await all<any>(env, 'SELECT unit_id, channel, uplift FROM channel_uplifts');
  const integrations = await all<any>(env, 'SELECT provider, state FROM integrations');

  return json({
    generatedAt: nowIso(), weekendMultiplier: WEEKEND_MULTIPLIER,
    units: units.map(u => ({
      unitId: u.id, unitNumber: u.unit_number, propertyName: u.property_name,
      costFloor: Number(u.cost_floor), baseRate: Number(u.base_rate),
      rates: CHANNELS.map(ch => {
        const set = uplifts.find(x => x.unit_id === u.id && x.channel === ch);
        const integ = integrations.find(i => i.provider === ch);
        return {
          channel: ch,
          upliftSen: set ? Number(set.uplift) : Math.round(Number(u.base_rate) * DEFAULT_UPLIFT[ch]),
          sync: integ ? SYNC[integ.state] ?? 'failed' : 'failed',
        };
      }),
    })),
  });
};
