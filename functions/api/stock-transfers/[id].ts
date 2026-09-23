import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { toTransferPayload, toTransferLinePayload, type TransferHeaderRow, type TransferLineRow } from '../../_lib/stock-ops';
import { genId } from '../../_lib/scm-util';

const HEADER_SQL = `
  SELECT t.id, t.transfer_number, t.from_warehouse_id, t.to_warehouse_id, t.transfer_date, t.status, t.notes,
         t.created_at, t.updated_at, wf.name AS from_name, wt.name AS to_name
  FROM stock_transfers t JOIN warehouses wf ON wf.id = t.from_warehouse_id JOIN warehouses wt ON wt.id = t.to_warehouse_id WHERE t.id = ?`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const header = await one<TransferHeaderRow>(env, HEADER_SQL, id);
  if (!header) return fail('NOT_FOUND', 'That transfer does not exist.', 404);
  const lines = await all<TransferLineRow>(env, 'SELECT id, line_no, item_code, description, qty FROM stock_transfer_lines WHERE stock_transfer_id = ? ORDER BY line_no', id);
  return json({ data: { ...toTransferPayload(header), lines: lines.map(toTransferLinePayload) } });
};

/** PATCH — cancel (reverses the two movements per line). */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can change transfers.', 403);
  const id = String(params.id);
  const cur = await one<{ status: string; from_warehouse_id: string; to_warehouse_id: string; transfer_date: string }>(env, 'SELECT status, from_warehouse_id, to_warehouse_id, transfer_date FROM stock_transfers WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That transfer does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  if (b.status !== 'CANCELLED') return fail('VALIDATION', 'Only CANCELLED is accepted.', 422);
  if (cur.status === 'CANCELLED') return json({ id });

  const lines = await all<{ item_code: string; qty: number }>(env, 'SELECT item_code, qty FROM stock_transfer_lines WHERE stock_transfer_id = ?', id);
  const now = nowIso();
  for (const l of lines) {
    await run(env, `INSERT INTO stock_movements (id, item_code, warehouse_id, qty_delta, movement_type, ref_type, ref_id, note, moved_at, created_by, created_at)
                    VALUES (?, ?, ?, ?, 'TRANSFER_IN', 'TRF-REV', ?, 'transfer cancelled', ?, ?, ?)`, genId('mv'), l.item_code, cur.from_warehouse_id, l.qty, id, now.slice(0, 10), session.userId, now);
    await run(env, `INSERT INTO stock_movements (id, item_code, warehouse_id, qty_delta, movement_type, ref_type, ref_id, note, moved_at, created_by, created_at)
                    VALUES (?, ?, ?, ?, 'TRANSFER_OUT', 'TRF-REV', ?, 'transfer cancelled', ?, ?, ?)`, genId('mv'), l.item_code, cur.to_warehouse_id, -l.qty, id, now.slice(0, 10), session.userId, now);
  }
  await run(env, 'UPDATE stock_transfers SET status = ?, updated_at = ? WHERE id = ?', 'CANCELLED', now, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'stock_transfer.cancel', entityTable: 'stock_transfers', entityId: id });
  return json({ id });
};
