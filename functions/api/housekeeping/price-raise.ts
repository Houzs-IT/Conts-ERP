import { type Env, all, one, run, json, fail, audit, nowIso, mytToday, transaction } from '../../_lib/db';
import { requireSession, hasColumn } from '../../_lib/auth';
import { layoutKey } from '../../_lib/cleaningPrices';
import { inForce } from '../../_lib/datedRows';
import { hasServicePrices, hasDatedUnitPrices, serviceBook, priceGrids, writePrices, isDayStr, CLEAN_TYPES, type PriceRow } from '../../_lib/servicePrices';
import { dayAfter, figuresChanged, hasChangeInside, percentToBasisPoints, raiseFigures, raiseSen, type PriceFigures, type PriceRaise } from '../../_lib/priceRaise';

interface RaiseRequest {
  cleanKind: string | null; itemId: string | null; unitId: string | null; effectiveFrom: string; effectiveTo: string | null; backOn: string | null;
  raise: PriceRaise; includeOwn: boolean; dryRun: boolean;
}
interface ListChange { key: string; label: string; before: PriceFigures; after: PriceFigures }
interface OwnChange { unit_id: string; before: PriceFigures; after: PriceFigures }

const WINDOW_TAKEN = 'Another price change is already set inside these dates. Change or remove it first, or pick other dates.';

function readRequest(body: unknown, today: string): RaiseRequest | Response {
  const input = (body ?? {}) as Record<string, unknown>;
  const itemId = typeof input.itemId === 'string' && input.itemId ? input.itemId : null;
  if (!itemId && !(CLEAN_TYPES as readonly string[]).includes(String(input.cleanKind))) return fail('VALIDATION', 'Pick the clean type or the item.', 422, { cleanKind: 'Pick the clean type or the item.' });
  if (!isDayStr(input.effectiveFrom) || input.effectiveFrom <= today) return fail('VALIDATION', 'Pick a day after today.', 422, { effectiveFrom: 'Pick a day after today.' });
  const hasEnd = input.effectiveTo != null && input.effectiveTo !== '';
  if (hasEnd && (!isDayStr(input.effectiveTo) || input.effectiveTo < input.effectiveFrom)) return fail('VALIDATION', 'The last day is on or after the first day.', 422, { effectiveTo: 'Pick a day on or after the first day.' });
  const ownerBasisPoints = percentToBasisPoints(input.ownerPct), internalBasisPoints = percentToBasisPoints(input.internalPct);
  if (ownerBasisPoints === undefined || internalBasisPoints === undefined) return fail('VALIDATION', 'A percent is a number from -100 to 1000, up to two decimals.', 422);
  if (!ownerBasisPoints && !internalBasisPoints) return fail('VALIDATION', 'Enter the percent to change by.', 422);
  const effectiveTo = hasEnd ? String(input.effectiveTo) : null;
  return {
    cleanKind: itemId ? null : String(input.cleanKind), itemId, unitId: typeof input.unitId === 'string' && input.unitId ? input.unitId : null,
    effectiveFrom: input.effectiveFrom, effectiveTo, backOn: effectiveTo ? dayAfter(effectiveTo) : null,
    raise: { ownerBasisPoints, internalBasisPoints }, includeOwn: input.includeOwn === true, dryRun: input.dryRun === true,
  };
}

async function listChanges(env: Env, rows: PriceRow[], day: string, raise: PriceRaise): Promise<ListChange[]> {
  const grids = await priceGrids(env);
  const labels = { ...grids.layout.labels, ...grids.bed.labels };
  const changes: ListChange[] = [];
  for (const key of new Set(rows.map(row => row.layout))) {
    const row = inForce(rows.filter(candidate => candidate.layout === key), day);
    if (!row) continue;
    const before = { owner_price: row.owner_price, internal_cost: row.internal_cost }, after = raiseFigures(before, raise);
    if (figuresChanged(before, after)) changes.push({ key, label: labels[key] ?? key, before, after });
  }
  return changes;
}

async function ownChanges(env: Env, itemId: string, day: string, raise: PriceRaise): Promise<OwnChange[]> {
  const rows = await all<{ unit_id: string } & PriceFigures>(env, `SELECT DISTINCT ON (unit_id) unit_id, owner_price, internal_cost FROM unit_service_prices
    WHERE item_id = ? AND effective_from <= ? ORDER BY unit_id, effective_from DESC`, itemId, day);
  return rows.flatMap(({ unit_id, owner_price, internal_cost }) => {
    const before = { owner_price, internal_cost }, after = raiseFigures(before, raise);
    return figuresChanged(before, after) ? [{ unit_id, before, after }] : [];
  });
}

