import { type Env, all, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

import { WEEKEND_MULTIPLIER, upliftFor, defaultUpliftShare } from '../../_lib/channelPrice';
const CHANNELS = ['airbnb', 'booking_com', 'agoda'];

/** GET /api/pricing/rules — per unit: base web rate, cost floor and each channel's uplift with its sync state. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage && session.role !== 'operations_manager') return fail('FORBIDDEN', 'Pricing is visible to finance, operations managers and management.', 403);

  // Every unit, listed or not: a new unit starts unlisted with no base rate, and it needs one set here
  // before it can be sold anywhere (Channex setup refuses a unit without a base price).
  const units = await all<any>(env, `
    SELECT u.id, u.unit_number, u.base_rate, u.cost_floor, u.channex_rate_plan_airbnb, u.channex_rate_plan_booking_com, u.channex_rate_plan_agoda, p.name AS property_name
    FROM units u JOIN properties p ON p.id = u.property_id ORDER BY p.name, u.unit_number`);
  const uplifts = await all<any>(env, 'SELECT unit_id, channel, uplift FROM channel_uplifts');
  // Sync state per unit and channel comes from the real Channex connection and its outbox, never from a
  // stored sample status: not connected until the unit is linked to that booking site.
  const connected = await all<any>(env, 'SELECT unit_id, ota FROM channex_channels');
  const pending = await all<any>(env, `
    SELECT o.unit_id, o.rate_plan_id, o.status FROM channex_outbox o
    WHERE o.kind = 'restrictions' AND o.status IN ('queued','sending','failed')`);
  const syncOf = (u: any, ch: string): 'not_connected' | 'synced' | 'queued' | 'failed' => {
    if (!connected.some(c => c.unit_id === u.id && c.ota === ch)) return 'not_connected';
    const plan = u[`channex_rate_plan_${ch}`];
    const mine = pending.filter(p => p.unit_id === u.id && p.rate_plan_id === plan);
    return mine.some(p => p.status === 'failed') ? 'failed' : mine.length ? 'queued' : 'synced';
  };

  return json({
    generatedAt: nowIso(), weekendMultiplier: WEEKEND_MULTIPLIER,
    units: units.map(u => ({
      unitId: u.id, unitNumber: u.unit_number, propertyName: u.property_name,
      costFloor: Number(u.cost_floor), baseRate: Number(u.base_rate),
      rates: CHANNELS.map(ch => {
        const set = uplifts.find(x => x.unit_id === u.id && x.channel === ch);
        return {
          channel: ch,
          upliftSen: upliftFor(ch, Number(u.base_rate), set?.uplift),
          // Not set by hand: the uplift is this share of the base rate, so it moves when the base rate does.
          upliftShare: set ? null : defaultUpliftShare(ch),
          sync: syncOf(u, ch),
        };
      }),
    })),
  });
};
