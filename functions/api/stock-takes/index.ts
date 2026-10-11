import { type Env, all, one, run, json, fail, nowIso, audit, mytToday, isNumberClash } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { nextNumber, onHandOf, toTakePayload, type TakeHeaderRow } from '../../_lib/stock-ops';
import { strOrNull, genId } from '../../_lib/scm-util';
import { checkDate, invalid, type Fields } from '../../_lib/validate';

const LIST_SQL = `
  SELECT t.id, t.take_number, t.warehouse_id, t.take_date, t.status, t.notes, t.created_at, t.updated_at, w.name AS warehouse_name
  FROM stock_takes t JOIN warehouses w ON w.id = t.warehouse_id`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const rows = await all<TakeHeaderRow>(env, `${LIST_SQL} ORDER BY t.take_date DESC, t.take_number DESC`);
  return json({ generatedAt: nowIso(), data: rows.map(toTakePayload) });
};

/** POST — start a stock take. Snapshots current on-hand as system_qty per line. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can start a stock take.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const fields: Fields = {};
  checkDate(fields, 'takeDate', b.takeDate, { label: 'Date' });
  const bad = invalid(fields); if (bad) return bad;
  const warehouseId = String(b.warehouseId ?? '').trim();
  if (!warehouseId || !await one(env, 'SELECT 1 AS x FROM warehouses WHERE id = ?', warehouseId)) return fail('VALIDATION', 'Pick a warehouse.', 422, { warehouseId: 'Pick a warehouse.' });
  const raw = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]) : [];
  const items = raw.map(l => ({ itemCode: String(l.itemCode ?? '').trim(), description: strOrNull(l.description) })).filter(l => l.itemCode);
  if (!items.length) return fail('VALIDATION', 'Add at least one item to count.', 422, { lines: 'Add an item.' });

  const id = genId('stk');
  let takeNumber = '';
  const now = nowIso();
  // The number is the highest so far plus one, so two made at once can pick the same one: the second header insert
  // then hits the unique number before anything is written, and simply takes the next number (isNumberClash).
  for (let attempt = 1; ; attempt++) {
    takeNumber = await nextNumber(env, 'stock_takes', 'take_number', 'STK');
    try {
      await run(env, `INSERT INTO stock_takes (id, take_number, warehouse_id, take_date, status, notes, created_by, created_at, updated_at)
                      VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`, id, takeNumber, warehouseId, strOrNull(b.takeDate) ?? mytToday(), strOrNull(b.notes), session.userId, now, now);
      break;
    } catch (e) { if (attempt >= 5 || !isNumberClash(e)) throw e; }
  }
  for (let i = 0; i < items.length; i++) {
    const system = await onHandOf(env, items[i].itemCode, warehouseId);
    await run(env, 'INSERT INTO stock_take_lines (id, stock_take_id, line_no, item_code, description, system_qty, counted_qty, variance) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)',
      genId('stl'), id, i + 1, items[i].itemCode, items[i].description, system);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'stock_take.create', entityTable: 'stock_takes', entityId: id, after: { takeNumber } });
  return json({ id, takeNumber }, 201);
};
