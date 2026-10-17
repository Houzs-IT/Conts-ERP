import { type Env, all, run, json, fail, audit, nowIso, mytToday, transaction } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { mayWork } from '../../../_lib/access';
import { hasServicePrices, loadPrices, planImport, writePrices, isDayStr, ITEM_WRITERS } from '../../../_lib/servicePrices';

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
  const plan = planImport(b.rows, items, await loadPrices(env), effectiveFrom);
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
  if (plan.errors.length) return json({ ok: false, ...summary }, 422);
  if (b.dryRun) return json({ ok: true, dryRun: true, ...summary });

  await transaction(env, async tx => {
    const now = nowIso();
    for (const c of plan.creates) {
      const id = crypto.randomUUID();
      await run(tx, `INSERT INTO service_items (id, code, name, domain, category, unit_label, clean_kind, by_layout, default_price, active, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`, id, c.code, c.item.name, c.item.domain, c.item.category, c.item.uom, c.item.cleanKind,
        c.item.byLayout ? 1 : 0, c.item.active ? 1 : 0, c.item.notes, now, now);
      if (c.prices) await writePrices(tx, id, c.prices, session.userId);
    }
    for (const u of plan.updates) {
      const cols = Object.keys(u.changes);
      await run(tx, `UPDATE service_items SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...cols.map(c => u.changes[c]), now, u.id);
    }
    for (const p of plan.prices) await writePrices(tx, p.id, p.set, session.userId);
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'service_item.import', entityTable: 'service_items', entityId: 'import',
      after: { effectiveFrom, created: plan.creates.map(c => c.code), updated: plan.updates.map(u => ({ code: u.code, before: u.before, after: u.changes })), prices: plan.prices.map(p => ({ code: p.code, rows: p.set.rows })) } });
  });
  return json({ ok: true, dryRun: false, ...summary });
};
