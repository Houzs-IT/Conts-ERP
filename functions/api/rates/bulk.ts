import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { checkDate, invalid, type Fields } from '../../_lib/validate';
import { enqueueRestrictionsMany } from '../../_lib/channexQueue';
import { standardRate, upliftFor, webRate, type SalesChannel } from '../../_lib/channelPrice';

const CHANNELS = ['web', 'airbnb', 'booking_com', 'agoda'];
const MAX_LINES = 20;
const MAX_NIGHTS = 500;
/** Price rows one request may write. A year for every unit is some 150,000 rows, far past what one Worker
 *  request can do in its CPU budget, so the Calendar sends a few units per request and this refuses anything bigger. */
export const MAX_ROWS = 20000;

interface Line { from: string; to: string; baseRate?: number | null; weekendRate?: number | null; adjustPct?: number | null; minStay?: number | null; stopSell?: boolean }
type Change = { unitId: string; channel: string; nights: number; oldMin: number; oldMax: number; newMin: number; newMax: number };

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
 *  - weekendRate (sen, with baseRate only): Friday and Saturday nights take this web price instead of baseRate.
 *  - minStay (1-60, or null to clear) and stopSell (true/false): the unit's restrictions for those nights.
 *  - dryRun: nothing is written or queued; `changes` says, per unit and channel, the lowest and highest price
 *    before and after, so the screen can show old -> new before anyone saves. A real save returns them too.
 *  - batch: an id the Calendar gives every request of one bulk change it splits up, kept in the audit entry.
 *  At most MAX_ROWS price rows (units x nights x channels) per request.
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

  const dryRun = b.dryRun === true;
  const batch = typeof b.batch === 'string' && /^[\w-]{1,64}$/.test(b.batch) ? b.batch : null;
  const lines: Line[] = Array.isArray(b.lines) ? b.lines
    : [{ from: b.from, to: b.to, baseRate: b.baseRate ?? undefined, weekendRate: b.weekendRate ?? undefined, adjustPct: b.adjustPct ?? undefined, minStay: b.minStay, stopSell: b.stopSell }];
  if (!lines.length || lines.length > MAX_LINES) return fail('VALIDATION', `Add 1 to ${MAX_LINES} date ranges.`, 422);
  const fields: Fields = {};
  for (const [n, l] of lines.entries()) {
    checkDate(fields, `lines.${n}.from`, l?.from, { label: 'First night', required: true });
    checkDate(fields, `lines.${n}.to`, l?.to, { label: 'Last night', required: true });
  }
  const bad = invalid(fields); if (bad) return bad;
  for (const [n, l] of lines.entries()) {
    const at = lines.length > 1 ? ` (range ${n + 1})` : '';
    const hasRate = l.baseRate !== undefined && l.baseRate !== null, hasPct = l.adjustPct !== undefined && l.adjustPct !== null;
    const hasMinStay = l.minStay !== undefined, hasStopSell = typeof l.stopSell === 'boolean';
    if (!l.from || !l.to || l.to < l.from) return fail('VALIDATION', `Pick a valid date range${at}.`, 422);
    if (!hasRate && !hasPct && !hasMinStay && !hasStopSell) return fail('VALIDATION', `Set a price, minimum nights or blocked nights${at}.`, 422);
    if (hasRate && hasPct) return fail('VALIDATION', `Set a price or a percentage, not both${at}.`, 422);
    if ((hasRate || hasPct) && !channels.length) return fail('VALIDATION', 'Pick at least one channel for the price.', 422);
    if (hasRate && (!Number.isInteger(l.baseRate) || l.baseRate! <= 0)) return fail('VALIDATION', `The price must be a whole number of sen above zero${at}.`, 422, { baseRate: 'Enter a valid price.' });
    if (l.weekendRate !== undefined && l.weekendRate !== null) {
      if (!hasRate) return fail('VALIDATION', `A weekend price goes with a nightly price${at}.`, 422, { weekendRate: 'Set the nightly price too.' });
      if (!Number.isInteger(l.weekendRate) || l.weekendRate <= 0) return fail('VALIDATION', `The weekend price must be a whole number of sen above zero${at}.`, 422, { weekendRate: 'Enter a valid price.' });
    }
    if (hasPct && !(typeof l.adjustPct === 'number' && Number.isFinite(l.adjustPct) && l.adjustPct >= -90 && l.adjustPct <= 300)) return fail('VALIDATION', `The change must be between -90% and +300%${at}.`, 422, { adjustPct: 'Enter -90 to 300.' });
    if (hasMinStay && l.minStay !== null && !(Number.isInteger(l.minStay) && l.minStay! >= 1 && l.minStay! <= 60)) return fail('VALIDATION', `Minimum nights must be 1 to 60${at}.`, 422, { minStay: 'Enter 1 to 60 nights.' });
  }

  // Each range's nights, keeping only the chosen days of the week.
  const nightsOf = lines.map(l => {
    const out: string[] = [];
    for (let d = l.from, k = 0; d <= l.to && k < MAX_NIGHTS; d = addDay(d), k++) if (!weekdays || weekdays.has(weekdayOf(d))) out.push(d);
    return out;
  });
  if (nightsOf.every(n => !n.length)) return fail('VALIDATION', 'None of those dates fall on the chosen days of the week.', 422, { weekdays: 'No matching nights.' });
  const pricedNights = nightsOf.reduce((k, n, i) => k + ((lines[i].baseRate ?? lines[i].adjustPct) != null ? n.length : 0), 0);
  if (unitIds.length * pricedNights * channels.length > MAX_ROWS) {
    return fail('TOO_LARGE', `That is more than ${MAX_ROWS.toLocaleString('en')} prices in one go. Send fewer units or a shorter range at a time.`, 413);
  }

  const idsJson = JSON.stringify(unitIds);
  const [units, savedUplifts, connected] = await Promise.all([
    all<{ id: string; base_rate: number; weekend_rate: number | null }>(env, 'SELECT id, base_rate, weekend_rate FROM units WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', idsJson),
    all<{ unit_id: string; channel: string; uplift: number }>(env, 'SELECT unit_id, channel, uplift FROM channel_uplifts WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', idsJson),
    all<{ unit_id: string; ota: string }>(env, 'SELECT unit_id, ota FROM channex_channels WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', idsJson),
  ]);
  if (units.length !== unitIds.length) return fail('NOT_FOUND', 'One of those units does not exist.', 404);
  const anyPrice = lines.some(l => (l.baseRate ?? l.adjustPct) != null);
  const allNights = nightsOf.flat().sort();
  // The nights' own prices: a percentage moves the current web price, which may be one set by hand for that night,
  // and every change is reported (and audited) as old -> new.
  const setBefore = anyPrice && allNights.length ? new Map((await all<{ unit_id: string; channel: string; rate_date: string; rate: number }>(env,
    `SELECT unit_id, channel, rate_date, rate FROM channel_rates WHERE rate_date BETWEEN ? AND ? AND unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
       AND channel IN (SELECT jsonb_array_elements_text(?::text::jsonb))`,
    allNights[0], allNights[allNights.length - 1], idsJson, JSON.stringify(channels))).map(r => [`${r.unit_id}:${r.channel}:${r.rate_date}`, Number(r.rate)])) : new Map<string, number>();
  const changes: Change[] = [];

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
            const current = setBefore.get(`${u.id}:web:${date}`) ?? webRate(Number(u.base_rate), u.weekend_rate, date);
            return Math.max(100, Math.round(current * (1 + l.adjustPct! / 100) / 100) * 100);
          }
          if (l.weekendRate != null) return webRate(l.baseRate!, l.weekendRate, date);
          return standard ? webRate(l.baseRate!, u.weekend_rate, date) : l.baseRate!;
        };
        const rows = mine.flatMap(channel => days.map(date => {
          const web = webOn(date);
          return { channel, date, rate: web + upliftFor(channel, web, saved(channel)) };
        }));
        for (const channel of mine) {
          const mineRows = rows.filter(r => r.channel === channel);
          let c = changes.find(x => x.unitId === u.id && x.channel === channel);
          if (!c) { c = { unitId: u.id, channel, nights: 0, oldMin: Infinity, oldMax: -Infinity, newMin: Infinity, newMax: -Infinity }; changes.push(c); }
          for (const r of mineRows) {
            const old = setBefore.get(`${u.id}:${channel}:${r.date}`) ?? standardRate(channel, Number(u.base_rate), u.weekend_rate, saved(channel), r.date);
            c.nights++;
            c.oldMin = Math.min(c.oldMin, old); c.oldMax = Math.max(c.oldMax, old);
            c.newMin = Math.min(c.newMin, r.rate); c.newMax = Math.max(c.newMax, r.rate);
          }
        }
        written += rows.length;
        if (dryRun) continue;
        await run(env, `
          INSERT INTO channel_rates (unit_id, channel, rate_date, rate, updated_at)
          SELECT ?, channel, date, rate, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(channel text, date text, rate int)
          ON CONFLICT (unit_id, channel, rate_date) DO UPDATE SET rate = excluded.rate, updated_at = excluded.updated_at`,
          u.id, now, JSON.stringify(rows));
        toSync.push(...rows);
      }
      if ((hasMinStay || hasStopSell) && !dryRun) {
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

    if (dryRun) continue;
    // Channex: everything for the unit is queued together and leaves as one call (channexQueue.ts). A run of
    // consecutive nights at one price is one range. Nothing here can undo the save above.
    try {
      const queued: Parameters<typeof enqueueRestrictionsMany>[2] = [];
      for (const channel of mine) {
        const nights = toSync.filter(r => r.channel === channel).sort((x, y) => x.date.localeCompare(y.date));
        let i = 0;
        while (i < nights.length) {
          let j = i;
          while (j + 1 < nights.length && nights[j + 1].rate === nights[i].rate && nights[j + 1].date === addDay(nights[j].date)) j++;
          queued.push({ dateFrom: nights[i].date, dateTo: nights[j].date, r: { rateSen: nights[i].rate }, channel: channel as SalesChannel });
          i = j + 1;
        }
      }
      for (const r of restrictions) {
        for (const span of runsOf(r.days)) {
          // Clearing a minimum stay means one night again, as far as the channels are concerned.
          queued.push({ dateFrom: span[0], dateTo: span[span.length - 1], r: {
            ...(r.minStay !== undefined ? { minStay: r.minStay ?? 1 } : {}), ...(r.stopSell !== undefined ? { stopSell: r.stopSell } : {}),
          } });
        }
      }
      // One insert per unit: a year of weekend prices is about 100 ranges per channel.
      await enqueueRestrictionsMany(env, u.id, queued);
    } catch (e) {
      syncFailed.push(u.id);
      // vocab-ok: stored History actor name, the same one every Channex writer records
      await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.enqueue_failed', entityTable: 'units', entityId: u.id, after: { source: 'rates.bulk', error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
    }
  }
  const nights = nightsOf.reduce((k, n) => k + n.length, 0);
  if (dryRun) return json({ ok: true, dryRun: true, written: 0, rows: written, nights, skipped, changes });
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'rate.bulk', entityTable: 'units', entityId: batch ? `bulk:${batch}` : 'bulk',
    before: changes.length ? { prices: changes.map(c => ({ unitId: c.unitId, channel: c.channel, min: c.oldMin, max: c.oldMax })) } : undefined,
    after: { units: unitIds.length, unitIds, channels, weekdays: weekdays ? [...weekdays] : null, standard, skipped, lines, batch,
      prices: changes.map(c => ({ unitId: c.unitId, channel: c.channel, nights: c.nights, min: c.newMin, max: c.newMax })) },
  });
  return json({ ok: true, written, nights, skipped, syncFailed: syncFailed.length, changes });
};

