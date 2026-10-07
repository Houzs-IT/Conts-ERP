import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { toTakePayload, toTakeLinePayload, type TakeHeaderRow, type TakeLineRow } from '../../_lib/stock-ops';
import { intOrNull, genId } from '../../_lib/scm-util';

const HEADER_SQL = `
  SELECT t.id, t.take_number, t.warehouse_id, t.take_date, t.status, t.notes, t.created_at, t.updated_at, w.name AS warehouse_name
  FROM stock_takes t JOIN warehouses w ON w.id = t.warehouse_id WHERE t.id = ?`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const header = await one<TakeHeaderRow>(env, HEADER_SQL, id);
  if (!header) return fail('NOT_FOUND', 'That stock take does not exist.', 404);
  const lines = await all<TakeLineRow>(env, 'SELECT id, line_no, item_code, description, system_qty, counted_qty, variance FROM stock_take_lines WHERE stock_take_id = ? ORDER BY line_no', id);
  return json({ data: { ...toTakePayload(header), lines: lines.map(toTakeLinePayload) } });
};

/** PATCH — record counts (lines), or POST (adjust to counts) / CANCEL. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change a stock take.', 403);
  const id = String(params.id);
  const cur = await one<{ status: string; warehouse_id: string; take_date: string }>(env, 'SELECT status, warehouse_id, take_date FROM stock_takes WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That stock take does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const now = nowIso();

  if (b.status === 'CANCELLED') {
    if (cur.status === 'POSTED') return fail('CONFLICT', 'A posted stock take cannot be cancelled.', 409);
    await run(env, 'UPDATE stock_takes SET status = ?, updated_at = ? WHERE id = ?', 'CANCELLED', now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'stock_take.cancel', entityTable: 'stock_takes', entityId: id });
    return json({ id });
  }

  if (cur.status !== 'OPEN') return fail('CONFLICT', 'Only an open stock take can be changed.', 409);

  if (Array.isArray(b.lines)) {
    const dbLines = await all<{ id: string; system_qty: number }>(env, 'SELECT id, system_qty FROM stock_take_lines WHERE stock_take_id = ?', id);
    const sys = new Map(dbLines.map(l => [l.id, l.system_qty]));
    for (const l of b.lines as Record<string, unknown>[]) {
      const lineId = String(l.id ?? '');
      if (!sys.has(lineId)) continue;
      const counted = intOrNull(l.countedQty);
      const variance = counted === null ? null : counted - sys.get(lineId)!;
      await run(env, 'UPDATE stock_take_lines SET counted_qty = ?, variance = ? WHERE id = ?', counted, variance, lineId);
    }
  }

  if (b.status === 'POSTED') {
    const lines = await all<{ item_code: string; counted_qty: number | null; variance: number | null }>(env, 'SELECT item_code, counted_qty, variance FROM stock_take_lines WHERE stock_take_id = ?', id);
    for (const l of lines) {
      if (l.counted_qty !== null && l.variance !== null && l.variance !== 0) {
        await run(env, `INSERT INTO stock_movements (id, item_code, warehouse_id, qty_delta, movement_type, ref_type, ref_id, note, moved_at, created_by, created_at)
                        VALUES (?, ?, ?, ?, 'STOCK_TAKE', 'STK', ?, 'stock take adjustment', ?, ?, ?)`, genId('mv'), l.item_code, cur.warehouse_id, l.variance, id, cur.take_date, session.userId, now);
      }
    }
    await run(env, 'UPDATE stock_takes SET status = ?, updated_at = ? WHERE id = ?', 'POSTED', now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'stock_take.post', entityTable: 'stock_takes', entityId: id });
    return json({ id, status: 'POSTED' });
  }

  await run(env, 'UPDATE stock_takes SET updated_at = ? WHERE id = ?', now, id);
  return json({ id });
};
