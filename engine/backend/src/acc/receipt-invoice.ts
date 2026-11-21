// ----------------------------------------------------------------------------
// acc/receipt-invoice — which instalment invoice a renovation payment's receipt
// is for (chew, 21 Nov 2026: the OR is linked to the sales order AND the invoice).
//
// A renovation contract is billed one instalment invoice at a time
// (scm/lib/renovation-billing.ts) and the salesperson records the customer's
// money on the order. The receipt of that money names the invoice it pays: the
// OLDEST live instalment invoice of the order (by instalment) that the money
// finance has ALREADY CONFIRMED does not cover yet. Earlier confirmed money fills
// the invoices in order, the invoice's own confirmed payments first; unconfirmed
// money covers nothing (it is not received until finance confirms it, SOP 4.2).
// No such invoice (nothing billed yet, or every invoice already covered: money
// ahead of its invoice) leaves the receipt on the order alone.
//
// The link is made when the payment is recorded (its draft receipt is born) and
// worked out again when finance confirms it, since an invoice may have been
// issued in between. A formal receipt keeps the invoice it was confirmed with.
// Only receipts of order payments (SOPAY) on renovation orders are linked; any
// other receipt is left exactly as it was.
//
// Best-effort like every receipt hook: a link that cannot be worked out never
// un-records the money or blocks a confirmation.
// ----------------------------------------------------------------------------

import { awaitsConfirmation, confirmedPaymentIds } from './receipts';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped throughout the acc layer */
type Db = any;

/** One instalment invoice competing for the order's confirmed money, in instalment order. */
export interface InstalmentInvoice {
  id: string;
  invoiceNo: string;
  seq: number;
  totalSen: number;
  /** Confirmed money taken on the invoice itself (its own SIPAY payments). */
  ownConfirmedSen: number;
}

export type ReceiptInvoice = { salesInvoiceId: string; invoiceNo: string };

/** The invoice the next money is for: the first, by instalment, that `orderConfirmedSen` (confirmed money on the
    order, filling the invoices in order) and its own confirmed payments do not cover. Null when every one is covered
    or there is none. */
export function pickInvoiceForPayment(invoices: readonly InstalmentInvoice[], orderConfirmedSen: number): ReceiptInvoice | null {
  let pool = Math.max(0, orderConfirmedSen);
  for (const inv of [...invoices].sort((a, b) => a.seq - b.seq || a.invoiceNo.localeCompare(b.invoiceNo))) {
    const open = Math.max(0, inv.totalSen - inv.ownConfirmedSen);
    const take = Math.min(pool, open);
    pool -= take;
    if (take < open) return { salesInvoiceId: inv.id, invoiceNo: inv.invoiceNo };
  }
  return null;
}

/* A cancelled invoice billed nothing and a draft is not issued: neither is money's to pay (si-order-deposit's reading). */
const DEAD = new Set(['CANCELLED', 'DRAFT', 'VOID']);

type Result = { ok: true; renovation: false } | { ok: true; renovation: true; invoice: ReceiptInvoice | null } | { ok: false; reason: string };

