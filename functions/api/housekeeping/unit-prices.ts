import { type Env, all, one, run, json, fail, audit, nowIso, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole, hasColumn } from '../../_lib/auth';
import { hasCleanPrices, priceBook, layoutKey, PRICE_KINDS } from '../../_lib/cleaningPrices';
import { hasServicePrices, serviceBook, hasDatedUnitPrices, isDayStr, FROM_THE_START } from '../../_lib/servicePrices';

/** A unit's own prices that are not history: each item's row in force today (unless it means the list price) and every
 *  row still to come. The unit's Scheduled changes panel. */
async function unitChanges(env: Env, unitId: string) {
  const rows = await all<any>(env, `SELECT o.item_id, s.name, s.domain, s.clean_kind, o.effective_from, o.owner_price, o.internal_cost
    FROM unit_service_prices o JOIN service_items s ON s.id = o.item_id WHERE o.unit_id = ? ORDER BY o.effective_from DESC`, unitId);
  const today = mytToday(), seen = new Set<string>();
  return rows.filter(r => {
    if (r.effective_from > today) return true;
    if (seen.has(r.item_id)) return false;
    seen.add(r.item_id);
    return r.owner_price != null || r.internal_cost != null;
  }).map(r => ({ itemId: r.item_id, name: r.name, domain: r.domain, cleanKind: r.clean_kind, effectiveFrom: r.effective_from,
    ownerPrice: r.owner_price, internalCost: r.internal_cost, scheduled: r.effective_from > today }));
}

