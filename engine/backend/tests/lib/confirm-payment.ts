/* A customer payment recorded and then CONFIRMED by finance (Conts, chew 29 Oct 2026; SOP 4.2/4.5) — the path every
   order payment now takes before it counts as received. Recording (the one hook every writer passes) leaves a DRAFT
   receipt and posts nothing; finance's confirmation turns the receipt FORMAL on the bank the money landed in, and
   only then does the payment post and its deposit invoice issue (acc/receipt-confirm). For the suites whose subject
   is what happens AFTER the money is received — deposit invoices, their close-out, refunds — this is the one
   helper, so none of them re-implements the confirmation. */
import type { Row } from '../../src/scm/lib/fake-postgrest';
import { bookSoPaymentBestEffort } from '../../src/scm/lib/so-payment-row';
import { postConfirmedPayment } from '../../src/acc/receipt-confirm';

type Sb = Parameters<typeof bookSoPaymentBestEffort>[0] & { tables: Record<string, Row[]> };

export async function recordAndConfirm(sb: Sb, row: Row, where = 'payment', bank = '310-0010') {
  const pays = (sb.tables.mfg_sales_order_payments ??= []);
  if (!pays.some((p) => p.id === row.id)) pays.push({ ...row });
  await bookSoPaymentBestEffort(sb, row, where);
  const receipts = (sb.tables.acc_official_receipts ??= []);
  let r = receipts.find((x) => x.payment_source === 'SOPAY' && x.payment_id === row.id);
  if (!r) {
    r = { id: `or-${String(row.id)}`, company_id: row.company_id, payment_source: 'SOPAY', payment_id: row.id };
    receipts.push(r);
  }
  r.status = 'FORMAL';
  r.channel_account_code = bank;
  return postConfirmedPayment(sb, 'SOPAY', String(row.id), Number(row.company_id));
}
