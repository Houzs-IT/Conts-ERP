import { type Env, one, run, json, fail, audit, nowIso, mytToday } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { mayWork } from '../../../_lib/access';
import { hasServicePrices, itemView, loadPrices, checkItem, ITEM_WRITERS } from '../../../_lib/servicePrices';

/** GET /api/operations/service-prices/:id — one item, its prices in force today and its price history: every dated
 *  change, newest first, with who set it, and how many jobs were priced from the item. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Only the office sees service prices.', 403);
  if (!(await hasServicePrices(env))) return fail('NOT_CONFIGURED', 'Service prices need a database update (migration 0127) that is not applied yet.', 501);
  const item = await one<any>(env, 'SELECT * FROM service_items WHERE id = ?', String(params.id));
  if (!item) return fail('NOT_FOUND', 'That item no longer exists.', 404);
  const rows = (await loadPrices(env)).get(item.id) ?? [];
  const today = mytToday();
  const byDate = new Map<string, typeof rows>();
  for (const r of rows) byDate.set(r.effective_from, [...(byDate.get(r.effective_from) ?? []), r]);
  const currentFrom = [...byDate.keys()].find(d => d <= today) ?? null;
  const used = await one<{ n: number }>(env, `SELECT (SELECT COUNT(*) FROM tasks WHERE service_item_id = ?) + (SELECT COUNT(*) FROM maintenance_issues WHERE sku_id = ?) AS n`, item.id, item.id);
  return json({
    ...itemView(item, rows, today), today, jobs: Number(used?.n ?? 0),
    history: [...byDate.entries()].map(([effectiveFrom, list]) => ({
      effectiveFrom, status: effectiveFrom > today ? 'scheduled' : effectiveFrom === currentFrom ? 'current' : 'past',
      note: list[0].note ?? null, setBy: list[0].created_by_name ?? null, setAt: list[0].created_at,
      rows: list.map(r => ({ layout: r.layout, ownerPrice: r.owner_price, internalCost: r.internal_cost })),
    })),
  });
};

/** PATCH /api/operations/service-prices/:id { name?, category?, uom?, cleanKind?, byLayout?, active?, notes? } — edit an
 *  item, or retire it (active: false). Retiring keeps it on past jobs. The code and Cleaning / Maintenance stay. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage && !mayWork(session, ITEM_WRITERS)) return fail('FORBIDDEN', 'Only operations and management change the service list.', 403);
  if (!(await hasServicePrices(env))) return fail('NOT_CONFIGURED', 'Service prices need a database update (migration 0127) that is not applied yet.', 501);
  const id = String(params.id);
  const cur = await one<any>(env, 'SELECT * FROM service_items WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That item no longer exists.', 404);
  const b = await request.json<any>().catch(() => null);
  if (b?.code !== undefined || b?.domain !== undefined) return fail('VALIDATION', 'The code and Cleaning / Maintenance of an item do not change. Add a new item instead.', 422);
  const bad = checkItem({ ...b, domain: cur.domain }, false);
  if (bad) return bad;
  const active = b.active ?? !!cur.active, kind = b.cleanKind !== undefined ? b.cleanKind : cur.clean_kind;
  if (kind && active && await one(env, 'SELECT 1 AS x FROM service_items WHERE clean_kind = ? AND active = 1 AND id != ?', kind, id)) return fail('CONFLICT', 'Another active item is already the price for that clean type.', 409, { cleanKind: 'Taken by another item.' });
  if (b.byLayout !== undefined && b.byLayout !== !!cur.by_layout && await one(env, 'SELECT 1 AS x FROM service_item_prices WHERE item_id = ?', id)) {
    return fail('CONFLICT', 'This item already has prices. Add a new item to price it the other way.', 409, { byLayout: 'It already has prices.' });
  }
  const sets: string[] = [], args: unknown[] = [], before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  const put = (col: string, key: string, v: unknown) => { sets.push(`${col} = ?`); args.push(v); before[key] = cur[col]; after[key] = v; };
  if (typeof b.name === 'string') put('name', 'name', b.name.trim().slice(0, 120));
  if (b.category !== undefined) put('category', 'category', b.category);
  if (b.uom !== undefined) put('unit_label', 'uom', b.uom);
  if (b.cleanKind !== undefined) put('clean_kind', 'cleanKind', b.cleanKind);
  if (b.byLayout !== undefined) put('by_layout', 'byLayout', b.byLayout ? 1 : 0);
  if (b.active !== undefined) put('active', 'active', b.active ? 1 : 0);
  if (typeof b.notes === 'string') put('notes', 'notes', b.notes.trim().slice(0, 500) || null);
  if (!sets.length) return fail('VALIDATION', 'Nothing to change.', 422);
  await run(env, `UPDATE service_items SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, ...args, nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'service_item.update', entityTable: 'service_items', entityId: id, before, after });
  return json({ ok: true });
};
