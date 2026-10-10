import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { syncRateIfLinked } from '../../_lib/channexSync';
import { queueFullSync } from '../../_lib/channexQueue';
import type { SalesChannel } from '../../_lib/channelPrice';

const CHANNELS = ['web', 'airbnb', 'booking_com', 'agoda'];
const OTAS = ['airbnb', 'booking_com', 'agoda'];
const rateChannel = (c: string) => (c === 'direct' ? 'web' : c);
const whole = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;

/** PUT /api/rates — one of:
 *    { unitId, channel, date, rate }   the price of one night on one channel
 *    { unitId, baseRate }              the unit's base web rate
 *    { unitId, weekendRate }           the unit's web rate on Friday and Saturday nights (null: the base rate)
 *    { unitId, costFloor }             the internal nightly cost floor
 *    { unitId, channel, uplift }       what a channel adds on top of the base rate
 *  All money is integer sen. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage && session.role !== 'operations_manager') return fail('FORBIDDEN', 'Only finance, operations managers and management can set rates.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!b?.unitId) return fail('VALIDATION', 'Say which unit.', 422);
  const unit = await one<{ id: string; base_rate: number; weekend_rate: number | null; cost_floor: number }>(env, 'SELECT id, base_rate, weekend_rate, cost_floor FROM units WHERE id = ?', b.unitId);
  if (!unit) return fail('NOT_FOUND', 'That unit does not exist.', 404);
  const now = nowIso();
  const done = (action: string, before: unknown, after: unknown) =>
    audit(env, { actorId: session.userId, actorLabel: session.fullName, action, entityTable: 'units', entityId: unit.id, before, after });

  if (b.baseRate !== undefined) {
    if (!whole(b.baseRate) || b.baseRate <= 0) return fail('VALIDATION', 'Enter a nightly rate above RM 0.00.', 422, { baseRate: 'Enter a rate above RM 0.00.' });
    await run(env, 'UPDATE units SET base_rate = ?, updated_at = ? WHERE id = ?', b.baseRate, now, unit.id);
    await done('pricing.base_rate', { baseRate: Number(unit.base_rate) }, { baseRate: b.baseRate });
    // Every night without its own price is sold at the base price, so a linked unit's whole price range is
    // queued again. Queue trouble is audited and never fails the save.
    try { await queueFullSync(env, [unit.id], { pricesOnly: true }); }
    catch (e) { await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.enqueue_failed', entityTable: 'units', entityId: unit.id, after: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {}); }
    return json({ ok: true });
  }
  if (b.weekendRate !== undefined) {
    if (b.weekendRate !== null && (!whole(b.weekendRate) || b.weekendRate <= 0)) return fail('VALIDATION', 'Enter a weekend rate above RM 0.00, or clear it to use the base rate.', 422, { weekendRate: 'Enter a rate above RM 0.00.' });
    await run(env, 'UPDATE units SET weekend_rate = ?, updated_at = ? WHERE id = ?', b.weekendRate, now, unit.id);
    await done('pricing.weekend_rate', { weekendRate: unit.weekend_rate == null ? null : Number(unit.weekend_rate) }, { weekendRate: b.weekendRate });
    // Every Friday and Saturday without its own price moves, on every channel.
    try { await queueFullSync(env, [unit.id], { pricesOnly: true }); }
    catch (e) { await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.enqueue_failed', entityTable: 'units', entityId: unit.id, after: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {}); }
    return json({ ok: true });
  }
  if (b.costFloor !== undefined) {
    if (!whole(b.costFloor)) return fail('VALIDATION', 'Enter the cost floor in whole sen.', 422, { costFloor: 'Enter a valid amount.' });
    await run(env, 'UPDATE units SET cost_floor = ?, updated_at = ? WHERE id = ?', b.costFloor, now, unit.id);
    await done('pricing.cost_floor', { costFloor: Number(unit.cost_floor) }, { costFloor: b.costFloor });
    return json({ ok: true });
  }
  if (b.uplift !== undefined) {
    if (!OTAS.includes(b.channel)) return fail('VALIDATION', 'Pick a sales channel.', 422, { channel: 'Pick a channel.' });
    if (!whole(b.uplift)) return fail('VALIDATION', 'Enter the uplift in whole sen.', 422, { uplift: 'Enter a valid amount.' });
    await run(env, `
      INSERT INTO channel_uplifts (unit_id, channel, uplift, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (unit_id, channel) DO UPDATE SET uplift = excluded.uplift, updated_at = excluded.updated_at`, unit.id, b.channel, b.uplift, now);
    await done('pricing.uplift', null, { channel: b.channel, uplift: b.uplift });
    // The uplift changes that channel's standard price on every night without its own price.
    try { await queueFullSync(env, [unit.id], { pricesOnly: true }); }
    catch (e) { await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.enqueue_failed', entityTable: 'units', entityId: unit.id, after: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {}); }
    return json({ ok: true });
  }

  const channel = rateChannel(String(b.channel ?? ''));
  if (!b.date || !CHANNELS.includes(channel)) return fail('VALIDATION', 'Unit, channel and date are required.', 422);
  if (!whole(b.rate)) return fail('VALIDATION', 'The rate must be a whole number of sen.', 422, { rate: 'Enter a valid rate.' });
  await run(env, `
    INSERT INTO channel_rates (unit_id, channel, rate_date, rate, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (unit_id, channel, rate_date) DO UPDATE SET rate = excluded.rate, updated_at = excluded.updated_at`,
    unit.id, channel, b.date, b.rate, now);
  await done('rate.set', null, { channel, date: b.date, rate: b.rate });
  // Each channel has its own rate plan in Channex, so the night's price goes to that channel's plan.
  // The price is saved whatever Channex does: queue trouble is audited and never fails the save.
  let sync: 'queued' | 'failed' = 'queued';
  try { await syncRateIfLinked(env, unit.id, b.date, b.rate, b.date, channel as SalesChannel); }
  catch (e) {
    sync = 'failed';
    await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.enqueue_failed', entityTable: 'units', entityId: unit.id, after: { channel, date: b.date, error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
  }
  return json({ ok: true, sync });
};
