import { type Env, one, all, run, audit, nowIso } from './db';
import { channexConfigured, channexSendAri } from './channex';
import { channexMappingFor } from './channexSync';
import { standardRate, type SalesChannel } from './channelPrice';
import { rentalOnly } from './unitPurpose';

/**
 * The Channex outbox. Save handlers never call Channex: they enqueue the change here (enqueue*),
 * and flushChannexQueue sends everything due as ONE /availability call and ONE /restrictions call per property.
 * The middleware schedules a flush a few seconds after every write, so several edits made together
 * leave in the same call, and the cron worker flushes every minute to pick up retries.
 *
 * Rate limit: Channex allows 10 availability + 10 restriction calls per minute per property
 * (20 ARI/min), and one call may only touch one property. Every call is logged in channex_calls
 * and a property that has used its budget in the last 60 seconds keeps its rows queued. 429, 5xx and network errors go back to
 * the queue with exponential backoff; any other refusal is marked failed and audited.
 */

const CALLS_PER_KIND_PER_MINUTE = 10;
const CLAIM_LEASE_MS = 2 * 60_000;            // a 'sending' row not finished by then is claimed again
const MAX_BACKOFF_MS = 30 * 60_000;
const FULL_SYNC_DAYS = 500;
const SENT_KEPT_MS = 3 * 864e5;
const CALLS_KEPT_MS = 30 * 864e5;

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

