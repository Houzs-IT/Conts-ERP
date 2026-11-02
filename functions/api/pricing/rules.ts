import { type Env, all, json, fail, nowIso, mytToday } from '../../_lib/db';
import { rentalOnly } from '../../_lib/unitPurpose';
import { requireSession } from '../../_lib/auth';
import { OTA_CHANNELS, upliftFor, defaultUpliftShare } from '../../_lib/channelPrice';
import { loadPricing, pricingReady, grid } from '../../_lib/unitPricing';
import { holidaysReady, listHolidays, normalizeState, appliesTo } from '../../_lib/holidays';

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** GET /api/pricing/rules — per unit: its price levels (nightly, weekend, holiday), cost floor, each channel's rule
 *  (default share, RM or % above the direct price, or fixed prices) with the resulting price per level, its sync state,
 *  and the next public holidays that apply to it. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Pricing is visible to people with Full Performance access.', 403);

  // Every unit, listed or not: a new unit starts unlisted with no base rate, and it needs one set here
  // before it can be sold anywhere (Channex setup refuses a unit without a base price).
  const units = await all<any>(env, `
    SELECT u.id, u.unit_number, u.base_rate, u.cost_floor, u.channex_rate_plan_airbnb, u.channex_rate_plan_booking_com, u.channex_rate_plan_agoda, p.name AS property_name, p.state
    FROM units u JOIN properties p ON p.id = u.property_id WHERE 1 = 1${await rentalOnly(env)} ORDER BY p.name, u.unit_number`);
  const today = mytToday(), yearOn = addDays(today, 365);
  const [pricing, ready, holidays] = await Promise.all([
    loadPricing(env, units.map(u => u.id), today, yearOn),
    pricingReady(env),
    (async () => ((await holidaysReady(env)) ? listHolidays(env, today, yearOn) : null))(),
  ]);
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
    generatedAt: nowIso(),
    // Before migration 0202 there is no holiday price, no holiday list and only the RM-above rule.
    levelsReady: ready, holidaysReady: holidays !== null,
    units: units.map(u => {
      const p = pricing.get(u.id)!;
      const st = normalizeState(u.state);
      return {
        unitId: u.id, unitNumber: u.unit_number, propertyName: u.property_name, state: st,
        costFloor: Number(u.cost_floor), baseRate: p.levels.base,
        // The direct price of a Friday or Saturday night; null sells the weekend at the nightly price.
        weekendRate: p.levels.weekend,
        // The direct price of a holiday night; null sells holidays at the weekend or nightly price.
        holidayRate: p.levels.holiday, holidayEve: p.levels.holidayEve,
        // Every channel's price per level, Direct ('web') first: what the guest pays on a night with no custom price.
        levels: grid(p),
        nextHolidays: (holidays ?? []).filter(h => appliesTo(h.state, st)).slice(0, 3).map(h => ({ date: h.date, name: h.name })),
        rates: OTA_CHANNELS.map(ch => {
          const r = p.rules[ch];
          return {
            channel: ch, mode: r.mode,
            // The amount over the nightly price (default and RM rules), as the older screens show it.
            upliftSen: r.mode === 'amount' ? Number(r.uplift ?? 0) : r.mode === 'default' ? upliftFor(ch, p.levels.base, null) : grid(p)[ch].base - p.levels.base,
            // Not set by hand: the uplift is this share of the direct price, so it moves when the direct price does.
            upliftShare: r.mode === 'default' ? defaultUpliftShare(ch) : null,
            percent: r.mode === 'percent' ? Number(r.percent) : null,
            fixedBase: r.mode === 'fixed' ? r.fixedBase ?? null : null, fixedWeekend: r.mode === 'fixed' ? r.fixedWeekend ?? null : null, fixedHoliday: r.mode === 'fixed' ? r.fixedHoliday ?? null : null,
            sync: syncOf(u, ch),
          };
        }),
      };
    }),
  });
};
