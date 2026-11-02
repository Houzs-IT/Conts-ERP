import { type Env, one, run, json, fail, audit, nowIso, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { syncRateIfLinked } from '../../_lib/channexSync';
import { queueFullSync } from '../../_lib/channexQueue';
import type { ChannelRule, OtaChannel, SalesChannel } from '../../_lib/channelPrice';
import { loadPricing, pricingReady } from '../../_lib/unitPricing';
import { applyOps, checkOps, diffSettings, gridOf, saveSettings, settingsOf, type Op } from '../../_lib/pricingEdit';
import { checkDate, invalid, type Fields } from '../../_lib/validate';
import { purposeOf } from '../../_lib/unitPurpose';

const CHANNELS = ['web', 'airbnb', 'booking_com', 'agoda'];
const OTAS = ['airbnb', 'booking_com', 'agoda'];
const rateChannel = (c: string) => (c === 'direct' ? 'web' : c);
const whole = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;

/** PUT /api/rates — one of:
 *    { unitId, channel, date, rate }   the price of one night on one channel
 *    { unitId, baseRate }              the unit's base web rate
 *    { unitId, weekendRate }           the unit's web rate on Friday and Saturday nights (null: the base rate)
 *    { unitId, costFloor }             the internal nightly cost floor
 *    { unitId, channel, uplift }       what a channel adds on top of the direct price (RM above it)
 *    { unitId, holidayRate }           the unit's direct price on a public holiday night (null: weekend or nightly price)
 *    { unitId, holidayEve }            whether the night before a holiday takes the holiday price too
 *    { unitId, rule: { channel, mode, percent? | uplift? | fixedBase?, fixedWeekend?, fixedHoliday? } }
 *                                      how a channel is priced: 'default' share, 'amount' (sen) or 'percent' above the
 *                                      direct price, or 'fixed' prices of its own per level (channelPrice.ts)
 *  All money is integer sen. Any price change queues the unit's prices for Channex; that never fails the save. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only people with Full Performance access can set rates.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!b?.unitId) return fail('VALIDATION', 'Say which unit.', 422);
  const unit = await one<{ id: string; base_rate: number; weekend_rate: number | null; cost_floor: number }>(env, 'SELECT id, base_rate, weekend_rate, cost_floor FROM units WHERE id = ?', b.unitId);
  if (!unit) return fail('NOT_FOUND', 'That unit does not exist.', 404);
  if ((await purposeOf(env, unit.id)) !== 'rental') return fail('NOT_RENTAL', 'Showroom and warehouse units are not priced or sold on the channels.', 409);
  const now = nowIso();
  const done = (action: string, before: unknown, after: unknown) =>
    audit(env, { actorId: session.userId, actorLabel: session.fullName, action, entityTable: 'units', entityId: unit.id, before, after });

  if (b.baseRate !== undefined) {
    if (!whole(b.baseRate) || b.baseRate <= 0) return fail('VALIDATION', 'Enter a nightly price above RM 0.00.', 422, { baseRate: 'Enter a price above RM 0.00.' });
    await run(env, 'UPDATE units SET base_rate = ?, updated_at = ? WHERE id = ?', b.baseRate, now, unit.id);
    await done('pricing.base_rate', { baseRate: Number(unit.base_rate) }, { baseRate: b.baseRate });
    // Every night without its own price is sold at the base price, so a linked unit's whole price range is
    // queued again. Queue trouble is audited and never fails the save.
    try { await queueFullSync(env, [unit.id], { pricesOnly: true }); }
    // vocab-ok: stored History actor name, the same one every Channex writer records
    catch (e) { await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.enqueue_failed', entityTable: 'units', entityId: unit.id, after: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {}); }
    return json({ ok: true });
  }
  if (b.weekendRate !== undefined) {
    if (b.weekendRate !== null && (!whole(b.weekendRate) || b.weekendRate <= 0)) return fail('VALIDATION', 'Enter a weekend price above RM 0.00, or clear it to use the nightly price.', 422, { weekendRate: 'Enter a price above RM 0.00.' });
    await run(env, 'UPDATE units SET weekend_rate = ?, updated_at = ? WHERE id = ?', b.weekendRate, now, unit.id);
    await done('pricing.weekend_rate', { weekendRate: unit.weekend_rate == null ? null : Number(unit.weekend_rate) }, { weekendRate: b.weekendRate });
    // Every Friday and Saturday without its own price moves, on every channel.
    try { await queueFullSync(env, [unit.id], { pricesOnly: true }); }
    // vocab-ok: stored History actor name, the same one every Channex writer records
    catch (e) { await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.enqueue_failed', entityTable: 'units', entityId: unit.id, after: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {}); }
    return json({ ok: true });
  }
  if (b.holidayRate !== undefined || b.holidayEve !== undefined || b.rule !== undefined) {
    if (!(await pricingReady(env))) return fail('NOT_MIGRATED', 'Holiday prices and % or fixed channel prices need a database update (migration 0202) first.', 503);
    const today = mytToday();
    const before = settingsOf((await loadPricing(env, [unit.id], today, today)).get(unit.id)!);
    const ops: Op[] = [];
    if (b.holidayRate !== undefined) {
      if (b.holidayRate !== null && !(whole(b.holidayRate) && b.holidayRate > 0)) return fail('VALIDATION', 'Enter a holiday price above RM 0.00, or clear it to use the weekend or nightly price.', 422, { holidayRate: 'Enter a price above RM 0.00.' });
      ops.push(b.holidayRate === null ? { channel: 'web', level: 'holiday', action: 'clear' } : { channel: 'web', level: 'holiday', action: 'set', value: b.holidayRate });
    }
    if (b.holidayEve !== undefined && typeof b.holidayEve !== 'boolean') return fail('VALIDATION', 'Say whether the night before a holiday takes the holiday price.', 422);
    let fixed: ChannelRule | null = null, channel: OtaChannel | null = null;
    if (b.rule !== undefined) {
      const r = b.rule ?? {};
      if (!OTAS.includes(r.channel)) return fail('VALIDATION', 'Pick a channel.', 422, { channel: 'Pick a channel.' });
      channel = r.channel as OtaChannel;
      if (r.mode === 'percent') ops.push({ channel, action: 'percent', value: r.percent });
      else if (r.mode === 'amount') ops.push({ channel, action: 'amount', value: r.uplift });
      else if (r.mode === 'default') ops.push({ channel, action: 'default' });
      else if (r.mode === 'fixed') {
        const ok = (v: unknown, req: boolean) => (v === null || v === undefined ? !req : whole(v) && (v as number) > 0);
        if (!ok(r.fixedBase, true)) return fail('VALIDATION', 'Enter the channel\'s nightly price above RM 0.00.', 422, { fixedBase: 'Enter a price above RM 0.00.' });
        if (!ok(r.fixedWeekend, false) || !ok(r.fixedHoliday, false)) return fail('VALIDATION', 'Enter prices above RM 0.00, or leave the weekend or holiday price empty.', 422);
        fixed = { mode: 'fixed', fixedBase: r.fixedBase, fixedWeekend: r.fixedWeekend ?? null, fixedHoliday: r.fixedHoliday ?? null };
      } else return fail('VALIDATION', 'Pick how the channel is priced.', 422, { mode: 'Pick one.' });
    }
    const badOps = ops.length ? checkOps(ops, b.holidayEve) : null;
    if (badOps) return fail('VALIDATION', badOps, 422);
    const applied = applyOps(before, ops, typeof b.holidayEve === 'boolean' ? b.holidayEve : undefined);
    if ('error' in applied) return fail('VALIDATION', applied.error, 422);
    const after = applied.next;
    if (fixed && channel) after.rules[channel] = fixed;
    await saveSettings(env, [{ unitId: unit.id, before, after }], now, true);
    const changes = diffSettings(before, after);
    await done('pricing.levels', { holidayRate: before.levels.holiday, holidayEve: before.levels.holidayEve, rules: changes.rules.map(r => ({ channel: r.channel, rule: r.from })) },
      { holidayRate: after.levels.holiday, holidayEve: after.levels.holidayEve, rules: changes.rules.map(r => ({ channel: r.channel, rule: r.to })), prices: changes.prices });
    // Holiday nights, or every night of a channel, may have moved: the unit's whole price range is queued again.
    try { await queueFullSync(env, [unit.id], { pricesOnly: true }); }
    // vocab-ok: stored History actor name, the same one every Channex writer records
    catch (e) { await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.enqueue_failed', entityTable: 'units', entityId: unit.id, after: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {}); }
    return json({ ok: true, levels: gridOf(after) });
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
    // An RM amount replaces whatever rule the channel had (a % or fixed prices, migration 0202).
    if (await pricingReady(env)) await run(env, `
      INSERT INTO channel_uplifts (unit_id, channel, uplift, mode, updated_at) VALUES (?, ?, ?, 'amount', ?)
      ON CONFLICT (unit_id, channel) DO UPDATE SET uplift = excluded.uplift, mode = 'amount', percent = NULL, fixed_base = NULL, fixed_weekend = NULL, fixed_holiday = NULL,
        updated_at = excluded.updated_at`, unit.id, b.channel, b.uplift, now);
    else await run(env, `
      INSERT INTO channel_uplifts (unit_id, channel, uplift, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (unit_id, channel) DO UPDATE SET uplift = excluded.uplift, updated_at = excluded.updated_at`, unit.id, b.channel, b.uplift, now);
    await done('pricing.uplift', null, { channel: b.channel, uplift: b.uplift });
    // The uplift changes that channel's standard price on every night without its own price.
    try { await queueFullSync(env, [unit.id], { pricesOnly: true }); }
    // vocab-ok: stored History actor name, the same one every Channex writer records
    catch (e) { await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.enqueue_failed', entityTable: 'units', entityId: unit.id, after: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {}); }
    return json({ ok: true });
  }

  const channel = rateChannel(String(b.channel ?? ''));
  if (!b.date || !CHANNELS.includes(channel)) return fail('VALIDATION', 'Unit, channel and date are required.', 422);
  const fields: Fields = {};
  checkDate(fields, 'date', b.date, { label: 'Night', required: true });
  const bad = invalid(fields); if (bad) return bad;
  if (!whole(b.rate)) return fail('VALIDATION', 'The price must be a whole number of sen.', 422, { rate: 'Enter a valid price.' });
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
    // vocab-ok: stored History actor name, the same one every Channex writer records
    await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.enqueue_failed', entityTable: 'units', entityId: unit.id, after: { channel, date: b.date, error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
  }
  return json({ ok: true, sync });
};