/** GET /api/housekeeping/unit-prices — every unit with its layout and, per clean type, the cleaner's pay and the charge
 *  per clean that apply today (its own override, else the price table), and where they come from. `?unitId=` answers for
 *  that one unit only (the unit's Details tab), and for management with its own prices now and to come. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Only the office sees cleaning prices.', 403);
  if (!(await hasCleanPrices(env))) return json({ ready: false, rows: [], mayEdit: false });
  const layout = (await hasColumn(env, 'units', 'layout_type').catch(() => false)) ? 'u.layout_type' : 'NULL::text';
  const only = new URL(request.url).searchParams.get('unitId');
  const units = await all<any>(env, `
    SELECT u.id, u.unit_number, u.bedrooms, ${layout} AS layout_type, p.id AS property_id, p.name AS property_name
    FROM units u JOIN properties p ON p.id = u.property_id ${only ? 'WHERE u.id = ?' : ''} ORDER BY p.name, u.unit_number`, ...(only ? [only] : []));
  // Since Service prices (0127) a unit's own figures are per item: the cleaning item of each clean type.
  const dated = await hasDatedUnitPrices(env);
  const own = (await hasServicePrices(env))
    ? await all<{ unit_id: string; kind: string; internal_cost: number | null; external_charge: number | null }>(env,
      `SELECT ${dated ? 'DISTINCT ON (o.unit_id, s.clean_kind)' : ''} o.unit_id, s.clean_kind AS kind, o.internal_cost, o.owner_price AS external_charge
       FROM unit_service_prices o JOIN service_items s ON s.id = o.item_id WHERE s.clean_kind IS NOT NULL AND s.active = 1
       ${dated ? 'AND o.effective_from <= ? ORDER BY o.unit_id, s.clean_kind, o.effective_from DESC' : ''}`, ...(dated ? [mytToday()] : []))
    : await all<{ unit_id: string; kind: string; internal_cost: number | null; external_charge: number | null }>(env,
      'SELECT unit_id, kind, internal_cost, external_charge FROM unit_cleaning_prices');
  const ownAt = new Map(own.map(o => [`${o.unit_id}:${o.kind}`, o]));
  const price = await priceBook(env, units.map(u => u.id));
  return json({
    ready: true, mayEdit: !!session.manage, dated,
    ...(only && session.manage && dated ? { changes: await unitChanges(env, only) } : {}),
    rows: units.map(u => {
      const key = layoutKey(u.layout_type, u.bedrooms);
      return {
        unitId: u.id, unitNumber: u.unit_number, propertyName: u.property_name, buildingId: u.property_id, layout: key,
        prices: Object.fromEntries(PRICE_KINDS.map(k => {
          const p = price(u.id, k, key), o = ownAt.get(`${u.id}:${k}`);
          return [k, { internalCost: p.internal, externalCharge: p.external, source: p.source,
            // Both empty is a dated row that went back to the list price: no override.
            override: o && (o.internal_cost != null || o.external_charge != null) ? { internalCost: o.internal_cost ?? null, externalCharge: o.external_charge ?? null } : null }];
        })),
      };
    }),
  });
};

/** PUT /api/housekeeping/unit-prices { unitId, kind | itemId, internalCost, externalCharge, effectiveFrom? } — a unit's own
 *  figures for one clean type, or one maintenance item by `itemId` (sen; empty in both means the price table applies).
 *  With `effectiveFrom` (a day after today) the figures take over on that day; the same day again replaces them. Without
 *  it they replace the unit's figures for every job up to today, and anything scheduled stays. Management only. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management sets cleaning prices.', 403);
  if (!(await hasCleanPrices(env))) return fail('NOT_CONFIGURED', 'Cleaning prices need a database update (migration 0126) that is not applied yet.', 501);
  const b = await request.json<any>().catch(() => null);
  const byItem = typeof b?.itemId === 'string' && !!b.itemId;
  if (!byItem && !(PRICE_KINDS as readonly string[]).includes(b?.kind)) return fail('VALIDATION', 'Pick the clean type.', 422, { kind: 'Pick the clean type.' });
  const ok = (v: unknown) => v == null || (Number.isInteger(v) && (v as number) >= 0);
  if (!ok(b.internalCost) || !ok(b.externalCharge)) return fail('VALIDATION', 'Amounts are sen, RM 0.00 or more, or empty.', 422);
  if (!(await one(env, 'SELECT 1 AS x FROM units WHERE id = ?', String(b.unitId ?? '')))) return fail('NOT_FOUND', 'That unit does not exist.', 404);
  const today = mytToday(), from: unknown = b.effectiveFrom ?? null;
  if (from != null && (!isDayStr(from) || from <= today)) return fail('VALIDATION', 'Pick a day after today.', 422, { effectiveFrom: 'Pick a day after today.' });
  const dated = await hasDatedUnitPrices(env);
  if ((from != null || byItem) && !dated) return fail('NOT_CONFIGURED', 'Dated unit prices need a database update (migration 0186) that is not applied yet.', 501);
  if (await hasServicePrices(env)) {
    const book = await serviceBook(env, []);
    const item = byItem ? book.items.find(i => i.id === b.itemId && i.domain === 'maintenance' && i.active) : book.itemForKind(b.kind);
    if (!item) return fail('NOT_FOUND', byItem ? 'That maintenance item is not in Service prices.' : 'There is no active cleaning item for that clean type in Service prices.', 404);
    const was = await one<any>(env, `SELECT internal_cost, owner_price FROM unit_service_prices WHERE unit_id = ? AND item_id = ?
      ${dated ? 'AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1' : ''}`, b.unitId, item.id, ...(dated ? [from ?? today] : []));
    const empty = b.internalCost == null && b.externalCharge == null;
    // Both empty from a date is a row of its own: the list price from then on. Without a date it is simply no row.
    if (empty && from == null) await run(env, `DELETE FROM unit_service_prices WHERE unit_id = ? AND item_id = ? ${dated ? 'AND effective_from <= ?' : ''}`, b.unitId, item.id, ...(dated ? [today] : []));
    else {
      await run(env, `INSERT INTO unit_service_prices (unit_id, item_id, ${dated ? 'effective_from, ' : ''}owner_price, internal_cost, updated_at, updated_by) VALUES (?, ?, ${dated ? '?, ' : ''}?, ?, ?, ?)
        ON CONFLICT (unit_id, item_id${dated ? ', effective_from' : ''}) DO UPDATE SET owner_price = excluded.owner_price, internal_cost = excluded.internal_cost, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        b.unitId, item.id, ...(dated ? [from ?? FROM_THE_START] : []), b.externalCharge ?? null, b.internalCost ?? null, nowIso(), session.userId);
      if (dated && from == null) await run(env, 'DELETE FROM unit_service_prices WHERE unit_id = ? AND item_id = ? AND effective_from <= ? AND effective_from <> ?', b.unitId, item.id, today, FROM_THE_START);
    }
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'cleaning.unit_price', entityTable: 'units', entityId: b.unitId,
      before: was ? { kind: b.kind, itemId: item.id, internalCost: was.internal_cost, externalCharge: was.owner_price } : { kind: b.kind, itemId: item.id },
      after: { kind: b.kind, itemId: item.id, internalCost: b.internalCost ?? null, externalCharge: b.externalCharge ?? null, effectiveFrom: from ?? undefined } });
    return json({ ok: true });
  }
  const before = await one<any>(env, 'SELECT internal_cost, external_charge FROM unit_cleaning_prices WHERE unit_id = ? AND kind = ?', b.unitId, b.kind);
  if (b.internalCost == null && b.externalCharge == null) {
    await run(env, 'DELETE FROM unit_cleaning_prices WHERE unit_id = ? AND kind = ?', b.unitId, b.kind);
  } else {
    await run(env, `INSERT INTO unit_cleaning_prices (unit_id, kind, internal_cost, external_charge, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (unit_id, kind) DO UPDATE SET internal_cost = excluded.internal_cost, external_charge = excluded.external_charge, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      b.unitId, b.kind, b.internalCost ?? null, b.externalCharge ?? null, nowIso(), session.userId);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'cleaning.unit_price', entityTable: 'units', entityId: b.unitId,
    before: before ? { kind: b.kind, internalCost: before.internal_cost, externalCharge: before.external_charge } : { kind: b.kind },
    after: { kind: b.kind, internalCost: b.internalCost ?? null, externalCharge: b.externalCharge ?? null } });
  return json({ ok: true });
};

/** DELETE /api/housekeeping/unit-prices?unitId=&itemId=&effectiveFrom= — cancel a price still to come. One already in
 *  force stays: jobs may have been priced from it. Management only. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management sets cleaning prices.', 403);
  if (!(await hasDatedUnitPrices(env))) return fail('NOT_CONFIGURED', 'Dated unit prices need a database update (migration 0186) that is not applied yet.', 501);
  const q = new URL(request.url).searchParams;
  const unitId = q.get('unitId') ?? '', itemId = q.get('itemId') ?? '', from = q.get('effectiveFrom') ?? '';
  if (!isDayStr(from) || from <= mytToday()) return fail('VALIDATION', 'That price is already in force, so it cannot be cancelled.', 422);
  const was = await one<any>(env, 'SELECT internal_cost, owner_price FROM unit_service_prices WHERE unit_id = ? AND item_id = ? AND effective_from = ?', unitId, itemId, from);
  if (!was) return fail('NOT_FOUND', 'That scheduled price is already gone.', 404);
  await run(env, 'DELETE FROM unit_service_prices WHERE unit_id = ? AND item_id = ? AND effective_from = ?', unitId, itemId, from);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'cleaning.unit_price_cancel', entityTable: 'units', entityId: unitId,
    before: { itemId, effectiveFrom: from, internalCost: was.internal_cost, externalCharge: was.owner_price } });
  return json({ ok: true });
};
