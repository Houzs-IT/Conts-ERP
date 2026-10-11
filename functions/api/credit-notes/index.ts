import { type Env, all, one, run, json, fail, nowIso, audit, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { HEADER_SQL, NOTE_KIND_WORD, buildLines, isNoteKind, nextNoteNumber, toNotePayload, type NoteHeaderRow } from '../../_lib/credit-notes';
import { strOrNull, genId } from '../../_lib/scm-util';
import { checkSen, checkDate, invalid, type Fields } from '../../_lib/validate';

/** GET /api/credit-notes?kind=&status= — newest first. Finance only, as in Houzs. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Credit and debit notes are for finance and management.', 403);
  const url = new URL(request.url);
  const kind = (url.searchParams.get('kind') ?? '').toUpperCase();
  const status = (url.searchParams.get('status') ?? '').toUpperCase();
  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (isNoteKind(kind)) { where.push('n.kind = ?'); args.push(kind); }
  if (['DRAFT', 'POSTED', 'CANCELLED'].includes(status)) { where.push('n.status = ?'); args.push(status); }
  const rows = await all<NoteHeaderRow>(env, `${HEADER_SQL} WHERE ${where.join(' AND ')} ORDER BY n.note_date DESC, n.note_number DESC LIMIT 500`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toNotePayload) });
};

/** POST /api/credit-notes { kind, supplierId? | salesOrderId? | salesInvoiceId? | partyName?, purchaseInvoiceId?,
 *  sourceDocNo?, noteDate?, reason?, notes?, lines: [{ description, amountSen }] } — raised as a DRAFT. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can raise credit or debit notes.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const kind = String(b.kind ?? '').trim().toUpperCase();
  if (!isNoteKind(kind)) return fail('VALIDATION', 'Say which note this is: a credit note or debit note to a customer, or a credit note from a supplier.', 422, { kind: 'Pick a note type.' });
  const fields: Fields = {};
  checkDate(fields, 'noteDate', b.noteDate, { label: 'Note date' });
  if (Array.isArray(b.lines)) (b.lines as Record<string, unknown>[]).forEach((l, i) => checkSen(fields, `lines.${i}.amountSen`, l?.amountSen, { label: 'Amount', required: true, min: 1 }));
  const bad = invalid(fields); if (bad) return bad;
  const built = buildLines(b.lines);
  if ('message' in built) return fail('VALIDATION', built.message, 422, { lines: built.message });

  // Who the note is for. Houzs: a supplier note names the supplier; a customer note takes the
  // customer from the sales order, else the sales invoice, else the name typed.
  let partyType: 'CUSTOMER' | 'SUPPLIER';
  let partyName: string;
  let supplierId: string | null = null;
  let salesOrderId: string | null = null;
  let salesInvoiceId: string | null = null;
  let purchaseInvoiceId: string | null = null;
  if (kind === 'SCN') {
    partyType = 'SUPPLIER';
    const sup = await one<{ id: string; name: string }>(env, 'SELECT id, name FROM suppliers WHERE id = ?', String(b.supplierId ?? '').trim());
    if (!sup) return fail('VALIDATION', 'Pick the supplier this credit note is from.', 422, { supplierId: 'Pick a supplier.' });
    supplierId = sup.id; partyName = sup.name;
    const piId = strOrNull(b.purchaseInvoiceId);
    if (piId) {
      const pi = await one<{ supplier_id: string }>(env, 'SELECT supplier_id FROM purchase_invoices WHERE id = ?', piId);
      if (!pi || pi.supplier_id !== sup.id) return fail('VALIDATION', 'That purchase invoice is not from this supplier.', 422, { purchaseInvoiceId: 'Not this supplier\'s invoice.' });
      purchaseInvoiceId = piId;
    }
  } else {
    partyType = 'CUSTOMER';
    const soId = strOrNull(b.salesOrderId);
    const siId = strOrNull(b.salesInvoiceId);
    if (soId) {
      const so = await one<{ id: string; customer_name: string }>(env, 'SELECT id, customer_name FROM sales_orders WHERE id = ?', soId);
      if (!so) return fail('VALIDATION', 'That sales order does not exist.', 422, { salesOrderId: 'Unknown sales order.' });
      salesOrderId = so.id; partyName = so.customer_name;
      if (siId) {
        const si = await one<{ sales_order_id: string | null }>(env, 'SELECT sales_order_id FROM sales_invoices WHERE id = ?', siId);
        if (!si) return fail('VALIDATION', 'That sales invoice does not exist.', 422, { salesInvoiceId: 'Unknown sales invoice.' });
        salesInvoiceId = siId;
      }
    } else if (siId) {
      const si = await one<{ id: string; customer_name: string; sales_order_id: string | null }>(env, 'SELECT id, customer_name, sales_order_id FROM sales_invoices WHERE id = ?', siId);
      if (!si) return fail('VALIDATION', 'That sales invoice does not exist.', 422, { salesInvoiceId: 'Unknown sales invoice.' });
      salesInvoiceId = si.id; salesOrderId = si.sales_order_id; partyName = si.customer_name;
    } else {
      const typed = String(b.partyName ?? '').trim();
      if (!typed) return fail('VALIDATION', 'Name the customer — the sales order, the invoice, or the name itself.', 422, { partyName: 'Name the customer.' });
      partyName = typed;
    }
  }

  const id = genId('cn');
  const noteNumber = await nextNoteNumber(env, kind);
  const now = nowIso();
  const noteDate = strOrNull(b.noteDate) ?? mytToday();
  await run(env, `INSERT INTO credit_notes (id, note_number, kind, party_type, party_name, supplier_id, sales_order_id, sales_invoice_id, purchase_invoice_id,
      source_doc_no, note_date, total_sen, reason, notes, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)`,
    id, noteNumber, kind, partyType, partyName, supplierId, salesOrderId, salesInvoiceId, purchaseInvoiceId,
    strOrNull(b.sourceDocNo), noteDate, built.total, strOrNull(b.reason), strOrNull(b.notes), session.userId, now, now);
  for (const [i, l] of built.lines.entries()) {
    await run(env, 'INSERT INTO credit_note_lines (id, note_id, line_no, description, amount_sen) VALUES (?, ?, ?, ?, ?)', genId('cnl'), id, i + 1, l.description, l.amountSen);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'credit_note.create', entityTable: 'credit_notes', entityId: id, after: { noteNumber, kind: NOTE_KIND_WORD[kind], partyName, totalSen: built.total } });
  return json({ id, noteNumber }, 201);
};