/** The invoice a payment on this order is for. `renovation: false` for any other order: its receipt is not linked. */
export async function renoInvoiceForPayment(sb: Db, companyId: number, soDocNo: string, paymentId: string): Promise<Result> {
  const { data: so, error: soErr } = await sb.from('mfg_sales_orders').select('so_kind').eq('company_id', companyId).eq('doc_no', soDocNo).maybeSingle();
  if (soErr) return { ok: false, reason: `order: ${String(soErr.message)}` };
  if ((so as { so_kind?: string | null } | null)?.so_kind !== 'RENOVATION') return { ok: true, renovation: false };

  const [bills, pays] = await Promise.all([
    sb.from('reno_instalment_bills').select('sales_invoice_id, invoice_number, seq, kind').eq('so_doc_no', soDocNo),
    sb.from('mfg_sales_order_payments').select('id, method, amount_sen').eq('company_id', companyId).eq('so_doc_no', soDocNo),
  ]);
  if (bills.error) return { ok: false, reason: `instalment bills: ${String(bills.error.message)}` };
  if (pays.error) return { ok: false, reason: `order payments: ${String(pays.error.message)}` };
  const billRows = ((bills.data ?? []) as Array<{ sales_invoice_id: string | null; invoice_number: string | null; seq: number; kind: string }>)
    .filter((b) => b.kind === 'INVOICE' && b.sales_invoice_id);
  const siIds = billRows.map((b) => String(b.sales_invoice_id));

  let invoices: InstalmentInvoice[] = [];
  if (siIds.length > 0) {
    const [sis, siPays] = await Promise.all([
      sb.from('sales_invoices').select('id, invoice_number, total_sen, status').eq('company_id', companyId).in('id', siIds),
      sb.from('sales_invoice_payments').select('id, sales_invoice_id, method, amount_sen').eq('company_id', companyId).in('sales_invoice_id', siIds),
    ]);
    if (sis.error) return { ok: false, reason: `invoices: ${String(sis.error.message)}` };
    if (siPays.error) return { ok: false, reason: `invoice payments: ${String(siPays.error.message)}` };
    const siPayRows = (siPays.data ?? []) as Array<{ id: string; sales_invoice_id: string; method: string | null; amount_sen: number }>;
    const siConfirmed = await confirmedPaymentIds(sb, companyId, 'SIPAY', siPayRows.filter((p) => awaitsConfirmation(p.method, p.amount_sen)).map((p) => String(p.id)));
    if (!siConfirmed.ok) return { ok: false, reason: `invoice receipts: ${siConfirmed.reason}` };
    const ownBySi = new Map<string, number>();
    for (const p of siPayRows) {
      if (awaitsConfirmation(p.method, p.amount_sen) && !siConfirmed.ids.has(String(p.id))) continue;
      ownBySi.set(String(p.sales_invoice_id), (ownBySi.get(String(p.sales_invoice_id)) ?? 0) + Number(p.amount_sen));
    }
    const siById = new Map(((sis.data ?? []) as Array<{ id: string; invoice_number: string; total_sen: number; status: string | null }>).map((s) => [String(s.id), s]));
    invoices = billRows.flatMap((b) => {
      const si = siById.get(String(b.sales_invoice_id));
      if (!si || DEAD.has(String(si.status ?? '').toUpperCase())) return [];
      return [{ id: String(si.id), invoiceNo: String(si.invoice_number), seq: Number(b.seq), totalSen: Number(si.total_sen), ownConfirmedSen: ownBySi.get(String(si.id)) ?? 0 }];
    });
  }
  if (invoices.length === 0) return { ok: true, renovation: true, invoice: null };

  /* Earlier confirmed money on the order: every confirmed payment but this one. */
  const others = ((pays.data ?? []) as Array<{ id: string; method: string | null; amount_sen: number }>).filter((p) => String(p.id) !== paymentId);
  const confirmed = await confirmedPaymentIds(sb, companyId, 'SOPAY', others.filter((p) => awaitsConfirmation(p.method, p.amount_sen)).map((p) => String(p.id)));
  if (!confirmed.ok) return { ok: false, reason: `order receipts: ${confirmed.reason}` };
  const orderConfirmedSen = others
    .filter((p) => !awaitsConfirmation(p.method, p.amount_sen) || confirmed.ids.has(String(p.id)))
    .reduce((s, p) => s + Number(p.amount_sen), 0);
  return { ok: true, renovation: true, invoice: pickInvoiceForPayment(invoices, orderConfirmedSen) };
}

/** Work out the receipt's invoice again and store it. Silent for a receipt that is not an order payment's, or not on a
    renovation order. `includeFormal` lets the confirm itself relink the receipt it has just made formal. */
export async function linkReceiptInvoice(sb: Db, receiptId: number, opts: { includeFormal?: boolean } = {}): Promise<{ ok: true; invoice: ReceiptInvoice | null; linked: boolean } | { ok: false; reason: string }> {
  const { data, error } = await sb.from('acc_official_receipts').select('id, company_id, status, payment_source, payment_id, doc_no').eq('id', receiptId).maybeSingle();
  if (error) return { ok: false, reason: String(error.message) };
  const r = data as { id: number; company_id: number; status: string; payment_source: string; payment_id: string; doc_no: string | null } | null;
  if (!r || r.payment_source !== 'SOPAY' || !r.doc_no) return { ok: true, invoice: null, linked: false };
  if (r.status === 'FORMAL' && opts.includeFormal !== true) return { ok: true, invoice: null, linked: false };
  const found = await renoInvoiceForPayment(sb, Number(r.company_id), r.doc_no, String(r.payment_id));
  if (!found.ok) return found;
  if (!found.renovation) return { ok: true, invoice: null, linked: false };
  const { error: upErr } = await sb.from('acc_official_receipts')
    .update({ sales_invoice_id: found.invoice?.salesInvoiceId ?? null, invoice_no: found.invoice?.invoiceNo ?? null })
    .eq('id', r.id);
  if (upErr) return { ok: false, reason: String(upErr.message) };
  return { ok: true, invoice: found.invoice, linked: true };
}

/** linkReceiptInvoice for the hooks: logs, never throws. A payment key (an order payment's id) finds its receipt. */
export async function linkReceiptInvoiceBestEffort(sb: Db, receipt: number | { orderPaymentId: string }, opts: { includeFormal?: boolean } = {}): Promise<void> {
  try {
    let receiptId: number;
    if (typeof receipt === 'number') receiptId = receipt;
    else {
      const { data, error } = await sb.from('acc_official_receipts').select('id').eq('payment_source', 'SOPAY').eq('payment_id', receipt.orderPaymentId).maybeSingle();
      // eslint-disable-next-line no-console
      if (error) { console.error('[acc/receipt-invoice] receipt not read:', receipt.orderPaymentId, error.message); return; }
      if (!data) return;
      receiptId = Number((data as { id: number }).id);
    }
    const r = await linkReceiptInvoice(sb, receiptId, opts);
    // eslint-disable-next-line no-console
    if (!r.ok) console.error('[acc/receipt-invoice] receipt not linked to its invoice:', receiptId, r.reason);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[acc/receipt-invoice] receipt link threw:', receipt, e);
  }
}
