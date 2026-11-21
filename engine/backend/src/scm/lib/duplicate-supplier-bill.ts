/* One supplier bill is owed once. A second live purchase invoice (or AP
   invoice) carrying the same supplier's bill number is the same debt booked
   twice. Ported from Houzs (lib/duplicate-supplier-bill.ts, #5535).

   The key: whitespace out, upper case, so "inv 001" and "INV001" are one bill.
   CANCELLED rows are not live and never block. Purchase invoices and AP
   invoices are compared within their own table.

   Conts: Houzs splits AP invoices by doc kind (invoice / debit note); Conts has
   no debit-note kind, but it has the QUOTATION (ap_invoices.provisional, SOP
   3.8) — a bill booked on the supplier's quotation before the formal invoice
   comes. A quotation's number is a quotation number, not a bill number, so a
   quotation never pairs with a formal invoice: the formal invoice that
   replaces it (on the same row, or a new one) is not a duplicate. Two live
   quotations with the same number, or two formal invoices, still are. A bill
   made from a payment request is the request's one bill (one live bill per
   request, mig 0329) and is checked like any other. */

export const billRefKey = (s: unknown): string =>
  typeof s === 'string' ? s.replace(/\s+/g, '').toUpperCase() : '';

export type DuplicateBill = { id: string; invoiceNumber: string; status: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the SCM PostgREST client is untyped everywhere it is passed
type Sb = { from(table: string): any };

/** `excludeId` is the row being edited (null on create). `quotation` is the AP
 *  invoice's provisional flag, or null for purchase invoices, which have none. */
export async function findDuplicateSupplierBill(
  sb: Sb,
  table: 'purchase_invoices' | 'ap_invoices',
  q: { companyId: number; supplierId: string; ref: unknown; excludeId: string | null; quotation: boolean | null },
): Promise<{ ok: true; duplicate: DuplicateBill | null } | { ok: false; reason: string }> {
  const key = billRefKey(q.ref);
  if (!key || !q.supplierId) return { ok: true, duplicate: null };
  /* Narrowed in the database by an ilike that allows anything between the
     key's characters (so stored spacing cannot hide a match), then decided
     exactly here on the normalised key. */
  const pattern = `%${[...key].map((ch) => (/[%_\\]/.test(ch) ? `\\${ch}` : ch)).join('%')}%`;
  const cols = table === 'ap_invoices' ? 'id, invoice_number, status, supplier_invoice_ref, provisional' : 'id, invoice_number, status, supplier_invoice_ref';
  const { data, error } = await sb.from(table).select(cols)
    .eq('company_id', q.companyId).eq('supplier_id', q.supplierId)
    .neq('status', 'CANCELLED').ilike('supplier_invoice_ref', pattern);
  if (error) return { ok: false, reason: String(error.message ?? error) };
  const hit = ((data ?? []) as Array<Record<string, unknown>>).find((r) =>
    String(r.id) !== q.excludeId
    && String(r.status ?? '').toUpperCase() !== 'CANCELLED'
    && billRefKey(r.supplier_invoice_ref) === key
    && (q.quotation === null || (r.provisional === true) === q.quotation));
  return { ok: true, duplicate: hit ? { id: String(hit.id), invoiceNumber: String(hit.invoice_number), status: String(hit.status) } : null };
}

export function duplicateBillRefusal(ref: unknown, dup: DuplicateBill) {
  return {
    error: 'duplicate_supplier_bill',
    message: `This supplier's bill ${String(ref).trim()} is already booked as ${dup.invoiceNumber} (${dup.status}). Open that one, or cancel it first if it is wrong.`,
    existing: dup,
  };
}