/** Wraps the whole enqueue, lookups included: a queue problem is audited and never fails the save that triggered it. */
async function guarded(env: Env, unitId: string, action: string, body: () => Promise<void>) {
  try {
    if (!channexConfigured(env)) return;
    await body();
  } catch (e) {
    await audit(env, { actorId: null, actorLabel: 'Channex', action, entityTable: 'units', entityId: unitId, after: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
  }
}

/** Queue "this unit can / cannot be booked" for [dateFrom, dateTo] inclusive. */
export function enqueueAvailability(env: Env, unitId: string, dateFrom: string, dateTo: string, availability: number): Promise<void> {
  return guarded(env, unitId, 'channex.enqueue_failed', async () => {
    if (dateTo < dateFrom) return;
    const m = await channexMappingFor(env, unitId);
    if (!m) return;
    const now = nowIso();
    await run(env, `INSERT INTO channex_outbox (id, kind, unit_id, property_id, room_type_id, date_from, date_to, availability, next_attempt_at, created_at)
      VALUES (?, 'availability', ?, ?, ?, ?, ?, ?, ?, ?)`, crypto.randomUUID(), unitId, m.propertyId, m.roomTypeId, dateFrom, dateTo, availability, now, now);
  });
}

/** Queue a price and/or restriction for [dateFrom, dateTo] inclusive. Only the fields given are sent.
 *  A price belongs to one sales channel and goes to that channel's rate plan (skipped if the unit has
 *  none yet); a minimum stay or stop sell on its own applies to the unit, so it goes to every plan. */
export function enqueueRestrictions(env: Env, unitId: string, dateFrom: string, dateTo: string, r: { rateSen?: number; minStay?: number; stopSell?: boolean }, channel: SalesChannel = 'web'): Promise<void> {
  return guarded(env, unitId, 'channex.enqueue_failed', async () => {
    if (dateTo < dateFrom || (r.rateSen === undefined && r.minStay === undefined && r.stopSell === undefined)) return;
    const m = await channexMappingFor(env, unitId);
    if (!m) return;
    const plans = r.rateSen !== undefined ? [m.ratePlans[channel]].filter((x): x is string => !!x) : Object.values(m.ratePlans);
    const now = nowIso();
    for (const planId of plans) {
      await run(env, `INSERT INTO channex_outbox (id, kind, unit_id, property_id, rate_plan_id, date_from, date_to, rate, min_stay, stop_sell, next_attempt_at, created_at)
        VALUES (?, 'restrictions', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, crypto.randomUUID(), unitId, m.propertyId, planId, dateFrom, dateTo,
        r.rateSen === undefined || r.rateSen <= 0 ? null : Math.round(r.rateSen) / 100, r.minStay ?? null, r.stopSell ?? null, now, now);
    }
  });
}

/** Many enqueueRestrictions for one unit in two queries: its mapping, then one insert. A year of weekend prices is
 *  about 100 ranges per channel, and enqueueing them one by one took two queries each (6,300 queries and two
 *  minutes for 10 units on the Pricing screen's bulk update). Same rows as calling enqueueRestrictions per item. */
export function enqueueRestrictionsMany(env: Env, unitId: string, items: { dateFrom: string; dateTo: string; r: { rateSen?: number; minStay?: number; stopSell?: boolean }; channel?: SalesChannel }[]): Promise<void> {
  return guarded(env, unitId, 'channex.enqueue_failed', async () => {
    const wanted = items.filter(x => x.dateTo >= x.dateFrom && (x.r.rateSen !== undefined || x.r.minStay !== undefined || x.r.stopSell !== undefined));
    if (!wanted.length) return;
    const m = await channexMappingFor(env, unitId);
    if (!m) return;
    const now = nowIso();
    const rows = wanted.flatMap(({ dateFrom, dateTo, r, channel = 'web' }) =>
      (r.rateSen !== undefined ? [m.ratePlans[channel]].filter((x): x is string => !!x) : Object.values(m.ratePlans)).map(planId => ({
        id: crypto.randomUUID(), rate_plan_id: planId, date_from: dateFrom, date_to: dateTo,
        rate: r.rateSen === undefined || r.rateSen <= 0 ? null : Math.round(r.rateSen) / 100, min_stay: r.minStay ?? null, stop_sell: r.stopSell ?? null,
      })));
    if (!rows.length) return;
    await run(env, `INSERT INTO channex_outbox (id, kind, unit_id, property_id, rate_plan_id, date_from, date_to, rate, min_stay, stop_sell, next_attempt_at, created_at)
      SELECT x.id, 'restrictions', ?, ?, x.rate_plan_id, x.date_from, x.date_to, x.rate, x.min_stay, x.stop_sell, ?, ?
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, rate_plan_id text, date_from text, date_to text, rate numeric, min_stay int, stop_sell boolean)`,
      unitId, m.propertyId, now, now, JSON.stringify(rows));
  });
}

interface OutboxRow {
  id: string; kind: 'availability' | 'restrictions'; unit_id: string; property_id: string; room_type_id: string | null; rate_plan_id: string | null;
  date_from: string; date_to: string; availability: number | null; rate: string | number | null; min_stay: number | null; stop_sell: boolean | null; attempts: number;
}

/** Merge rows for the same target and range, later edits winning field by field, keeping first-seen order. */
function coalesce(rows: OutboxRow[]): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const key = r.kind === 'availability' ? `${r.room_type_id}|${r.date_from}|${r.date_to}` : `${r.rate_plan_id}|${r.date_from}|${r.date_to}`;
    const v = byKey.get(key) ?? (r.kind === 'availability'
      ? { property_id: r.property_id, room_type_id: r.room_type_id, date_from: r.date_from, date_to: r.date_to }
      : { property_id: r.property_id, rate_plan_id: r.rate_plan_id, date_from: r.date_from, date_to: r.date_to });
    if (r.kind === 'availability') v.availability = r.availability;
    else {
      if (r.rate !== null) v.rate = Number(r.rate).toFixed(2);   // a bare number is read by Channex as minor units
      if (r.min_stay !== null) { v.min_stay_arrival = r.min_stay; v.min_stay_through = r.min_stay; }
      if (r.stop_sell !== null) v.stop_sell = r.stop_sell;
    }
    byKey.delete(key);            // re-insert so a later edit to the same range is applied after overlapping ones
    byKey.set(key, v);
  }
  return [...byKey.values()];
}

export interface CallResult { status: number; taskId: string | null; rows: number }
export interface FlushResult { availability?: CallResult; restrictions?: CallResult; calls: ({ kind: string; propertyId: string } & CallResult)[] }

const idList = (ids: string[]) => JSON.stringify(ids);
const ID_IN = 'id IN (SELECT jsonb_array_elements_text(?::text::jsonb))';

/**
 * Sends everything due. Channex refuses a call that touches more than one property, and limits each
 * property to 10 calls per kind per minute, so due rows are grouped by property: one availability call
 * and one restrictions call per property. A property over its budget has its rows put back for the
 * next flush. Safe to run concurrently — rows are claimed atomically.
 */
export async function flushChannexQueue(env: Env, opts: { fullSync?: boolean } = {}): Promise<FlushResult> {
  const result: FlushResult = { calls: [] };
  if (!channexConfigured(env)) return result;
  // Sent rows are only kept for looking back; the outbox would otherwise grow with every sync.
  await run(env, `DELETE FROM channex_outbox WHERE status = 'sent' AND sent_at < ?`, inMs(-SENT_KEPT_MS)).catch(() => {});
  await run(env, `DELETE FROM channex_calls WHERE called_at < ?`, inMs(-CALLS_KEPT_MS)).catch(() => {});

  // Anything still queued for a showroom or warehouse unit is dropped, never sent (owner, 17 Oct 2026).
  const rental = await rentalOnly(env, 'u');
  if (rental) await run(env, `DELETE FROM channex_outbox o USING units u WHERE u.id = o.unit_id AND u.purpose <> 'rental' AND o.status IN ('queued','sending','failed')`).catch(() => {});
  for (const kind of ['availability', 'restrictions'] as const) {
    const rows = await all<OutboxRow & { created_at: string }>(env, `
      UPDATE channex_outbox SET status = 'sending', next_attempt_at = ?
      WHERE id IN (
        SELECT id FROM channex_outbox
        WHERE kind = ? AND status IN ('queued','sending') AND next_attempt_at <= ?
        ORDER BY created_at LIMIT 5000 FOR UPDATE SKIP LOCKED)
      RETURNING id, kind, unit_id, property_id, room_type_id, rate_plan_id, date_from, date_to, availability, rate, min_stay, stop_sell, attempts, created_at`,
      inMs(CLAIM_LEASE_MS), kind, nowIso());
    if (!rows.length) continue;

    const byProperty = new Map<string, typeof rows>();
    for (const r of rows.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      byProperty.set(r.property_id, [...(byProperty.get(r.property_id) ?? []), r]);
    }

    for (const [propertyId, group] of byProperty) {
      const ids = group.map(r => r.id);
      const used = await one<{ n: number }>(env, `SELECT count(*)::int AS n FROM channex_calls WHERE property_id = ? AND kind = ? AND called_at > ?`, propertyId, kind, inMs(-60_000));
      if ((used?.n ?? 0) >= CALLS_PER_KIND_PER_MINUTE) {
        // Over this property's budget: hand the rows back untouched for the next flush.
        await run(env, `UPDATE channex_outbox SET status = 'queued', next_attempt_at = ? WHERE ${ID_IN}`, inMs(15_000), idList(ids));
        continue;
      }

      let status = 0, taskId: string | null = null, error: string | null = null;
      try {
        const res = await channexSendAri(env, kind, coalesce(group));
        status = res.status;
        taskId = res.body?.data?.[0]?.id ?? null;
        if (!res.ok) error = JSON.stringify(res.body ?? {}).slice(0, 500);
      } catch (e) { error = e instanceof Error ? e.message : String(e); }

      await run(env, `INSERT INTO channex_calls (id, kind, property_id, called_at, status, task_id, row_count, full_sync) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(), kind, propertyId, nowIso(), status, taskId, group.length, !!opts.fullSync);
      const call = { status, taskId, rows: group.length };
      result.calls.push({ kind, propertyId, ...call });
      // The per-kind summary reports the worst outcome, so a caller sees any failure.
      if (!result[kind] || !(status >= 200 && status < 300)) result[kind] = call;

      if (status >= 200 && status < 300) {
        await run(env, `UPDATE channex_outbox SET status = 'sent', sent_at = ?, task_id = ?, last_status = ?, last_error = NULL WHERE ${ID_IN}`, nowIso(), taskId, status, idList(ids));
      } else if (status === 0 || status === 429 || status >= 500) {
        // Backoff grows with the worst attempt count in the batch: 30s, 60s, 2m, ... capped at 30m.
        const attempts = Math.max(...group.map(r => r.attempts)) + 1;
        const wait = Math.min(MAX_BACKOFF_MS, 30_000 * 2 ** (attempts - 1));
        await run(env, `UPDATE channex_outbox SET status = 'queued', attempts = attempts + 1, next_attempt_at = ?, last_status = ?, last_error = ? WHERE ${ID_IN}`, inMs(wait), status, error, idList(ids));
      } else {
        await run(env, `UPDATE channex_outbox SET status = 'failed', attempts = attempts + 1, last_status = ?, last_error = ? WHERE ${ID_IN}`, status, error, idList(ids));
        await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.push_failed', entityTable: 'channex_outbox', entityId: ids[0], after: { kind, propertyId, status, rows: group.length, error } });
      }
    }
  }
  return result;
}

const QUIET_MS = 15_000;

/**
 * Called by the middleware after every write, once a delay a little longer than QUIET_MS has passed.
 * Sends only when nothing new has been queued for QUIET_MS, so a burst of edits leaves as one call:
 * each edit schedules its own attempt, and only the one after the last edit finds the queue quiet.
 */
export async function flushWhenQuiet(env: Env): Promise<void> {
  if (!(await channexQueueHasDue(env))) return;
  const newest = await one<{ at: string | null }>(env, `SELECT max(created_at) AS at FROM channex_outbox WHERE status = 'queued'`);
  if (newest?.at && Date.parse(newest.at) > Date.now() - QUIET_MS) return;
  await flushChannexQueue(env);
}
export const FLUSH_DELAY_MS = QUIET_MS + 1_000;

/** True when something is due, so the middleware can skip the flush entirely on most requests. */
export async function channexQueueHasDue(env: Env): Promise<boolean> {
  if (!channexConfigured(env)) return false;
  return !!(await one(env, `SELECT 1 AS x FROM channex_outbox WHERE status IN ('queued','sending') AND next_attempt_at <= ? LIMIT 1`, nowIso()));
}

// Lists go to Postgres as JSON text (?::text::jsonb): the driver runs with fetch_types off, so it cannot send arrays,
// and a bare ?::jsonb makes it encode the string a second time.

/** Runs of consecutive nights with an equal value, as inclusive [from, to] ranges. */
function runs<T>(dates: string[], valueOf: (d: string) => T, same: (a: T, b: T) => boolean) {
  const out: { from: string; to: string; value: T }[] = [];
  for (const d of dates) {
    const v = valueOf(d);
    const last = out[out.length - 1];
    if (last && same(last.value, v)) last.to = d; else out.push({ from: d, to: d, value: v });
  }
  return out;
}

/**
 * Full sync: 500 days of availability, prices and restrictions for every linked unit (or the given
 * ones), built from Conts's own data. Anything already queued for those units is superseded. The
 * flush that follows sends it as exactly two calls — one availability, one restrictions.
 */
export async function queueFullSync(env: Env, unitIds?: string[], opts: { pricesOnly?: boolean } = {}): Promise<{ units: number }> {
  if (!channexConfigured(env)) return { units: 0 };
  const rental = await rentalOnly(env, 'units');
  const units = await all<{ id: string; base_rate: number; weekend_rate: number | null; channex_property_id: string; channex_room_type_id: string; channex_rate_plan_id: string; channex_rate_plan_airbnb: string | null; channex_rate_plan_booking_com: string | null; channex_rate_plan_agoda: string | null }>(env, `
    SELECT id, base_rate, weekend_rate, channex_property_id, channex_room_type_id, channex_rate_plan_id, channex_rate_plan_airbnb, channex_rate_plan_booking_com, channex_rate_plan_agoda FROM units
    WHERE channex_property_id IS NOT NULL AND channex_room_type_id IS NOT NULL AND channex_rate_plan_id IS NOT NULL${rental}
      ${unitIds ? 'AND id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : ''}`, ...(unitIds ? [JSON.stringify(unitIds)] : []));
  if (!units.length) return { units: 0 };

  const today = (await one<{ d: string }>(env, `SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS d`))!.d;
  const last = addDays(today, FULL_SYNC_DAYS - 1);
  const dates: string[] = [];
  for (let i = 0; i < FULL_SYNC_DAYS; i++) dates.push(addDays(today, i));
  const ids = units.map(u => u.id);

  // An inquiry holds no nights (owner, 11 Oct 2026: inquiries are not managed here; the channels handle them).
  const stays = await all<{ unit_id: string; check_in: string; check_out: string }>(env, `
    SELECT unit_id, check_in, check_out FROM reservations
    WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND state IN ('pending','confirmed','checked_in') AND check_out > ? AND check_in <= ?`, JSON.stringify(ids), today, last);
  const rates = await all<{ unit_id: string; channel: string; rate_date: string; rate: number }>(env, `
    SELECT unit_id, channel, rate_date, rate FROM channel_rates WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND rate_date BETWEEN ? AND ?`, JSON.stringify(ids), today, last);
  const uplifts = await all<{ unit_id: string; channel: string; uplift: number }>(env, `
    SELECT unit_id, channel, uplift FROM channel_uplifts WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(ids));
  const restr = await all<{ unit_id: string; rate_date: string; min_stay: number | null; stop_sell: boolean }>(env, `
    SELECT unit_id, rate_date, min_stay, stop_sell FROM unit_restrictions WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND rate_date BETWEEN ? AND ?`, JSON.stringify(ids), today, last);

  await run(env, `DELETE FROM channex_outbox WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND status IN ('queued','failed')${opts.pricesOnly ? " AND kind = 'restrictions'" : ''}`, JSON.stringify(ids));
  const now = nowIso();
  const avail: Record<string, unknown>[] = [], restrictions: Record<string, unknown>[] = [];
  for (const u of units) {
    const taken = new Set<string>();
    for (const s of stays.filter(s => s.unit_id === u.id)) for (let d = s.check_in; d < s.check_out; d = addDays(d, 1)) taken.add(d);
    const resOn = new Map(restr.filter(r => r.unit_id === u.id).map(r => [r.rate_date, r]));

    for (const a of runs(dates, d => (taken.has(d) ? 0 : 1), (x, y) => x === y)) {
      avail.push({ id: crypto.randomUUID(), unit_id: u.id, property_id: u.channex_property_id, room_type_id: u.channex_room_type_id, date_from: a.from, date_to: a.to, availability: a.value });
    }
    // Each rate plan carries its own channel's price: the night's own price if set, else the standard one.
    const plans: [SalesChannel, string | null][] = [['web', u.channex_rate_plan_id], ['airbnb', u.channex_rate_plan_airbnb], ['booking_com', u.channex_rate_plan_booking_com], ['agoda', u.channex_rate_plan_agoda]];
    for (const [channel, planId] of plans) {
      if (!planId) continue;
      const rateOn = new Map(rates.filter(r => r.unit_id === u.id && r.channel === channel).map(r => [r.rate_date, Number(r.rate)]));
      const savedUplift = uplifts.find(x => x.unit_id === u.id && x.channel === channel)?.uplift;
      const night = (d: string) => ({ rate: rateOn.get(d) ?? standardRate(channel, Number(u.base_rate), u.weekend_rate, savedUplift, d), minStay: resOn.get(d)?.min_stay ?? 1, stopSell: !!resOn.get(d)?.stop_sell });
      for (const r of runs(dates, night, (x, y) => x.rate === y.rate && x.minStay === y.minStay && x.stopSell === y.stopSell)) {
        restrictions.push({ id: crypto.randomUUID(), unit_id: u.id, property_id: u.channex_property_id, rate_plan_id: planId, date_from: r.from, date_to: r.to, rate: r.value.rate > 0 ? r.value.rate / 100 : null, min_stay: r.value.minStay, stop_sell: r.value.stopSell });   // never a zero price: Channex discards it
      }
    }
  }
  // One insert per kind, whatever the number of ranges. `pricesOnly` (a base price change) leaves availability alone.
  if (!opts.pricesOnly) await run(env, `INSERT INTO channex_outbox (id, kind, unit_id, property_id, room_type_id, date_from, date_to, availability, next_attempt_at, created_at)
    SELECT id, 'availability', unit_id, property_id, room_type_id, date_from, date_to, availability, ?, ?
    FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, unit_id text, property_id text, room_type_id text, date_from text, date_to text, availability int)`, now, now, JSON.stringify(avail));
  await run(env, `INSERT INTO channex_outbox (id, kind, unit_id, property_id, rate_plan_id, date_from, date_to, rate, min_stay, stop_sell, next_attempt_at, created_at)
    SELECT id, 'restrictions', unit_id, property_id, rate_plan_id, date_from, date_to, rate, min_stay, stop_sell, ?, ?
    FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, unit_id text, property_id text, rate_plan_id text, date_from text, date_to text, rate numeric, min_stay int, stop_sell boolean)`, now, now, JSON.stringify(restrictions));
  return { units: units.length };
}
