/**
 * The bill on a Direct pay request, read as it is attached (TODO item 19; Houzs payment-request-bill.ts, owner there
 * 2 Oct 2026: the request fills its empty fields from the bill it reads). The engine reads the paper
 * (POST /claims/extract with kind "request"); this decides what of it lands on the form. Pure, so node --test runs it.
 */

/** What the bill says: the amount and the issuer, its due date, what it is for and the supplier on the list it names
 *  (matched in the engine; none when two fit equally). Nothing when it cannot be read. */
export interface RequestBillRead {
  amountSen: number | null; date: string | null; vendorName: string | null;
  dueDate?: string | null; summary?: string | null; documentKind?: string;
  supplier?: { id: string; code: string | null; name: string } | null;
}

/** The fields a request bill fills: only those still empty, so nothing typed or picked is overwritten. A supplier is
 *  picked only when the request is against no PO and none is chosen; the printed issuer goes to "Pay to" only when
 *  the list has no match; the due date only when it is not past. */
export function requestBillFill(read: RequestBillRead, form: {
  amountSen: number | null; hasSupplierOrPo: boolean; payeeName: string; wantedOn: string; note: string; today: string;
}): { amountSen?: number; supplier?: { id: string; code: string; name: string }; payeeName?: string; wantedOn?: string; note?: string } {
  const out: ReturnType<typeof requestBillFill> = {};
  if (form.amountSen == null && read.amountSen != null && read.amountSen > 0) out.amountSen = read.amountSen;
  if (!form.hasSupplierOrPo) {
    if (read.supplier) out.supplier = { id: read.supplier.id, code: read.supplier.code ?? '', name: read.supplier.name };
    else if (!form.payeeName.trim() && read.vendorName) out.payeeName = read.vendorName.slice(0, 200);
  }
  if (!form.wantedOn && read.dueDate && read.dueDate >= form.today) out.wantedOn = read.dueDate;
  if (!form.note.trim() && read.summary) out.note = read.summary.slice(0, 500);
  return out;
}
