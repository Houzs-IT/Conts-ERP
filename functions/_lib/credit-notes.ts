/** Credit and debit notes, copied from Houzs ERP (backend/src/scm/routes/credit-notes.ts,
 *  backend/src/acc/credit-notes.ts). See migrations-pg/0037_credit_notes.sql for what each kind
 *  does to a balance. */
import { type Env, one, nowIso, mytToday } from './db';

export const NOTE_KINDS = ['CN', 'DN', 'SCN'] as const;
export type NoteKind = typeof NOTE_KINDS[number];
export const isNoteKind = (v: unknown): v is NoteKind => typeof v === 'string' && (NOTE_KINDS as readonly string[]).includes(v);
export const NOTE_KIND_WORD: Record<NoteKind, string> = { CN: 'Credit note', DN: 'Debit note', SCN: 'Supplier credit note' };

export interface NoteHeaderRow {
  id: string; note_number: string; kind: NoteKind; party_type: string; party_name: string; supplier_id: string | null;
  sales_order_id: string | null; sales_invoice_id: string | null; purchase_invoice_id: string | null; source_doc_no: string | null;
  note_date: string; total_sen: number; reason: string | null; notes: string | null; status: string;
  created_at: string; posted_at: string | null; cancelled_at: string | null;
  so_doc_no?: string | null; si_number?: string | null; pi_number?: string | null;
}
export interface NoteLineRow { id: string; line_no: number; description: string | null; amount_sen: number }

export function toNotePayload(r: NoteHeaderRow) {
  return {
    id: r.id, noteNumber: r.note_number, kind: r.kind, partyType: r.party_type, partyName: r.party_name, supplierId: r.supplier_id ?? '',
    salesOrderId: r.sales_order_id ?? '', soDocNo: r.so_doc_no ?? '', salesInvoiceId: r.sales_invoice_id ?? '', salesInvoiceNumber: r.si_number ?? '',
    purchaseInvoiceId: r.purchase_invoice_id ?? '', purchaseInvoiceNumber: r.pi_number ?? '', sourceDocNo: r.source_doc_no ?? '',
    noteDate: r.note_date, totalSen: r.total_sen, reason: r.reason ?? '', notes: r.notes ?? '', status: r.status,
    postedAt: r.posted_at ?? '', cancelledAt: r.cancelled_at ?? '',
  };
}
export function toNoteLinePayload(r: NoteLineRow) { return { id: r.id, lineNo: r.line_no, description: r.description ?? '', amountSen: r.amount_sen }; }

export const HEADER_SQL = `
  SELECT n.id, n.note_number, n.kind, n.party_type, n.party_name, n.supplier_id, n.sales_order_id, n.sales_invoice_id, n.purchase_invoice_id,
         n.source_doc_no, n.note_date, n.total_sen, n.reason, n.notes, n.status, n.created_at, n.posted_at, n.cancelled_at,
         so.doc_no AS so_doc_no, si.invoice_number AS si_number, pi.invoice_number AS pi_number
  FROM credit_notes n
  LEFT JOIN sales_orders so ON so.id = n.sales_order_id
  LEFT JOIN sales_invoices si ON si.id = n.sales_invoice_id
  LEFT JOIN purchase_invoices pi ON pi.id = n.purchase_invoice_id`;

export type CleanLine = { description: string | null; amountSen: number };

/** Houzs's rule: 1 to 50 lines, each a positive whole number of sen. */
export function buildLines(raw: unknown): { lines: CleanLine[]; total: number } | { message: string } {
  const arr = Array.isArray(raw) ? raw as Record<string, unknown>[] : [];
  if (arr.length === 0 || arr.length > 50) return { message: 'A note takes 1 to 50 lines.' };
  const lines: CleanLine[] = [];
  for (const [i, l] of arr.entries()) {
    const amount = Number(l?.amountSen);
    if (!Number.isInteger(amount) || amount <= 0) return { message: `Line ${i + 1}: enter an amount above zero.` };
    const d = typeof l?.description === 'string' ? l.description.trim() : '';
    lines.push({ description: d || null, amountSen: amount });
  }
  return { lines, total: lines.reduce((s, l) => s + l.amountSen, 0) };
}

/** Separate number series per kind, as in Houzs: CN-2026-0001, DN-2026-0001, SCN-2026-0001. */
export async function nextNoteNumber(env: Env, kind: NoteKind): Promise<string> {
  const year = mytToday().slice(0, 4);
  const row = await one<{ mx: string | null }>(env, 'SELECT MAX(note_number) AS mx FROM credit_notes WHERE note_number LIKE ?', `${kind}-${year}-%`);
  const last = row?.mx ? Number(row.mx.split('-')[2]) : 0;
  return `${kind}-${year}-${String((Number.isFinite(last) ? last : 0) + 1).padStart(4, '0')}`;
}
