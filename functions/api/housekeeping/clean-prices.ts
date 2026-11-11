import { type Env, all, json, fail, audit, mytToday } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasServicePrices, hasGuestPrices, bedPricingMode, priceGrids, loadPrices, itemView, serviceBook, writePriceSets, type ServiceItem } from '../../_lib/servicePrices';
import { bedCountRows, countedBeds, parseBeds } from '../../_lib/bedPricing';
import { checkCleanTable, type CleanFigures } from '../../_lib/cleanTable';

/* The cleaning price table by number of beds (chew, 10 Nov 2026: "basic 和 deep 放一起", "charge guest 的也放一起"): one
   table, a row per number of beds, and for Basic clean and Deep clean the owner's charge, the guest's charge and the
   cleaner's pay. It is the Basic and Deep cleaning items' prices from Service prices, shown and saved together; a unit's
   own prices (Arte) still win. Only while the bed grid is by number of beds (settings 'cleaning.bedPricing'). */

type Cell = { ownerPrice: number | null; internalCost: number | null; guestPrice: number | null; effectiveFrom: string | null };
const figures = (c: Cell | undefined): CleanFigures => ({ owner: c?.ownerPrice ?? null, guest: c?.guestPrice ?? null, cost: c?.internalCost ?? null });

async function cleaningItems(env: Env): Promise<{ basic?: ServiceItem & { by_bed?: number }; deep?: ServiceItem & { by_bed?: number } }> {
  const items = await all<any>(env, `SELECT * FROM service_items WHERE domain = 'cleaning' AND active = 1 AND clean_kind IN ('turnover', 'deep_clean')`);
  return { basic: items.find(i => i.clean_kind === 'turnover'), deep: items.find(i => i.clean_kind === 'deep_clean') };
}

/** GET /api/housekeeping/clean-prices — the table in force today, the next scheduled change, and the units with their
 *  own prices (shown as charged: their own figure, else the table's). Amounts in sen; null = not set. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Only the office sees cleaning prices.', 403);
  if (!(await hasServicePrices(env))) return json({ ready: false, byCount: false });
  const [{ basic, deep }, mode] = await Promise.all([cleaningItems(env), bedPricingMode(env)]);
  if (mode !== 'count' || !basic?.by_bed || !deep?.by_bed) return json({ ready: true, byCount: false });
  const today = mytToday();
  const [grids, prices, guestPrices] = await Promise.all([priceGrids(env), loadPrices(env), hasGuestPrices(env)]);
  const vb = itemView(basic, prices.get(basic.id) ?? [], today, grids), vd = itemView(deep, prices.get(deep.id) ?? [], today, grids);
  const keys = grids.bed.keys;
  const since = [...Object.values(vb.current), ...Object.values(vd.current)].map(c => c.effectiveFrom).filter((d): d is string => !!d).sort();
  const nextFrom = [vb.next?.effectiveFrom, vd.next?.effectiveFrom].filter((d): d is string => !!d).sort()[0] ?? null;
  const at = (v: typeof vb, k: string) => (nextFrom && v.next?.effectiveFrom === nextFrom ? v.next.rows[k] : v.current[k]);

  // Units with their own figures for either clean, in force today.
  const own = await all<{ unit_id: string; unit_number: string; property_name: string; beds: string | null }>(env, `
    SELECT DISTINCT u.id AS unit_id, u.unit_number, p.name AS property_name, u.beds::text AS beds
    FROM unit_service_prices o JOIN units u ON u.id = o.unit_id JOIN properties p ON p.id = u.property_id
    WHERE o.item_id IN (?, ?) AND o.effective_from <= ?
      AND (o.owner_price IS NOT NULL OR o.internal_cost IS NOT NULL${guestPrices ? ' OR o.guest_price IS NOT NULL' : ''})
    ORDER BY p.name, u.unit_number`, basic.id, deep.id, today);
  const book = own.length ? await serviceBook(env, own.map(o => o.unit_id)) : null;
  const charged = (itemId: string, unitId: string): CleanFigures => {
    const a = book!.amounts(itemId, unitId, 'other', today);
    return { owner: a.owner, guest: a.guest, cost: a.internal };
  };
  return json({
    ready: true, byCount: true, guestPrices, mayEdit: !!session.manage, today, since: since[since.length - 1] ?? null,
    rows: keys.map(k => ({ key: k, label: grids.bed.labels[k] ?? k, basic: figures(vb.current[k]), deep: figures(vd.current[k]) })),
    next: nextFrom ? { effectiveFrom: nextFrom, rows: keys.map(k => ({ key: k, label: grids.bed.labels[k] ?? k, basic: figures(at(vb, k)), deep: figures(at(vd, k)) })) } : null,
    own: own.map(o => ({ unitId: o.unit_id, unitNumber: o.unit_number, propertyName: o.property_name, beds: countedBeds(parseBeds(o.beds)),
      basic: charged(basic.id, o.unit_id), deep: charged(deep.id, o.unit_id) })),
  });
};

/** POST /api/housekeeping/clean-prices { effectiveFrom, note?, rows: [{ layout, basic: { owner, guest, cost }, deep: { … } }] }
 *  The whole table from a date, Basic and Deep in one statement (the same date again replaces it). Jobs before the
 *  date, and every finished job, keep the prices they had. Management only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management sets prices.', 403);
  if (!(await hasServicePrices(env))) return fail('NOT_CONFIGURED', 'Service prices need a database update (migration 0127) that is not applied yet.', 501);
  const [{ basic, deep }, mode] = await Promise.all([cleaningItems(env), bedPricingMode(env)]);
  if (mode !== 'count' || !basic?.by_bed || !deep?.by_bed) return fail('CONFLICT', 'Cleaning is not priced by number of beds, so this table is not in use.', 409);
  const set = checkCleanTable(await request.json<any>().catch(() => null), bedCountRows().keys);
  if ('error' in set) return fail('VALIDATION', set.error.message, 422, { [set.error.field]: set.error.message });
  const guestPrices = await hasGuestPrices(env);
  if (!guestPrices && [...set.basic, ...set.deep].some(r => r.guestPrice != null)) {
    return fail('NOT_CONFIGURED', 'Guest prices need a database update (migration 0257) that is not applied yet.', 501);
  }
  const rows = (list: typeof set.basic) => list.map(r => (guestPrices ? r : { layout: r.layout, ownerPrice: r.ownerPrice, internalCost: r.internalCost }));
  await writePriceSets(env, [
    { itemId: basic.id, set: { effectiveFrom: set.effectiveFrom, note: set.note, rows: rows(set.basic) } },
    { itemId: deep.id, set: { effectiveFrom: set.effectiveFrom, note: set.note, rows: rows(set.deep) } },
  ], session.userId);
  const logged = (item: ServiceItem, list: typeof set.basic) => ({ actorId: session.userId, actorLabel: session.fullName, action: 'service_item.prices',
    entityTable: 'service_items', entityId: item.id, after: { code: item.code, effectiveFrom: set.effectiveFrom, note: set.note, rows: list, from: 'cleaning price table' } });
  await audit(env, logged(basic, set.basic));
  await audit(env, logged(deep, set.deep));
  return json({ ok: true, effectiveFrom: set.effectiveFrom, saved: set.basic.length });
};
