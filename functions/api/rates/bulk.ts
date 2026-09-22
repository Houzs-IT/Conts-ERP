import { type Env, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';
import { syncRateIfLinked } from '../../_lib/channexSync';

const CHANNELS = ['web', 'airbnb', 'booking_com', 'agoda'];
const WEEKEND_MULTIPLIER = 1.22;

/** POST /api/rates/bulk { unitIds, channels, from, to, baseRate, uplifts? } — writes a price for every night from..to inclusive.
 *  Without `uplifts` every channel gets `baseRate` as given (the calendar's bulk update).
 *  With `uplifts` (the Pricing screen's push) each channel gets baseRate + its uplift, and Friday/Saturday nights get the weekend multiplier.
 *  The prices are held here; no channel API is connected yet, so nothing is sent to Airbnb, Booking.com or Agoda. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role) && session.role !== 'operations_manager') return fail('FORBIDDEN', 'Only finance, operations managers and management can set rates.', 403);

  const b = await request.json<any>().catch(() => null);
  const channels: string[] = Array.isArray(b?.channels) ? b.channels.map((c: string) => (c === 'direct' ? 'web' : c)) : [];
  if (!Array.isArray(b?.unitIds) || !b.unitIds.length || !channels.length || channels.some(c => !CHANNELS.includes(c))) return fail('VALIDATION', 'Pick at least one unit and one channel.', 422);
  if (!b.from || !b.to || b.to < b.from) return fail('VALIDATION', 'Pick a valid date range.', 422);
  if (!Number.isInteger(b.baseRate) || b.baseRate < 0) return fail('VALIDATION', 'The rate must be a whole number of sen.', 422, { baseRate: 'Enter a valid rate.' });
  const uplifts: Record<string, number> | null = b.uplifts && typeof b.uplifts === 'object' ? b.uplifts : null;

  const days: string[] = [];
  for (let t = Date.parse(b.from); t <= Date.parse(b.to) && days.length < 366; t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));

  const now = nowIso();
  let written = 0;
  for (const unitId of b.unitIds) {
    // Web-channel nights for this unit, in order, so same-priced runs can be sent to Channex as one range each.
    const webNights: { date: string; rate: number }[] = [];
    for (const channel of channels) for (const date of days) {
      let rate = b.baseRate;
      if (uplifts) {
        rate = b.baseRate + (channel === 'web' ? 0 : Math.max(0, Math.round(Number(uplifts[channel] ?? 0))));
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
        if (weekday === 5 || weekday === 6) rate = Math.round(rate * WEEKEND_MULTIPLIER);
      }
      await run(env, `
        INSERT INTO channel_rates (unit_id, channel, rate_date, rate, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (unit_id, channel, rate_date) DO UPDATE SET rate = excluded.rate, updated_at = excluded.updated_at`,
        unitId, channel, date, rate, now);
      written++;
      if (channel === 'web') webNights.push({ date, rate });
    }
    // Channex takes one flat rate per date range, so a run of consecutive nights at the same price becomes one push.
    let i = 0;
    while (i < webNights.length) {
      let j = i;
      while (j + 1 < webNights.length && webNights[j + 1].rate === webNights[i].rate) j++;
      await syncRateIfLinked(env, unitId, webNights[i].date, webNights[i].rate, webNights[j].date);
      i = j + 1;
    }
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'rate.bulk', entityTable: 'units', entityId: 'bulk', after: { units: b.unitIds.length, channels, from: b.from, to: b.to, baseRate: b.baseRate, withUplifts: !!uplifts } });
  return json({ ok: true, written });
};
