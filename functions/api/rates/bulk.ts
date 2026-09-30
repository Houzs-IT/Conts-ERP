import { type Env, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';
import { syncRateIfLinked, syncRestrictionsIfLinked } from '../../_lib/channexSync';

const CHANNELS = ['web', 'airbnb', 'booking_com', 'agoda'];
const WEEKEND_MULTIPLIER = 1.22;

/** POST /api/rates/bulk { unitIds, from, to, channels?, baseRate?, uplifts?, minStay?, stopSell? } — for every night from..to inclusive:
 *  - baseRate (with channels): writes the price. Without `uplifts` every channel gets `baseRate` as given (the calendar's
 *    bulk update); with `uplifts` (the Pricing screen's push) each channel gets baseRate + its uplift, and Friday/Saturday
 *    nights get the weekend multiplier.
 *  - minStay (1-60, or null to clear) and stopSell (true/false): the unit's restrictions for those nights.
 *  Any of the three may be sent alone. Changes for linked units are queued for Channex (channexQueue.ts), which sends
 *  them in one batch with anything else edited at the same time. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role) && session.role !== 'operations_manager') return fail('FORBIDDEN', 'Only finance, operations managers and management can set rates.', 403);

  const b = await request.json<any>().catch(() => null);
  const hasRate = b?.baseRate !== undefined && b?.baseRate !== null;
  const hasMinStay = b?.minStay !== undefined;
  const hasStopSell = typeof b?.stopSell === 'boolean';
  const channels: string[] = Array.isArray(b?.channels) ? b.channels.map((c: string) => (c === 'direct' ? 'web' : c)) : [];
  if (!Array.isArray(b?.unitIds) || !b.unitIds.length || b.unitIds.some((u: unknown) => typeof u !== 'string' || !u)) return fail('VALIDATION', 'Pick at least one unit.', 422);
  if (!hasRate && !hasMinStay && !hasStopSell) return fail('VALIDATION', 'Set a price, a minimum stay or stop sell.', 422);
  if (hasRate && (!channels.length || channels.some(c => !CHANNELS.includes(c)))) return fail('VALIDATION', 'Pick at least one channel for the price.', 422);
  if (!b.from || !b.to || b.to < b.from) return fail('VALIDATION', 'Pick a valid date range.', 422);
  if (hasRate && (!Number.isInteger(b.baseRate) || b.baseRate < 0)) return fail('VALIDATION', 'The rate must be a whole number of sen.', 422, { baseRate: 'Enter a valid rate.' });
  if (hasMinStay && b.minStay !== null && !(Number.isInteger(b.minStay) && b.minStay >= 1 && b.minStay <= 60)) return fail('VALIDATION', 'Minimum stay must be 1 to 60 nights.', 422, { minStay: 'Enter 1 to 60 nights.' });
  const uplifts: Record<string, number> | null = b.uplifts && typeof b.uplifts === 'object' ? b.uplifts : null;

  const days: string[] = [];
  for (let t = Date.parse(b.from); t <= Date.parse(b.to) && days.length < 500; t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
  const last = days[days.length - 1];
  const priceOn = (channel: string, date: string) => {
    if (!uplifts) return b.baseRate as number;
    let rate = b.baseRate + (channel === 'web' ? 0 : Math.max(0, Math.round(Number(uplifts[channel] ?? 0))));
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 5 || weekday === 6) rate = Math.round(rate * WEEKEND_MULTIPLIER);
    return rate;
  };

  const now = nowIso();
  let written = 0;
  for (const unitId of b.unitIds) {
    if (hasRate) {
      // One statement per unit, whatever the range: every (channel, night, price) row goes in as a set.
      const rows = channels.flatMap(channel => days.map(date => ({ channel, date, rate: priceOn(channel, date) })));
      await run(env, `
        INSERT INTO channel_rates (unit_id, channel, rate_date, rate, updated_at)
        SELECT ?, channel, date, rate, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(channel text, date text, rate int)
        ON CONFLICT (unit_id, channel, rate_date) DO UPDATE SET rate = excluded.rate, updated_at = excluded.updated_at`,
        unitId, now, JSON.stringify(rows));
      written += rows.length;
      // Channex takes one flat rate per date range, so a run of consecutive nights at the same price is one value.
      if (channels.includes('web')) {
        let i = 0;
        while (i < days.length) {
          let j = i;
          while (j + 1 < days.length && priceOn('web', days[j + 1]) === priceOn('web', days[i])) j++;
          await syncRateIfLinked(env, unitId, days[i], priceOn('web', days[i]), days[j]);
          i = j + 1;
        }
      }
    }
    if (hasMinStay || hasStopSell) {
      await run(env, `
        INSERT INTO unit_restrictions (unit_id, rate_date, min_stay, stop_sell, updated_at)
        SELECT ?, to_char(d, 'YYYY-MM-DD'), ?, COALESCE(?, false), ? FROM generate_series(?::date, ?::date, interval '1 day') AS d
        ON CONFLICT (unit_id, rate_date) DO UPDATE SET
          min_stay = CASE WHEN ? THEN excluded.min_stay ELSE unit_restrictions.min_stay END,
          stop_sell = CASE WHEN ? THEN excluded.stop_sell ELSE unit_restrictions.stop_sell END,
          updated_at = excluded.updated_at`,
        unitId, hasMinStay ? b.minStay : null, hasStopSell ? b.stopSell : null, now, days[0], last, hasMinStay, hasStopSell);
      // Clearing a minimum stay means one night again, as far as the channels are concerned.
      await syncRestrictionsIfLinked(env, unitId, days[0], last, {
        ...(hasMinStay ? { minStay: b.minStay ?? 1 } : {}), ...(hasStopSell ? { stopSell: b.stopSell } : {}),
      });
    }
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'rate.bulk', entityTable: 'units', entityId: 'bulk', after: { units: b.unitIds.length, channels, from: b.from, to: b.to, baseRate: hasRate ? b.baseRate : undefined, withUplifts: !!uplifts, minStay: hasMinStay ? b.minStay : undefined, stopSell: hasStopSell ? b.stopSell : undefined } });
  return json({ ok: true, written });
};