const ownDatesInside = async (env: Env, itemId: string, unitId: string | null, startDay: string, backOn: string): Promise<string[]> =>
  (await all<{ effective_from: string }>(env, `SELECT DISTINCT effective_from::text AS effective_from FROM unit_service_prices
    WHERE item_id = ? AND (?::text IS NULL OR unit_id = ?) AND effective_from > ? AND effective_from <= ?`, itemId, unitId, unitId, startDay, backOn))
    .map(({ effective_from }) => effective_from.slice(0, 10));

const unitsSetOn = async (env: Env, itemId: string, day: string): Promise<Set<string>> =>
  new Set((await all<{ unit_id: string }>(env, 'SELECT unit_id FROM unit_service_prices WHERE item_id = ? AND effective_from = ?', itemId, day)).map(({ unit_id }) => unit_id));

async function writeOwnRows(env: Env, itemId: string, day: string, rows: { unit_id: string; figures: PriceFigures }[], userId: string): Promise<void> {
  if (!rows.length) return;
  await run(env, `INSERT INTO unit_service_prices (unit_id, item_id, effective_from, owner_price, internal_cost, updated_at, updated_by)
    SELECT x.unit_id, ?, ?, x.owner_price, x.internal_cost, ?, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(unit_id text, owner_price int, internal_cost int)
    ON CONFLICT (unit_id, item_id, effective_from) DO UPDATE SET owner_price = excluded.owner_price, internal_cost = excluded.internal_cost,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    itemId, day, nowIso(), userId, JSON.stringify(rows.map(({ unit_id, figures }) => ({ unit_id, ...figures }))));
}

const raisedOrKept = (merged: number | null, own: number | null, basisPoints: number | null): number | null | undefined => {
  if (basisPoints == null) return own;
  return merged == null ? undefined : raiseSen(merged, basisPoints);
};

/** POST /api/housekeeping/price-raise { cleanKind or itemId, effectiveFrom, effectiveTo?, ownerPct?, internalPct?, unitId?, includeOwn?, dryRun? }
 *  Changes a clean's or a service item's prices by a percent from a later date, worked out once into RM and saved as ordinary dated rows.
 *  Without `unitId`: every list price row (bed sizes or layouts) in force on that date, and with `includeOwn` each unit's
 *  own figures in force then (only the figures it has; a figure following the list keeps following it). With `unitId`:
 *  that unit's price on that date, saved as its own price. With `effectiveTo` the change lasts to that day only: the
 *  prices in force before it are saved again from the day after, unless a change is already set on that day. A change
 *  already set inside the window is refused (409). `dryRun` answers what would be saved. Management only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management changes prices.', 403);
  if (!(await hasServicePrices(env))) return fail('NOT_CONFIGURED', 'Service prices need a database update (migration 0127) that is not applied yet.', 501);
  const asked = readRequest(await request.json().catch(() => null), mytToday());
  if (asked instanceof Response) return asked;
  const { cleanKind, itemId, unitId, effectiveFrom, effectiveTo, backOn, raise, includeOwn, dryRun } = asked;
  if ((unitId || includeOwn) && !(await hasDatedUnitPrices(env))) return fail('NOT_CONFIGURED', 'Dated unit prices need a database update (migration 0186) that is not applied yet.', 501);
  const book = await serviceBook(env, unitId ? [unitId] : []);
  const item = itemId ? book.items.find(candidate => candidate.id === itemId && candidate.active) ?? null : book.itemForKind(cleanKind ?? '');
  if (!item) return fail('NOT_FOUND', 'There is no active item for that in Service prices.', 404);
  const note = effectiveTo ? `Changed by percent to ${effectiveTo}` : 'Changed by percent';
  const actor = { actorId: session.userId, actorLabel: session.fullName };
  const window = { effectiveFrom, effectiveTo, backOn };

  if (unitId) {
    const layoutColumn = (await hasColumn(env, 'units', 'layout_type')) ? 'layout_type' : 'NULL::text AS layout_type';
    const unit = await one<{ bedrooms: number | null; layout_type: string | null }>(env, `SELECT bedrooms, ${layoutColumn} FROM units WHERE id = ?`, unitId);
    if (!unit) return fail('NOT_FOUND', 'That unit does not exist.', 404);
    const ownDates = backOn ? await ownDatesInside(env, item.id, unitId, effectiveFrom, backOn) : [];
    if (backOn && hasChangeInside(ownDates, effectiveFrom, backOn)) return fail('CONFLICT', WINDOW_TAKEN, 409);
    const own = await one<PriceFigures>(env, `SELECT owner_price, internal_cost FROM unit_service_prices WHERE unit_id = ? AND item_id = ? AND effective_from <= ?
      ORDER BY effective_from DESC LIMIT 1`, unitId, item.id, effectiveFrom);
    const merged = book.amounts(item.id, unitId, layoutKey(unit.layout_type, unit.bedrooms), effectiveFrom);
    const owner = raisedOrKept(merged.owner, own?.owner_price ?? null, raise.ownerBasisPoints);
    const internal = raisedOrKept(merged.internal, own?.internal_cost ?? null, raise.internalBasisPoints);
    if (owner === undefined || internal === undefined) return fail('VALIDATION', 'This unit has no price on that date to change by a percent.', 422);
    const before = { owner_price: merged.owner, internal_cost: merged.internal }, after = raiseFigures(before, raise);
    if (dryRun) return json({ ...window, unit: { before, after } });
    const saved = { owner_price: owner, internal_cost: internal };
    const ownBefore = { owner_price: own?.owner_price ?? null, internal_cost: own?.internal_cost ?? null };
    await transaction(env, async tx => {
      await writeOwnRows(tx, item.id, effectiveFrom, [{ unit_id: unitId, figures: saved }], session.userId);
      if (backOn && !ownDates.includes(backOn)) await writeOwnRows(tx, item.id, backOn, [{ unit_id: unitId, figures: ownBefore }], session.userId);
      await audit(tx, { ...actor, action: `${item.domain}.unit_price_raise`, entityTable: 'units', entityId: unitId, before: { itemId: item.id, ...before }, after: { itemId: item.id, ...window, ...saved, ...raise } });
    });
    return json({ ok: true, ...window, unit: { before, after } });
  }

  const rows = await all<PriceRow>(env, 'SELECT id, item_id, layout, effective_from, owner_price, internal_cost FROM service_item_prices WHERE item_id = ? ORDER BY effective_from DESC', item.id);
  const listDates = rows.map(({ effective_from }) => String(effective_from).slice(0, 10));
  const ownDates = backOn && includeOwn ? await ownDatesInside(env, item.id, null, effectiveFrom, backOn) : [];
  if (backOn && (hasChangeInside(listDates, effectiveFrom, backOn) || hasChangeInside(ownDates, effectiveFrom, backOn))) return fail('CONFLICT', WINDOW_TAKEN, 409);
  const list = await listChanges(env, rows, effectiveFrom, raise);
  const own = includeOwn ? await ownChanges(env, item.id, effectiveFrom, raise) : [];
  if (dryRun) return json({ ...window, list, ownPrices: own.length });
  if (!list.length && !own.length) return fail('VALIDATION', 'There is no price in force on that date to change.', 422);
  const listSetOnBack = new Set(rows.filter(({ effective_from }) => backOn && String(effective_from).slice(0, 10) === backOn).map(({ layout }) => layout));
  const listBack = list.filter(({ key }) => !listSetOnBack.has(key));
  const unitsSetOnBack = backOn ? await unitsSetOn(env, item.id, backOn) : new Set<string>();
  const ownBack = own.filter(({ unit_id }) => !unitsSetOnBack.has(unit_id));
  await transaction(env, async tx => {
    if (list.length) await writePrices(tx, item.id, { effectiveFrom, note, rows: list.map(({ key, after }) => ({ layout: key, ownerPrice: after.owner_price, internalCost: after.internal_cost })) }, session.userId);
    await writeOwnRows(tx, item.id, effectiveFrom, own.map(({ unit_id, after }) => ({ unit_id, figures: after })), session.userId);
    if (backOn && listBack.length) await writePrices(tx, item.id, { effectiveFrom: backOn, note: `Back after the percent change from ${effectiveFrom}`, rows: listBack.map(({ key, before }) => ({ layout: key, ownerPrice: before.owner_price, internalCost: before.internal_cost })) }, session.userId);
    if (backOn) await writeOwnRows(tx, item.id, backOn, ownBack.map(({ unit_id, before }) => ({ unit_id, figures: before })), session.userId);
    await audit(tx, { ...actor, action: 'service_item.price_raise', entityTable: 'service_items', entityId: item.id,
      after: { code: item.code, ...window, ...raise, listRows: list.length, ownPrices: own.length } });
  });
  return json({ ok: true, ...window, list, ownPrices: own.length });
};
