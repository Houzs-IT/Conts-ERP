import { type Env, all, run, json, fail, audit, nowIso, mytToday, transaction } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { mayWork } from '../../../_lib/access';
import { hasServicePrices, loadPrices, planImport, writePriceSets, isDayStr, layoutGrid, ITEM_WRITERS } from '../../../_lib/servicePrices';

/** POST /api/operations/service-prices/import { rows: [{ Code, Name, Type, ... }], effectiveFrom?, dryRun? } — the item
 *  list back from a spreadsheet (the screen reads the CSV or Excel file and sends its rows, keyed by the export's column
 *  names). New codes become items; known codes are updated; a changed price becomes a price change from effectiveFrom
 *  (default today). Blank cells leave things as they are. All or nothing: any error and nothing is saved. dryRun shows
 *  what would change. Price changes are management's. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage && !mayWork(session, ITEM_WRITERS)) return fail('FORBIDDEN', 'Only operations and management change the service list.', 403);
  if (!(await hasServicePrices(env))) return fail('NOT_CONFIGURED', 'Service prices need a database update (migration 0127) that is not applied yet.', 501);
  const b = await request.json<any>().catch(() => null);
  if (!Array.isArray(b?.rows) || !b.rows.length) return fail('VALIDATION', 'The file has no rows.', 422, { file: 'Pick a file with rows.' });
  if (b.rows.length > 2000) return fail('VALIDATION', 'Keep one file under 2,000 rows.', 422, { file: 'Too many rows.' });
  const effectiveFrom = b.effectiveFrom ?? mytToday();
  if (!isDayStr(effectiveFrom)) return fail('VALIDATION', 'Pick the date the prices apply from.', 422, { effectiveFrom: 'Pick a date.' });

  const items = await all<any>(env, 'SELECT * FROM service_items');
  const plan = planImport(b.rows, items, await loadPrices(env), effectiveFrom, await layoutGrid(env));
  const priceChanges = plan.prices.length + plan.creates.filter(c => c.prices).length;
  if (priceChanges && !session.manage) plan.errors.push({ line: 0, message: 'The file changes prices, and only management sets prices.' });
  const summary = {
    effectiveFrom, created: plan.creates.length, updated: plan.updates.length, priceChanges, unchanged: plan.unchanged, errors: plan.errors.slice(0, 100),
    changes: [
      ...plan.creates.map(c => ({ code: c.code, action: 'new', detail: c.item.name })),
      ...plan.updates.map(u => ({ code: u.code, action: 'edit', detail: Object.keys(u.changes).join(', ') })),
      ...plan.prices.map(p => ({ code: p.code, action: 'price', detail: `${p.set.rows.length} ${p.set.rows.length === 1 ? 'price' : 'prices'} from ${effectiveFrom}` })),
    ].slice(0, 200),
  };
  // A sheet with mistakes is an answer to show row by row, not a failed request.
  if (plan.errors.length) return json({ ok: false, dryRun: !!b.dryRun, ...summary });
  if (b.dryRun) return json({ ok: true, dryRun: true, ...summary });

  await transaction(env, async tx => {
    const now = nowIso();
    const created = plan.creates.map(c => ({ ...c, id: crypto.randomUUID() }));
    if (created.length) await run(tx, `INSERT INTO service_items (id, code, name, domain, category, unit_label, clean_kind, by_layout, default_price, active, notes, created_at, updated_at)
      SELECT x.id, x.code, x.name, x.domain, x.category, x.uom, x.clean_kind, x.by_layout, 0, x.active, x.notes, ?, ?
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, code text, name text, domain text, category text, uom text, clean_kind text, by_layout int, active int, notes text)`,
      now, now, JSON.stringify(created.map(c => ({ id: c.id, code: c.code, name: c.item.name, domain: c.item.domain, category: c.item.category, uom: c.item.uom,
        clean_kind: c.item.cleanKind, by_layout: c.item.byLayout ? 1 : 0, active: c.item.active ? 1 : 0, notes: c.item.notes }))));
    if (plan.updates.length) await run(tx, `UPDATE service_items s SET name = x.name, category = x.category, unit_label = x.unit_label, clean_kind = x.clean_kind,
      active = x.active, notes = x.notes, updated_at = ?
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, name text, category text, unit_label text, clean_kind text, active int, notes text) WHERE s.id = x.id`,
      now, JSON.stringify(plan.updates.map(u => ({ id: u.id, ...u.row }))));
    await writePriceSets(tx, [
      ...created.filter(c => c.prices).map(c => ({ itemId: c.id, set: c.prices! })),
      ...plan.prices.map(p => ({ itemId: p.id, set: p.set })),
    ], session.userId);
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'service_item.import', entityTable: 'service_items', entityId: 'import',
      after: { effectiveFrom, created: plan.creates.map(c => c.code), updated: plan.updates.map(u => ({ code: u.code, before: u.before, after: u.changes })), prices: plan.prices.map(p => ({ code: p.code, rows: p.set.rows })) } });
  });
  return json({ ok: true, dryRun: false, ...summary });
};
