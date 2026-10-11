import { type Env, all, one, run, json, fail, nowIso, audit, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { isCnStatus, normalizeCnLines, toCnHeaderPayload, type CnHeaderRow } from '../../_lib/consignment-notes';
import { strOrNull, genId } from '../../_lib/scm-util';
import { checkSen, checkInt, checkDate, checkPhone, invalid, type Fields } from '../../_lib/validate';

const COLS = 'id, cn_number, consignee_name, consignee_phone, cn_date, status, notes, total_sen, created_at, updated_at';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const search = (url.searchParams.get('search') ?? '').trim();
  const where: string[] = ['1 = 1']; const args: unknown[] = [];
  if (isCnStatus(status)) { where.push('status = ?'); args.push(status); }
  if (search) { where.push('(lower(cn_number) LIKE ? OR lower(consignee_name) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q); }
  const rows = await all<CnHeaderRow>(env, `SELECT ${COLS} FROM consignment_notes WHERE ${where.join(' AND ')} ORDER BY cn_date DESC, cn_number DESC`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toCnHeaderPayload) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can raise consignment notes.', 403);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const consigneeName = String(b.consigneeName ?? '').trim();
  if (!consigneeName) return fail('VALIDATION', 'Enter a consignee name.', 422, { consigneeName: 'Enter a consignee name.' });
  const fields: Fields = {};
  checkPhone(fields, 'consigneePhone', b.consigneePhone);
  checkDate(fields, 'cnDate', b.cnDate, { label: 'Date' });
  if (Array.isArray(b.lines)) (b.lines as Record<string, unknown>[]).forEach((l, i) => {
    checkInt(fields, `lines.${i}.qtyConsigned`, l?.qtyConsigned, { label: 'Quantity', min: 0 });
    checkSen(fields, `lines.${i}.unitPriceSen`, l?.unitPriceSen, { label: 'Unit price' });
  });
  const bad = invalid(fields); if (bad) return bad;
  const lines = normalizeCnLines(b.lines);
  if (!lines.length) return fail('VALIDATION', 'Add at least one line.', 422, { lines: 'Add at least one line.' });

  const total = lines.reduce((s, l) => s + l.lineTotalSen, 0);
  const id = genId('cn');
  const year = mytToday().slice(0, 4);
  const mx = await one<{ mx: string | null }>(env, 'SELECT MAX(cn_number) AS mx FROM consignment_notes WHERE cn_number LIKE ?', `CN-${year}-%`);
  const cnNumber = `CN-${year}-${String((mx?.mx ? Number(mx.mx.split('-')[2]) : 0) + 1).padStart(4, '0')}`;
  const now = nowIso();
  await run(env, `INSERT INTO consignment_notes (id, cn_number, consignee_name, consignee_phone, cn_date, status, notes, total_sen, created_by, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)`,
    id, cnNumber, consigneeName, strOrNull(b.consigneePhone), strOrNull(b.cnDate) ?? now.slice(0, 10), strOrNull(b.notes), total, session.userId, now, now);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await run(env, `INSERT INTO consignment_note_lines (id, consignment_note_id, line_no, item_code, description, uom, qty_consigned, qty_sold, qty_returned, unit_price_sen, line_total_sen)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      genId('cnl'), id, i + 1, l.itemCode, l.description, l.uom, l.qtyConsigned, l.unitPriceSen, l.lineTotalSen);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'consignment_note.create', entityTable: 'consignment_notes', entityId: id, after: { cnNumber, consigneeName } });
  return json({ id, cnNumber }, 201);
};
