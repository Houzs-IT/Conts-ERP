import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole, hasColumn } from '../../_lib/auth';
import { hasCleanPrices, priceBook, layoutKey, PRICE_KINDS } from '../../_lib/cleaningPrices';
import { hasServicePrices, serviceBook } from '../../_lib/servicePrices';

/** GET /api/housekeeping/unit-prices — every unit with its layout and, per clean type, the cleaner's pay and the charge
 *  per clean that apply (its own override, else the price table), and where they come from. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Only the office sees cleaning prices.', 403);
  if (!(await hasCleanPrices(env))) return json({ ready: false, rows: [], mayEdit: false });
  const layout = (await hasColumn(env, 'units', 'layout_type').catch(() => false)) ? 'u.layout_type' : 'NULL::text';
  const units = await all<any>(env, `
    SELECT u.id, u.unit_number, u.bedrooms, ${layout} AS layout_type, p.id AS property_id, p.name AS property_name
    FROM units u JOIN properties p ON p.id = u.property_id ORDER BY p.name, u.unit_number`);
  // Since Service prices (0127) a unit's own figures are per item: the cleaning item of each clean type.
  const own = (await hasServicePrices(env))
    ? await all<{ unit_id: string; kind: string; internal_cost: number | null; external_charge: number | null }>(env,
      `SELECT o.unit_id, s.clean_kind AS kind, o.internal_cost, o.owner_price AS external_charge
       FROM unit_service_prices o JOIN service_items s ON s.id = o.item_id WHERE s.clean_kind IS NOT NULL AND s.active = 1`)
    : await all<{ unit_id: string; kind: string; internal_cost: number | null; external_charge: number | null }>(env,
      'SELECT unit_id, kind, internal_cost, external_charge FROM unit_cleaning_prices');
  const ownAt = new Map(own.map(o => [`${o.unit_id}:${o.kind}`, o]));
  const price = await priceBook(env, units.map(u => u.id));
  return json({
    ready: true, mayEdit: !!session.manage,
    rows: units.map(u => {
      const key = layoutKey(u.layout_type, u.bedrooms);
      return {
        unitId: u.id, unitNumber: u.unit_number, propertyName: u.property_name, buildingId: u.property_id, layout: key,
        prices: Object.fromEntries(PRICE_KINDS.map(k => {
          const p = price(u.id, k, key), o = ownAt.get(`${u.id}:${k}`);
          return [k, { internalCost: p.internal, externalCharge: p.external, source: p.source,
            override: o ? { internalCost: o.internal_cost ?? null, externalCharge: o.external_charge ?? null } : null }];
        })),
      };
    }),
  });
};

/** PUT /api/housekeeping/unit-prices { unitId, kind, internalCost, externalCharge } — a unit's own figures for one clean
 *  type (sen; empty in both removes the override and the price table applies again). Management only. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management sets cleaning prices.', 403);
  if (!(await hasCleanPrices(env))) return fail('NOT_CONFIGURED', 'Cleaning prices need a database update (migration 0126) that is not applied yet.', 501);
  const b = await request.json<any>().catch(() => null);
  if (!(PRICE_KINDS as readonly string[]).includes(b?.kind)) return fail('VALIDATION', 'Pick the clean type.', 422, { kind: 'Pick the clean type.' });
  const ok = (v: unknown) => v == null || (Number.isInteger(v) && (v as number) >= 0);
  if (!ok(b.internalCost) || !ok(b.externalCharge)) return fail('VALIDATION', 'Amounts are sen, RM 0.00 or more, or empty.', 422);
  if (!(await one(env, 'SELECT 1 AS x FROM units WHERE id = ?', String(b.unitId ?? '')))) return fail('NOT_FOUND', 'That unit does not exist.', 404);
  if (await hasServicePrices(env)) {
    const item = (await serviceBook(env, [])).itemForKind(b.kind);
    if (!item) return fail('NOT_FOUND', 'There is no active cleaning item for that clean type in Service prices.', 404);
    const was = await one<any>(env, 'SELECT internal_cost, owner_price FROM unit_service_prices WHERE unit_id = ? AND item_id = ?', b.unitId, item.id);
    if (b.internalCost == null && b.externalCharge == null) await run(env, 'DELETE FROM unit_service_prices WHERE unit_id = ? AND item_id = ?', b.unitId, item.id);
    else await run(env, `INSERT INTO unit_service_prices (unit_id, item_id, owner_price, internal_cost, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (unit_id, item_id) DO UPDATE SET owner_price = excluded.owner_price, internal_cost = excluded.internal_cost, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      b.unitId, item.id, b.externalCharge ?? null, b.internalCost ?? null, nowIso(), session.userId);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'cleaning.unit_price', entityTable: 'units', entityId: b.unitId,
      before: was ? { kind: b.kind, itemId: item.id, internalCost: was.internal_cost, externalCharge: was.owner_price } : { kind: b.kind, itemId: item.id },
      after: { kind: b.kind, itemId: item.id, internalCost: b.internalCost ?? null, externalCharge: b.externalCharge ?? null } });
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
