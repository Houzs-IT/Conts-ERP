import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { syncRateIfLinked, syncRestrictionsIfLinked } from '../../_lib/channexSync';
import { upliftFor, webRate, type SalesChannel } from '../../_lib/channelPrice';

const CHANNELS = ['web', 'airbnb', 'booking_com', 'agoda'];
const MAX_LINES = 20;
const MAX_NIGHTS = 500;

interface Line { from: string; to: string; baseRate?: number | null; adjustPct?: number | null; minStay?: number | null; stopSell?: boolean }

const addDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
const weekdayOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

/** Consecutive nights grouped into runs, so a Channex update is one range per run instead of one per night. */
function runsOf(days: string[]): string[][] {
  const out: string[][] = [];
  for (const d of days) {
    const last = out[out.length - 1];
    if (last && addDay(last[last.length - 1]) === d) last.push(d); else out.push([d]);
  }
  return out;
}

/** POST /api/rates/bulk { unitIds, channels?, weekdays?, lines: [{ from, to, baseRate? | adjustPct?, minStay?, stopSell? }] }
 *  (or one range given at the top level: { unitIds, from, to, baseRate?, ... }).
 *  - weekdays: 0 (Sunday) to 6 (Saturday); only those nights of each range are changed. All nights if omitted.
 *  - baseRate (sen) sets the night's web (direct) price; adjustPct (-90 to 300) moves the night's current web
 *    price by that percentage, rounded to the ringgit. Every booking site then gets that web price plus the
 *    unit's own uplift for the site (the saved one, else the default share), so the sites keep their markup.
 *  - channels: which of web / airbnb / booking_com / agoda to price (all if omitted). A booking site is only
 *    written for a unit that is connected to it (channex_channels); the others are skipped and reported.
 *  - uplifts (the Pricing screen's push, values ignored): the range is priced at the standard rule, so Friday and
 *    Saturday nights take the unit's weekend rate when it has one.
 *  - minStay (1-60, or null to clear) and stopSell (true/false): the unit's restrictions for those nights.
 *  The save stands whatever Channex does: queueing for Channex is wrapped per unit and failures are audited. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage && session.role !== 'operations_manager') return fail('FORBIDDEN', 'Only finance, operations managers and management can set rates.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!Array.isArray(b?.unitIds) || !b.unitIds.length || b.unitIds.some((u: unknown) => typeof u !== 'string' || !u)) return fail('VALIDATION', 'Pick at least one unit.', 422);
  const unitIds = [...new Set(b.unitIds as string[])];
  const channels: string[] = Array.isArray(b.channels) ? [...new Set<string>(b.channels.map((c: string) => (c === 'direct' ? 'web' : c)))] : [...CHANNELS];
  if (channels.some(c => !CHANNELS.includes(c))) return fail('VALIDATION', 'Unknown channel.', 422);
  const standard = !!(b.uplifts && typeof b.uplifts === 'object');
  let weekdays: Set<number> | null = null;
  if (b.weekdays !== undefined && b.weekdays !== null) {
    if (!Array.isArray(b.weekdays) || !b.weekdays.length || b.weekdays.some((d: unknown) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6)) return fail('VALIDATION', 'Pick at least one day of the week.', 422, { weekdays: 'Pick at least one day.' });
    weekdays = new Set(b.weekdays as number[]);
  }

  const lines: Line[] = Array.isArray(b.lines) ? b.lines
    : [{ from: b.from, to: b.to, baseRate: b.baseRate ?? undefined, adjustPct: b.adjustPct ?? undefined, minStay: b.minStay, stopSell: b.stopSell }];
  if (!lines.length || lines.length > MAX_LINES) return fail('VALIDATION', `Add 1 to ${MAX_LINES} date ranges.`, 422);
  for (const [n, l] of lines.entries()) {
    const at = lines.length > 1 ? ` (range ${n + 1})` : '';
    const hasRate = l.baseRate !== undefined && l.baseRate !== null, hasPct = l.adjustPct !== undefined && l.adjustPct !== null;
    const hasMinStay = l.minStay !== undefined, hasStopSell = typeof l.stopSell === 'boolean';
    if (!l.from || !l.to || l.to < l.from) return fail('VALIDATION', `Pick a valid date range${at}.`, 422);
    if (!hasRate && !hasPct && !hasMinStay && !hasStopSell) return fail('VALIDATION', `Set a price, a minimum stay or stop sell${at}.`, 422);
    if (hasRate && hasPct) return fail('VALIDATION', `Set a price or a percentage, not both${at}.`, 422);
    if ((hasRate || hasPct) && !channels.length) return fail('VALIDATION', 'Pick at least one channel for the price.', 422);
    if (hasRate && (!Number.isInteger(l.baseRate) || l.baseRate! <= 0)) return fail('VALIDATION', `The rate must be a whole number of sen above zero${at}.`, 422, { baseRate: 'Enter a valid rate.' });
    if (hasPct && !(typeof l.adjustPct === 'number' && Number.isFinite(l.adjustPct) && l.adjustPct >= -90 && l.adjustPct <= 300)) return fail('VALIDATION', `The change must be between -90% and +300%${at}.`, 422, { adjustPct: 'Enter -90 to 300.' });
    if (hasMinStay && l.minStay !== null && !(Number.isInteger(l.minStay) && l.minStay! >= 1 && l.minStay! <= 60)) return fail('VALIDATION', `Minimum stay must be 1 to 60 nights${at}.`, 422, { minStay: 'Enter 1 to 60 nights.' });
  }

  // Each range's nights, keeping only the chosen days of the week.
  const nightsOf = lines.map(l => {
    const out: string[] = [];
    for (let d = l.from, k = 0; d <= l.to && k < MAX_NIGHTS; d = addDay(d), k++) if (!weekdays || weekdays.has(weekdayOf(d))) out.push(d);
    return out;
  });
  if (nightsOf.every(n => !n.length)) return fail('VALIDATION', 'None of those dates fall on the chosen days of the week.', 422, { weekdays: 'No matching nights.' });

  const idsJson = JSON.stringify(unitIds);
  const [units, savedUplifts, connected] = await Promise.all([
    all<{ id: string; base_rate: number; weekend_rate: number | null }>(env, 'SELECT id, base_rate, weekend_rate FROM units WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', idsJson),
    all<{ unit_id: string; channel: string; uplift: number }>(env, 'SELECT unit_id, channel, uplift FROM channel_uplifts WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', idsJson),
    all<{ unit_id: string; ota: string }>(env, 'SELECT unit_id, ota FROM channex_channels WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', idsJson),
  ]);
  if (units.length !== unitIds.length) return fail('NOT_FOUND', 'One of those units does not exist.', 404);
  const anyPct = lines.some(l => l.adjustPct !== undefined && l.adjustPct !== null);
  const allNights = nightsOf.flat().sort();
  // A percentage moves the current web price, which may be a price set by hand for that night.
  const webSet = anyPct && allNights.length ? new Map((await all<{ unit_id: string; rate_date: string; rate: number }>(env,
    `SELECT unit_id, rate_date, rate FROM channel_rates WHERE channel = 'web' AND rate_date BETWEEN ? AND ? AND unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`,
    allNights[0], allNights[allNights.length - 1], idsJson)).map(r => [`${r.unit_id}:${r.rate_date}`, Number(r.rate)])) : new Map<string, number>();

  const now = nowIso();
  let written = 0;
  const skipped: Record<string, number> = {};   // booking site -> units left alone because they are not connected to it
  const syncFailed: string[] = [];
  for (const u of units) {
    const linked = new Set(connected.filter(c => c.unit_id === u.id).map(c => c.ota));
    const mine = channels.filter(c => c === 'web' || linked.has(c));
    for (const c of channels) if (c !== 'web' && !linked.has(c)) skipped[c] = (skipped[c] ?? 0) + 1;
    const saved = (c: string) => savedUplifts.find(x => x.unit_id === u.id && x.channel === c)?.uplift;
    const toSync: { channel: string; date: string; rate: number }[] = [];
    const restrictions: { days: string[]; minStay?: number | null; stopSell?: boolean }[] = [];

    for (const [n, l] of lines.entries()) {
      const days = nightsOf[n];
      if (!days.length) continue;
      const hasRate = l.baseRate !== undefined && l.baseRate !== null, hasPct = l.adjustPct !== undefined && l.adjustPct !== null;
      const hasMinStay = l.minStay !== undefined, hasStopSell = typeof l.stopSell === 'boolean';
      if ((hasRate || hasPct) && mine.length) {
        const webOn = (date: string) => {
          if (hasPct) {
            const current = webSet.get(`${u.id}:${date}`) ?? webRate(Number(u.base_rate), u.weekend_rate, date);
            return Math.max(100, Math.round(current * (1 + l.adjustPct! / 100) / 100) * 100);
          }
          return standard ? webRate(l.baseRate!, u.weekend_rate, date) : l.baseRate!;
        };
        const rows = mine.flatMap(channel => days.map(date => {
          const web = webOn(date);
          return { channel, date, rate: web + upliftFor(channel, web, saved(channel)) };
        }));
        await run(env, `
          INSERT INTO channel_rates (unit_id, channel, rate_date, rate, updated_at)
          SELECT ?, channel, date, rate, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(channel text, date text, rate int)
          ON CONFLICT (unit_id, channel, rate_date) DO UPDATE SET rate = excluded.rate, updated_at = excluded.updated_at`,
          u.id, now, JSON.stringify(rows));
        written += rows.length;
        toSync.push(...rows);
      }
      if (hasMinStay || hasStopSell) {
        await run(env, `
          INSERT INTO unit_restrictions (unit_id, rate_date, min_stay, stop_sell, updated_at)
          SELECT ?, d, ?::int, COALESCE(?::boolean, false), ? FROM jsonb_array_elements_text(?::text::jsonb) AS d
          ON CONFLICT (unit_id, rate_date) DO UPDATE SET
            min_stay = CASE WHEN ?::boolean THEN excluded.min_stay ELSE unit_restrictions.min_stay END,
            stop_sell = CASE WHEN ?::boolean THEN excluded.stop_sell ELSE unit_restrictions.stop_sell END,
            updated_at = excluded.updated_at`,
          u.id, hasMinStay ? l.minStay : null, hasStopSell ? l.stopSell : null, now, JSON.stringify(days), hasMinStay, hasStopSell);
        restrictions.push({ days, ...(hasMinStay ? { minStay: l.minStay } : {}), ...(hasStopSell ? { stopSell: l.stopSell } : {}) });
      }
    }

    // Channex: everything for the unit is queued together and leaves as one call (channexQueue.ts). A run of
    // consecutive nights at one price is one range. Nothing here can undo the save above.
    try {
      for (const channel of mine) {
        const nights = toSync.filter(r => r.channel === channel).sort((x, y) => x.date.localeCompare(y.date));
        let i = 0;
        while (i < nights.length) {
          let j = i;
          while (j + 1 < nights.length && nights[j + 1].rate === nights[i].rate && nights[j + 1].date === addDay(nights[j].date)) j++;
          await syncRateIfLinked(env, u.id, nights[i].date, nights[i].rate, nights[j].date, channel as SalesChannel);
          i = j + 1;
        }
      }
      for (const r of restrictions) {
        for (const span of runsOf(r.days)) {
          // Clearing a minimum stay means one night again, as far as the channels are concerned.
          await syncRestrictionsIfLinked(env, u.id, span[0], span[span.length - 1], {
            ...(r.minStay !== undefined ? { minStay: r.minStay ?? 1 } : {}), ...(r.stopSell !== undefined ? { stopSell: r.stopSell } : {}),
          });
        }
      }
    } catch (e) {
      syncFailed.push(u.id);
      await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.enqueue_failed', entityTable: 'units', entityId: u.id, after: { source: 'rates.bulk', error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
    }
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'rate.bulk', entityTable: 'units', entityId: 'bulk', after: { units: unitIds.length, channels, weekdays: weekdays ? [...weekdays] : null, standard, skipped, lines } });
  return json({ ok: true, written, nights: nightsOf.reduce((k, n) => k + n.length, 0), skipped, syncFailed: syncFailed.length });
};

