import { type Env, all, json, fail, audit, nowIso, mytToday, transaction } from '../../_lib/db';
import { rentalOnly } from '../../_lib/unitPurpose';
import { requireSession } from '../../_lib/auth';
import { loadPricing, pricingReady } from '../../_lib/unitPricing';
import { applyOps, checkOps, diffSettings, gridOf, needsLevels, saveSettings, settingsOf, type Op } from '../../_lib/pricingEdit';
import { queueFullSync } from '../../_lib/channexQueue';

const MAX_UNITS = 500;

/** POST /api/pricing/batch { unitIds, ops: [{ channel, level?, action, value? }], holidayEve?, dryRun? }
 *  Changes the price levels and channel rules of many units at once (Pricing > Batch edit); pricingEdit.ts says what
 *  each action does. dryRun stores nothing and answers, per unit, every channel's price per level before and after and
 *  the lines that change, so the screen shows old -> new before anyone saves. A save stores every unit in one
 *  transaction (or none, when any unit cannot take the change), writes one History entry, and queues each changed
 *  unit's prices for Channex once; the queue never fails the save. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only people with Full access to Pricing can change prices.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!Array.isArray(b?.unitIds) || !b.unitIds.length || b.unitIds.some((u: unknown) => typeof u !== 'string' || !u)) return fail('VALIDATION', 'Pick at least one unit.', 422, { unitIds: 'Pick at least one unit.' });
  const unitIds = [...new Set(b.unitIds as string[])];
  if (unitIds.length > MAX_UNITS) return fail('VALIDATION', `Pick at most ${MAX_UNITS} units at a time.`, 422, { unitIds: 'Too many units.' });
  const bad = checkOps(b.ops, b.holidayEve);
  if (bad) return fail('VALIDATION', bad, 422, { ops: bad });
  const ops = b.ops as Op[];
  const holidayEve = typeof b.holidayEve === 'boolean' ? b.holidayEve : undefined;
  const dryRun = b.dryRun === true;

  const units = await all<{ id: string; unit_number: string; property_name: string }>(env, `
    SELECT u.id, u.unit_number, p.name AS property_name FROM units u JOIN properties p ON p.id = u.property_id
    WHERE u.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))${await rentalOnly(env, 'u')} ORDER BY p.name, u.unit_number`, JSON.stringify(unitIds));
  if (units.length !== unitIds.length) return fail('NOT_FOUND', 'One of those units does not exist, or is a showroom or warehouse (not priced).', 404);
  const ready = await pricingReady(env);
  const today = mytToday();
  const pricing = await loadPricing(env, unitIds, today, today);

  const results = units.map(u => {
    const before = settingsOf(pricing.get(u.id)!);
    const r = applyOps(before, ops, holidayEve);
    const base = { unitId: u.id, unitNumber: u.unit_number, propertyName: u.property_name, before: gridOf(before), holidayEveBefore: before.levels.holidayEve };
    if ('error' in r) return { ...base, error: r.error, after: null, changes: null, settings: null as null | { before: typeof before; after: typeof before } };
    if (!ready && needsLevels(r.next)) return { ...base, error: 'Holiday prices, % and fixed channel prices need a database update (migration 0202) first.', after: null, changes: null, settings: null };
    return { ...base, error: null as string | null, after: gridOf(r.next), holidayEveAfter: r.next.levels.holidayEve, changes: diffSettings(before, r.next), settings: { before, after: r.next } };
  });
  const changed = results.filter(r => r.changes && (r.changes.prices.length || r.changes.rules.length || r.changes.eve));
  const errors = results.filter(r => r.error);
  const view = results.map(({ settings, ...r }) => r);
  if (dryRun) return json({ ok: true, dryRun: true, units: view, changed: changed.length, errors: errors.length });
  if (errors.length) return fail('CANNOT_APPLY', `${errors.length} of ${results.length} units cannot take this change: ${errors[0].propertyName} ${errors[0].unitNumber}: ${errors[0].error}`, 422);
  if (!changed.length) return json({ ok: true, dryRun: false, units: view, changed: 0, errors: 0, queued: 0 });

  const now = nowIso();
  await transaction(env, tx => saveSettings(tx, changed.map(r => ({ unitId: r.unitId, before: r.settings!.before, after: r.settings!.after })), now, ready));
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'pricing.batch', entityTable: 'units', entityId: `batch:${changed.length}`,
    before: { units: changed.map(r => ({ unitId: r.unitId, prices: r.changes!.prices.map(p => ({ channel: p.channel, level: p.level, price: p.from })) })) },
    after: { ops, holidayEve: holidayEve ?? null, units: changed.map(r => ({ unitId: r.unitId, prices: r.changes!.prices.map(p => ({ channel: p.channel, level: p.level, price: p.to })), rules: r.changes!.rules, eve: r.changes!.eve })) },
  });
  // Every night without a custom price may have moved, so the changed units' whole price range is queued again,
  // in one go. Queue trouble is audited and never fails the save.
  let queued = 0;
  try { queued = (await queueFullSync(env, changed.map(r => r.unitId), { pricesOnly: true })).units; }
  // vocab-ok: stored History actor name, the same one every Channex writer records
  catch (e) { await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.enqueue_failed', entityTable: 'units', entityId: `batch:${changed.length}`, after: { source: 'pricing.batch', error: e instanceof Error ? e.message : String(e) } }).catch(() => {}); }
  return json({ ok: true, dryRun: false, units: view, changed: changed.length, errors: 0, queued });
};
