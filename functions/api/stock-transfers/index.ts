import { type Env, all, one, run, json, fail, nowIso, audit, mytToday, isNumberClash } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { nextNumber, toTransferPayload, stockShortages, shortageText, type TransferHeaderRow } from '../../_lib/stock-ops';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';
import { checkDate, checkInt, invalid, type Fields } from '../../_lib/validate';

const LIST_SQL = `
  SELECT t.id, t.transfer_number, t.from_warehouse_id, t.to_warehouse_id, t.transfer_date, t.status, t.notes,
         t.created_at, t.updated_at, wf.name AS from_name, wt.name AS to_name
  FROM stock_transfers t JOIN warehouses wf ON wf.id = t.from_warehouse_id JOIN warehouses wt ON wt.id = t.to_warehouse_id`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const rows = await all<TransferHeaderRow>(env, `${LIST_SQL} ORDER BY t.transfer_date DESC, t.transfer_number DESC`);
  return json({ generatedAt: nowIso(), data: rows.map(toTransferPayload) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can transfer stock.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const fields: Fields = {};
  checkDate(fields, 'transferDate', b.transferDate, { label: 'Date' });
  if (Array.isArray(b.lines)) (b.lines as Record<string, unknown>[]).forEach((l, i) => checkInt(fields, `lines.${i}.qty`, l?.qty, { label: 'Quantity', min: 0 }));
  const bad = invalid(fields); if (bad) return bad;
  const from = String(b.fromWarehouseId ?? '').trim();
  const to = String(b.toWarehouseId ?? '').trim();
  if (!from || !to) return fail('VALIDATION', 'Pick both warehouses.', 422, { toWarehouseId: 'Pick a warehouse.' });
  if (from === to) return fail('VALIDATION', 'Source and destination must differ.', 422, { toWarehouseId: 'Must differ from source.' });
  if (!await one(env, 'SELECT 1 AS x FROM warehouses WHERE id = ?', from) || !await one(env, 'SELECT 1 AS x FROM warehouses WHERE id = ?', to)) return fail('VALIDATION', 'Unknown warehouse.', 422);

  const raw = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]) : [];
  const lines = raw.map(l => ({ itemCode: String(l.itemCode ?? '').trim(), description: strOrNull(l.description), qty: Math.max(0, intOrNull(l.qty) ?? 0) })).filter(l => l.itemCode && l.qty > 0);
  if (!lines.length) return fail('VALIDATION', 'Add at least one line with a quantity.', 422, { lines: 'Add a line.' });
  // Houzs refuses a transfer the source warehouse can't cover, with no override.
  const short = await stockShortages(env, from, lines);
  if (short.length) return fail('INSUFFICIENT_STOCK', `Not enough stock to transfer. ${await shortageText(env, from, short)}.`, 409, { lines: 'Not enough stock at the source warehouse.' });

  const id = genId('trf');
  let transferNumber = '';
  const now = nowIso();
  const tdate = strOrNull(b.transferDate) ?? mytToday();
  // The number is the highest so far plus one, so two made at once can pick the same one: the second header insert
  // then hits the unique number before anything is written, and simply takes the next number (isNumberClash).
  for (let attempt = 1; ; attempt++) {
    transferNumber = await nextNumber(env, 'stock_transfers', 'transfer_number', 'TRF');
    try {
      await run(env, `INSERT INTO stock_transfers (id, transfer_number, from_warehouse_id, to_warehouse_id, transfer_date, status, notes, created_by, created_at, updated_at)
                      VALUES (?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?)`, id, transferNumber, from, to, tdate, strOrNull(b.notes), session.userId, now, now);
      break;
    } catch (e) { if (attempt >= 5 || !isNumberClash(e)) throw e; }
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await run(env, 'INSERT INTO stock_transfer_lines (id, stock_transfer_id, line_no, item_code, description, qty) VALUES (?, ?, ?, ?, ?, ?)', genId('trl'), id, i + 1, l.itemCode, l.description, l.qty);
    await run(env, `INSERT INTO stock_movements (id, item_code, warehouse_id, qty_delta, movement_type, ref_type, ref_id, note, moved_at, created_by, created_at)
                    VALUES (?, ?, ?, ?, 'TRANSFER_OUT', 'TRF', ?, NULL, ?, ?, ?)`, genId('mv'), l.itemCode, from, -l.qty, id, tdate, session.userId, now);
    await run(env, `INSERT INTO stock_movements (id, item_code, warehouse_id, qty_delta, movement_type, ref_type, ref_id, note, moved_at, created_by, created_at)
                    VALUES (?, ?, ?, ?, 'TRANSFER_IN', 'TRF', ?, NULL, ?, ?, ?)`, genId('mv'), l.itemCode, to, l.qty, id, tdate, session.userId, now);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'stock_transfer.create', entityTable: 'stock_transfers', entityId: id, after: { transferNumber } });
  return json({ id, transferNumber }, 201);
};
