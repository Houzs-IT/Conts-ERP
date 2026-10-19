import { type Env, all, one, run, json, fail, audit, nowIso, mytToday } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { mayWork } from '../../../_lib/access';
import { DOMAINS, CATEGORIES, UOMS, CLEAN_TYPES, GRID_LAYOUTS, hasServicePrices, itemView, loadPrices, checkItem, checkPriceRows, writePrices, ITEM_WRITERS } from '../../../_lib/servicePrices';

/** GET /api/operations/service-prices?domain= — the service item list (cleaning and maintenance) with, per item, the
 *  owner price and internal cost in force today (per layout for an item priced by layout) and the next scheduled change.
 *  Amounts in sen; null = not set. The office reads it; management sets prices. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Only the office sees service prices.', 403);
  const meta = { domains: DOMAINS, categories: CATEGORIES, uoms: UOMS, cleanTypes: CLEAN_TYPES, layouts: GRID_LAYOUTS, today: mytToday() };
  if (!(await hasServicePrices(env))) return json({ ready: false, ...meta, items: [], mayEdit: false, mayPrice: false });
  const domain = new URL(request.url).searchParams.get('domain');
  const items = await all<any>(env, `SELECT * FROM service_items ${domain && (DOMAINS as readonly string[]).includes(domain) ? 'WHERE domain = ?' : ''} ORDER BY domain, active DESC, code`, ...(domain ? [domain] : []));
  const prices = await loadPrices(env);
  return json({ ready: true, ...meta, mayEdit: !!session.manage || mayWork(session, ITEM_WRITERS), mayPrice: !!session.manage,
    items: items.map(i => itemView(i, prices.get(i.id) ?? [], meta.today)) });
};

/** POST /api/operations/service-prices { code, name, domain, category, uom, cleanKind?, byLayout, notes?, prices?: { effectiveFrom, rows: [{ layout, ownerPrice, internalCost }] } }
 *  A new item; its first prices only from management. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage && !mayWork(session, ITEM_WRITERS)) return fail('FORBIDDEN', 'Only operations and management change the service list.', 403);
  if (!(await hasServicePrices(env))) return fail('NOT_CONFIGURED', 'Service prices need a database update (migration 0127) that is not applied yet.', 501);
  const b = await request.json<any>().catch(() => null);
  const bad = checkItem(b, true);
  if (bad) return bad;
  const code = String(b.code).trim().slice(0, 40);
  if (await one(env, 'SELECT 1 AS x FROM service_items WHERE lower(code) = lower(?)', code)) return fail('CONFLICT', 'An item already uses that code.', 409, { code: 'This code is taken.' });
  if (b.cleanKind && await one(env, 'SELECT 1 AS x FROM service_items WHERE clean_kind = ? AND active = 1', b.cleanKind)) return fail('CONFLICT', 'Another active item is already the price for that clean type.', 409, { cleanKind: 'Taken by another item.' });
  let priceRows: ReturnType<typeof checkPriceRows> | null = null;
  if (b.prices) {
    if (!session.manage) return fail('FORBIDDEN', 'Only management sets prices.', 403);
    priceRows = checkPriceRows(b.prices, !!b.byLayout);
    if ('error' in priceRows) return priceRows.error;
  }
  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `INSERT INTO service_items (id, code, name, domain, category, unit_label, clean_kind, by_layout, default_price, active, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`,
    id, code, String(b.name).trim().slice(0, 120), b.domain, b.category, b.uom ?? 'job', b.domain === 'cleaning' ? b.cleanKind ?? null : null,
    b.byLayout ? 1 : 0, typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 500) : null, now, now);
  if (priceRows && 'rows' in priceRows) await writePrices(env, id, priceRows, session.userId);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'service_item.create', entityTable: 'service_items', entityId: id,
    after: { code, name: b.name, domain: b.domain, category: b.category, uom: b.uom ?? 'job', byLayout: !!b.byLayout, prices: priceRows && 'rows' in priceRows ? priceRows : null } });
  return json({ id }, 201);
};
