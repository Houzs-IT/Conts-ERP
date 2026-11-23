// The receipts taken on each sales order's invoices, for the "paid on this SO"
// rule (shared/so-outstanding.ts soPaidSen). One batched read per call.
import { soInvoiceReceiptsSen, type SoInvoiceReceiptRow } from '../shared/so-outstanding';

/** docNo -> sen. A failed read comes back `ok: false`: "could not read" is not "nothing paid". */
export async function readSoInvoiceReceipts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST client, untyped like the other scm readers
  sb: any,
  docNos: readonly string[],
  companyId: number | null,
): Promise<{ ok: true; sen: Map<string, number> } | { ok: false; reason: string }> {
  const sen = new Map<string, number>();
  const docs = [...new Set(docNos.filter(Boolean))];
  if (docs.length === 0) return { ok: true, sen };
  const rows: Array<SoInvoiceReceiptRow & { so_doc_no: string }> = [];
  /* Batches of 200 order numbers keep the IN list well inside a URL. */
  for (let i = 0; i < docs.length; i += 200) {
    let q = sb.from('sales_invoices').select('so_doc_no, status, total_sen, paid_sen').in('so_doc_no', docs.slice(i, i + 200));
    if (companyId != null) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) return { ok: false, reason: `invoice receipts: ${error.message}` };
    rows.push(...((data ?? []) as Array<SoInvoiceReceiptRow & { so_doc_no: string }>));
  }
  const byDoc = new Map<string, SoInvoiceReceiptRow[]>();
  for (const r of rows) {
    const list = byDoc.get(r.so_doc_no) ?? [];
    list.push(r);
    byDoc.set(r.so_doc_no, list);
  }
  for (const [doc, rows] of byDoc) sen.set(doc, soInvoiceReceiptsSen(rows));
  return { ok: true, sen };
}
