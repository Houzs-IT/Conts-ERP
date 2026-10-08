import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { toCnHeaderPayload, toCnLinePayload, type CnHeaderRow, type CnLineRow } from '../../_lib/consignment-notes';
import { intOrNull } from '../../_lib/scm-util';

const COLS = 'id, cn_number, consignee_name, consignee_phone, cn_date, status, notes, total_sen, created_at, updated_at';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const header = await one<CnHeaderRow>(env, `SELECT ${COLS} FROM consignment_notes WHERE id = ?`, id);
  if (!header) return fail('NOT_FOUND', 'That consignment note does not exist.', 404);
  const lines = await all<CnLineRow>(env, 'SELECT id, line_no, item_code, description, uom, qty_consigned, qty_sold, qty_returned, unit_price_sen, line_total_sen FROM consignment_note_lines WHERE consignment_note_id = ? ORDER BY line_no', id);
  return json({ data: { ...toCnHeaderPayload(header), lines: lines.map(toCnLinePayload) } });
};

/** PATCH — settle lines (record sold/returned), or close/cancel. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change consignment notes.', 403);
  const id = String(params.id);
  const cur = await one<{ status: string }>(env, 'SELECT status FROM consignment_notes WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That consignment note does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const now = nowIso();

  if (b.status === 'CANCELLED' || b.status === 'CLOSED') {
    if (cur.status === b.status) return json({ id });
    await run(env, 'UPDATE consignment_notes SET status = ?, updated_at = ? WHERE id = ?', b.status, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: `consignment_note.${String(b.status).toLowerCase()}`, entityTable: 'consignment_notes', entityId: id });
    return json({ id });
  }

  if (Array.isArray(b.lines)) {
    if (cur.status === 'CANCELLED' || cur.status === 'CLOSED') return fail('CONFLICT', 'This consignment note is closed.', 409);
    const dbLines = await all<{ id: string; qty_consigned: number }>(env, 'SELECT id, qty_consigned FROM consignment_note_lines WHERE consignment_note_id = ?', id);
    const cap = new Map(dbLines.map(l => [l.id, l.qty_consigned]));
    for (const l of b.lines as Record<string, unknown>[]) {
      const lineId = String(l.id ?? '');
      if (!cap.has(lineId)) continue;
      const consigned = cap.get(lineId)!;
      const sold = Math.max(0, Math.min(consigned, intOrNull(l.qtySold) ?? 0));
      const returned = Math.max(0, Math.min(consigned - sold, intOrNull(l.qtyReturned) ?? 0));
      await run(env, 'UPDATE consignment_note_lines SET qty_sold = ?, qty_returned = ? WHERE id = ?', sold, returned, lineId);
    }
    // Recompute status from settlement.
    const after = await all<{ qty_consigned: number; qty_sold: number; qty_returned: number }>(env, 'SELECT qty_consigned, qty_sold, qty_returned FROM consignment_note_lines WHERE consignment_note_id = ?', id);
    const anySold = after.some(l => l.qty_sold > 0);
    const allSettled = after.length > 0 && after.every(l => l.qty_sold + l.qty_returned >= l.qty_consigned);
    const status = allSettled ? 'CLOSED' : anySold ? 'PARTIALLY_SETTLED' : 'OPEN';
    await run(env, 'UPDATE consignment_notes SET status = ?, updated_at = ? WHERE id = ?', status, now, id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'consignment_note.settle', entityTable: 'consignment_notes', entityId: id, after: { status } });
    return json({ id, status });
  }

  return fail('VALIDATION', 'Send settlement lines, or status CLOSED / CANCELLED.', 422);
};
