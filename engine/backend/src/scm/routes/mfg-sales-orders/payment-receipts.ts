// ----------------------------------------------------------------------------
// The official receipt of each payment on a sales order, seen from the order
// (chew, 21 Nov 2026: the salesperson gets the invoice and the formal OR).
//
//   receiptFactsFor   what GET /:docNo/payments adds to each payment row: its
//                     receipt (number, DRAFT / FORMAL), the instalment invoice a
//                     renovation receipt is for (acc/receipt-invoice), and
//                     whether finance has confirmed the money (acc/receipts:
//                     unconfirmed money is waiting for finance, not paid).
//   POST /:docNo/payments/:id/receipt
//                     the receipt row to print, for anyone who may see the order
//                     (the salesperson included; /accounting/receipts/ensure is
//                     the finance area's door). Fetches or heals it as ensure
//                     does; a draft prints DRAFT, a formal one its formal number.
// ----------------------------------------------------------------------------
import type { Context, Hono } from 'hono';
import type { Env, Variables } from '../../env';
import { activeCompanyId, scopeToCompany } from '../../lib/companyScope';
import { awaitsConfirmation, confirmedPaymentIds, ensureReceiptForPayment, loadReceiptParties, withReceiptParty } from '../../../acc/receipts';
import { linkReceiptInvoiceBestEffort } from '../../../acc/receipt-invoice';

type C = Context<{ Bindings: Env; Variables: Variables }>;
type Sb = Variables['supabase'];

export interface PaymentReceiptFacts {
  receipt_id: number | null;
  or_number: string | null;
  or_status: string | null;
  /** The instalment invoice a renovation receipt is for (null: the order alone). */
  sales_invoice_id: string | null;
  invoice_no: string | null;
  /** Finance has confirmed the money (or it is not money arriving: moved, imported, a credit). */
  confirmed: boolean;
}

type ReceiptRow = { id: number; or_number: string; status: string; payment_id: string; sales_invoice_id?: string | null; invoice_no?: string | null };

/** Each payment's receipt facts, keyed by payment id. A read that fails answers null: the list still shows the money,
    and says nothing about receipts rather than something wrong. */
export async function receiptFactsFor(
  sb: Sb,
  companyId: number | null,
  payments: ReadonlyArray<{ id: string; method: string | null; amount_sen: number }>,
): Promise<Map<string, PaymentReceiptFacts> | null> {
  const ids = payments.map((p) => String(p.id));
  if (ids.length === 0) return new Map();
  const read = (cols: string) => {
    let q = sb.from('acc_official_receipts').select(cols).eq('payment_source', 'SOPAY').in('payment_id', ids);
    if (companyId !== null) q = q.eq('company_id', companyId);
    return q;
  };
  let res = await read('id, or_number, status, payment_id, sales_invoice_id, invoice_no');
  /* A database without migration 0358 yet: the receipts without their invoice. */
  if (res.error && /sales_invoice_id|invoice_no/.test(res.error.message)) res = await read('id, or_number, status, payment_id');
  if (res.error) return null;
  const confirmed = await confirmedPaymentIds(sb, companyId, 'SOPAY', payments.filter((p) => awaitsConfirmation(p.method, p.amount_sen)).map((p) => String(p.id)));
  if (!confirmed.ok) return null;
  const byPayment = new Map((res.data as unknown as ReceiptRow[]).map((r) => [String(r.payment_id), r]));
  const out = new Map<string, PaymentReceiptFacts>();
  for (const p of payments) {
    const r = byPayment.get(String(p.id));
    out.set(String(p.id), {
      receipt_id: r ? Number(r.id) : null,
      or_number: r ? r.or_number : null,
      or_status: r ? r.status : null,
      sales_invoice_id: r?.sales_invoice_id ?? null,
      invoice_no: r?.invoice_no ?? null,
      confirmed: !awaitsConfirmation(p.method, p.amount_sen) || confirmed.ids.has(String(p.id)),
    });
  }
  return out;
}

/** The company the request acts for, or null when it is not resolved (scopeToCompany degrades the same way). */
export const companyOf = (c: C): number | null => activeCompanyId(c) ?? null;

export function registerPaymentReceiptRoutes(
  mfgSalesOrders: Hono<{ Bindings: Env; Variables: Variables }>,
  /* The sales-order row scope (mfg-sales-orders.ts selfScopedSalesBlocked): true = not the caller's order. */
  blocked: (c: C, docNo: string) => Promise<boolean>,
): void {
  mfgSalesOrders.post('/:docNo/payments/:id/receipt', async (c) => {
    const docNo = c.req.param('docNo');
    const paymentId = c.req.param('id');
    if (await blocked(c, docNo)) return c.json({ error: 'not_found' }, 404);
    const sb = c.get('supabase');
    const { data: pay, error: payErr } = await scopeToCompany(sb.from('mfg_sales_order_payments').select('id, method')
      .eq('id', paymentId).eq('so_doc_no', docNo), c).maybeSingle();
    if (payErr) return c.json({ error: 'load_failed', reason: payErr.message }, 500);
    if (!pay) return c.json({ error: 'not_found', message: `Payment ${paymentId} is not on ${docNo}.` }, 404);
    if ((pay as { method: string | null }).method === 'converted') {
      return c.json({ error: 'no_receipt', message: 'This money was moved from another order: its receipt is on that order.' }, 409);
    }
    const r = await ensureReceiptForPayment(sb, 'SOPAY', paymentId, companyOf(c));
    if (!r.ok) return c.json({ error: 'ensure_failed', reason: r.reason }, r.reason.endsWith('not found') ? 404 : 500);
    /* A draft renovation receipt names its invoice as things stand now (a formal one keeps its own). */
    if (r.status === 'DRAFT') await linkReceiptInvoiceBestEffort(sb, r.id);
    const { data: row, error: rowErr } = await sb.from('acc_official_receipts').select('*').eq('id', r.id).maybeSingle();
    if (rowErr || !row) return c.json({ error: 'ensure_failed', reason: rowErr?.message ?? 'receipt vanished after ensure' }, 500);
    /* RECEIVED FROM on the print: the order's phone and address, its brand — as finance's print gets them. */
    const co = companyOf(c);
    const rec = row as Record<string, unknown>;
    return c.json({ receipt: co == null ? rec : withReceiptParty(rec, await loadReceiptParties(sb, co, [rec])) });
  });
}
