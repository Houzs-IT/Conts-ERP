/* The Sales Invoices list's Bills for column (owner, 6 Nov 2026): a renovation invoice bills an instalment, not a DO, so
   the list says which one ("Instalment 2 of 4 · 30%"). One batched read per table for the page, rows mutated in place
   like the other list stamps. An invoice not billed by instalment gets null. */

import { chunkIn } from './paginate-all';

interface BillRow { sales_invoice_id: string; so_doc_no: string; instalment_id: string; seq: number }
interface InstalmentRow { id: string; so_doc_no: string; pct_bp: number }

export function billsForLabel(seq: number, ofCount: number, pctBp: number | null): string {
  const pct = pctBp === null ? '' : ` · ${Number((pctBp / 100).toFixed(2))}%`;
  return `Instalment ${seq} of ${ofCount}${pct}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the scm PostgREST client is untyped
export async function stampBillsFor(sb: any, rows: unknown): Promise<void> {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const list = rows as Array<Record<string, unknown>>;
  const ids = list.map((r) => r.id as string).filter(Boolean);
  const bills = await chunkIn<BillRow>(ids, (b, from, to) =>
    sb.from('reno_instalment_bills').select('sales_invoice_id, so_doc_no, instalment_id, seq').in('sales_invoice_id', b).range(from, to));
  /* A display-only column: a failed read shows a dash, never fails the invoice list. */
  if (bills.error) {
    console.error('[renovation-si-bills-for] bill read failed:', bills.error.message);
    return;
  }
  const docs = [...new Set(bills.data.map((b) => b.so_doc_no))];
  const insts = docs.length
    ? await chunkIn<InstalmentRow>(docs, (b, from, to) => sb.from('reno_doc_instalments').select('id, so_doc_no, pct_bp').in('so_doc_no', b).range(from, to))
    : { data: [] as InstalmentRow[], error: null };
  if (insts.error) {
    console.error('[renovation-si-bills-for] instalment read failed:', insts.error.message);
    return;
  }
  const countOf = new Map<string, number>();
  for (const i of insts.data) countOf.set(i.so_doc_no, (countOf.get(i.so_doc_no) ?? 0) + 1);
  const pctOf = new Map(insts.data.map((i) => [i.id, i.pct_bp]));
  const byInvoice = new Map(bills.data.map((b) => [b.sales_invoice_id, b]));
  for (const r of list) {
    const b = byInvoice.get(r.id as string);
    r.bills_for = b ? billsForLabel(b.seq, countOf.get(b.so_doc_no) ?? b.seq, pctOf.get(b.instalment_id) ?? null) : null;
  }
}
