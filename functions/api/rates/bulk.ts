import { type Env, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';
import { syncRateIfLinked, syncRestrictionsIfLinked } from '../../_lib/channexSync';

const CHANNELS = ['web', 'airbnb', 'booking_com', 'agoda'];
const WEEKEND_MULTIPLIER = 1.22;
const MAX_LINES = 20;

interface Line { from: string; to: string; baseRate?: number; minStay?: number | null; stopSell?: boolean }

/** POST /api/rates/bulk { unitIds, channels?, uplifts?, lines: [{ from, to, baseRate?, minStay?, stopSell? }] }
 *  (or one range given at the top level: { unitIds, from, to, baseRate?, ... }). For every night of every range:
 *  - baseRate (with channels): writes the price. Without `uplifts` every channel gets `baseRate` as given (the
 *    calendar's Rate update); with `uplifts` (the Pricing screen's push) each channel gets baseRate + its uplift,
 *    and Friday/Saturday nights get the weekend multiplier.
 *  - minStay (1-60, or null to clear) and stopSell (true/false): the unit's restrictions for those nights.
 *  Everything in one save is queued for Channex together, so it leaves as one call per unit (channexQueue.ts). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role) && session.role !== 'operations_manager') return fail('FORBIDDEN', 'Only finance, operations managers and management can set rates.', 403);

  const b = await request.json<any>().catch(() => null);
  const channels: string[] = Array.isArray(b?.channels) ? b.channels.map((c: string) => (c === 'direct' ? 'web' : c)) : [];
  const uplifts: Record<string, number> | null = b?.uplifts && typeof b.uplifts === 'object' ? b.uplifts : null;
  if (!Array.isArray(b?.unitIds) || !b.unitIds.length || b.unitIds.some((u: unknown) => typeof u !== 'string' || !u)) return fail('VALIDATION', 'Pick at least one unit.', 422);

  const lines: Line[] = Array.isArray(b.lines) ? b.lines
    : [{ from: b.from, to: b.to, baseRate: b.baseRate ?? undefined, minStay: b.minStay, stopSell: b.stopSell }];
  if (!lines.length || lines.length > MAX_LINES) return fail('VALIDATION', `Add 1 to ${MAX_LINES} date ranges.`, 422);
  for (const [n, l] of lines.entries()) {
    const at = lines.length > 1 ? ` (range ${n + 1})` : '';
    const hasRate = l.baseRate !== undefined && l.baseRate !== null, hasMinStay = l.minStay !== undefined, hasStopSell = typeof l.stopSell === 'boolean';
    if (!l.from || !l.to || l.to < l.from) return fail('VALIDATION', `Pick a valid date range${at}.`, 422);
    if (!hasRate && !hasMinStay && !hasStopSell) return fail('VALIDATION', `Set a price, a minimum stay or stop sell${at}.`, 422);
    if (hasRate && (!channels.length || channels.some(c => !CHANNELS.includes(c)))) return fail('VALIDATION', 'Pick at least one channel for the price.', 422);
    if (hasRate && (!Number.isInteger(l.baseRate) || l.baseRate! < 0)) return fail('VALIDATION', `The rate must be a whole number of sen${at}.`, 422, { baseRate: 'Enter a valid rate.' });
    if (hasMinStay && l.minStay !== null && !(Number.isInteger(l.minStay) && l.minStay! >= 1 && l.minStay! <= 60)) return fail('VALIDATION', `Minimum stay must be 1 to 60 nights${at}.`, 422, { minStay: 'Enter 1 to 60 nights.' });
  }

  const now = nowIso();
  let written = 0;
  for (const l of lines) {
    const hasRate = l.baseRate !== undefined && l.baseRate !== null, hasMinStay = l.minStay !== undefined, hasStopSell = typeof l.stopSell === 'boolean';
    const days: string[] = [];
    for (let t = Date.parse(l.from); t <= Date.parse(l.to) && days.length < 500; t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
    const last = days[days.length - 1];
    const priceOn = (channel: string, date: string) => {
      if (!uplifts) return l.baseRate as number;
      let rate = l.baseRate! + (channel === 'web' ? 0 : Math.max(0, Math.round(Number(uplifts[channel] ?? 0))));
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (weekday === 5 || weekday === 6) rate = Math.round(rate * WEEKEND_MULTIPLIER);
      return rate;
    };

    for (const unitId of b.unitIds as string[]) {
      if (hasRate) {
        // One statement per unit and range: every (channel, night, price) row goes in as a set.
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
          SELECT ?, to_char(d, 'YYYY-MM-DD'), ?::int, COALESCE(?::boolean, false), ? FROM generate_series(?::date, ?::date, interval '1 day') AS d
          ON CONFLICT (unit_id, rate_date) DO UPDATE SET
            min_stay = CASE WHEN ?::boolean THEN excluded.min_stay ELSE unit_restrictions.min_stay END,
            stop_sell = CASE WHEN ?::boolean THEN excluded.stop_sell ELSE unit_restrictions.stop_sell END,
            updated_at = excluded.updated_at`,
          unitId, hasMinStay ? l.minStay : null, hasStopSell ? l.stopSell : null, now, days[0], last, hasMinStay, hasStopSell);
        // Clearing a minimum stay means one night again, as far as the channels are concerned.
        await syncRestrictionsIfLinked(env, unitId, days[0], last, {
          ...(hasMinStay ? { minStay: l.minStay ?? 1 } : {}), ...(hasStopSell ? { stopSell: l.stopSell } : {}),
        });
      }
    }
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'rate.bulk', entityTable: 'units', entityId: 'bulk', after: { units: b.unitIds.length, channels, withUplifts: !!uplifts, lines } });
  return json({ ok: true, written });
};
