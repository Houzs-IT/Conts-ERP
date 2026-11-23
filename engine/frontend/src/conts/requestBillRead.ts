// Conts only (not part of Houzs's code): the New AP invoice form opened from a payment request, filled in further from
// the request's own papers as the bill reader reads them (chew, 16 Nov 2026: "make ap invoice 时不会自动带文件里面的
// description 吗？"). The reader is the one Scan bill uses (POST /payment-vouchers/extract); this only decides what of it
// lands on the form. Pure, so it is tested on its own.
import type { BillExtraction, VendorMemory } from "../vendor/scm/lib/payment-voucher-queries";
import { upperFill } from "../vendor/scm/lib/ocr-fill";
import { fmtSen } from "../vendor/shared/format";
import type { ApFormLine, ApFormValues } from "../pages/scm-v2/ApInvoiceForm";

export type ReadBill = { extraction: BillExtraction; supplierMatch: { id: string; name: string } | null; memory: VendorMemory | null };

/** The form as the request filled it, with what the papers say:
 *  - the supplier's invoice number and date as printed (the date the expense is booked on); the due date when the
 *    request named none; the supplier the reader matched when the payee was typed in;
 *  - each line's description as printed: line by line when the bill has as many lines as the request (the request's
 *    amounts, projects and units kept), else the bill's own lines (their amounts; the request's first line's department,
 *    project and unit, to check);
 *  - the account the vendor was last paid on, for a line with none.
 *  And the sentence that says what was read. */
export function fillFromPapers(base: ApFormValues, read: ReadBill): { values: ApFormValues; note: string } {
  const ex = read.extraction;
  const printed = ex.lines.filter((l): l is { description: string | null; amountSen: number } => l.amountSen != null && l.amountSen > 0);
  const account = read.memory?.debitAccountCode ?? "";
  let lines: ApFormLine[] = base.lines;
  let how: string | null = null;
  if (printed.length > 0 && printed.length === base.lines.length) {
    lines = base.lines.map((l, i) => ({ ...l, description: upperFill(printed[i]!.description) ?? l.description }));
    how = "Descriptions from the bill; the request's amounts kept.";
  } else if (printed.length > 0) {
    const first = base.lines[0];
    lines = printed.map((p, i) => ({
      rid: i + 1, description: upperFill(p.description) ?? "", debitAccountCode: "", amountSen: p.amountSen,
      department: first?.department ?? "", projectId: first?.projectId ?? null, subDepartmentId: first?.subDepartmentId ?? null, unitId: first?.unitId ?? null,
      sourceRequestLineId: i === 0 ? first?.sourceRequestLineId ?? null : null,
    }));
    how = `The bill's ${printed.length} line(s) in place of the request's ${base.lines.length}: check each line's department, project and unit.`;
  }
  if (account) lines = lines.map((l) => (l.debitAccountCode ? l : { ...l, debitAccountCode: account }));
  const quote = ex.documentKind === "quotation" || ex.documentKind === "proforma";
  const values: ApFormValues = {
    ...base,
    /* A quotation on paper is booked as one (SOP 3.8), replaced when the formal invoice comes. */
    provisional: base.provisional === true || quote,
    supplierId: base.supplierId || read.supplierMatch?.id || "",
    supplierRef: base.supplierRef || upperFill(ex.invoiceNumber) || "",
    invoiceDate: ex.invoiceDate || base.invoiceDate,
    dueDate: base.dueDate || ex.dueDate || "",
    lines,
  };
  const note = [
    "Read from the request's papers — check every figure before saving.",
    ex.invoiceNumber ? `Invoice ${upperFill(ex.invoiceNumber)}${ex.invoiceDate ? ` of ${ex.invoiceDate}` : ""}.` : "No invoice number was readable.",
    quote ? "The paper reads as a quotation: ticked Quotation." : null,
    how,
    !base.supplierId && read.supplierMatch ? `Looks like supplier ${read.supplierMatch.name}.` : null,
    account ? `Account ${account} filled from your last ${read.memory?.payeeName ?? "same-vendor"} bill — check it.` : null,
    ex.totalSen != null && ex.totalSen !== lines.reduce((n, l) => n + (l.amountSen > 0 ? l.amountSen : 0), 0)
      ? `The bill's total is ${fmtSen(ex.totalSen)}, the lines here come to ${fmtSen(lines.reduce((n, l) => n + l.amountSen, 0))}.` : null,
  ].filter(Boolean).join(" ");
  return { values, note };
}
