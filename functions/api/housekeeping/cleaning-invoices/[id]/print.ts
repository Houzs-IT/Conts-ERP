import { type Env, fail } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { forwardClaims } from '../../../../_lib/claimsForward';
import { knownInvoice } from '../../../../_lib/cleaningBilling';
import { companyDetails, printPage, esc, ringgit, longDate } from '../../../../_lib/letterhead';

interface Payment { id: string; paidAt: string; method: string; amountSen: number; note: string | null; receiptNo: string | null; receiptStatus: string | null; confirmed: boolean }
interface Invoice {
  id: string; invoiceNo: string; invoiceDate: string; customerName: string; phone: string | null; address: string | null; totalSen: number;
  recordedSen: number; confirmedSen: number; outstandingSen: number; status: string;
  lines: { day: string | null; description: string; amountSen: number }[]; payments: Payment[];
}
const METHOD: Record<string, string> = { cash: 'Cash', transfer: 'Bank transfer' };

/** GET /api/housekeeping/cleaning-invoices/:id/print            the client's invoice, print-ready (Save as PDF)
 *  GET /api/housekeeping/cleaning-invoices/:id/print?payment=…  the receipt of one payment: DRAFT until finance confirms
 *  the money, then the official receipt with its OR number. The figures are the engine's. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaning invoices are printed by the office.', 403);
  const id = String(params.id);
  if (!(await knownInvoice(env, id))) return fail('NOT_FOUND', 'No cleaning job is billed on that invoice.', 404);
  const res = await forwardClaims(env, session, 'GET', `/cleaning-invoices?ids=${encodeURIComponent(id)}`);
  if (!res.ok) return res;
  const inv = ((await res.json<{ invoices?: Invoice[] }>().catch(() => null))?.invoices ?? [])[0];
  if (!inv) return fail('NOT_FOUND', 'The finance system has no such invoice.', 404);
  const company = await companyDetails(env);
  const party = `<div class="lh-parties"><dl>
    <div><dt>Bill to</dt><dd>${esc(inv.customerName)}</dd></div>
    ${inv.address ? `<div><dt>Address</dt><dd>${esc(inv.address)}</dd></div>` : ''}
    ${inv.phone ? `<div><dt>Phone</dt><dd>${esc(inv.phone)}</dd></div>` : ''}
  </dl><dl>`;

  const paymentId = new URL(request.url).searchParams.get('payment');
  if (paymentId) {
    const p = inv.payments.find(x => x.id === paymentId);
    if (!p) return fail('NOT_FOUND', 'That payment is not on this invoice.', 404);
    const formal = p.receiptStatus === 'FORMAL';
    const body = `<div class="lh-title"><h1>${formal ? 'Official receipt' : 'Receipt'}</h1><span class="lh-docno">${esc(formal ? p.receiptNo : p.receiptNo ?? 'DRAFT')}</span></div>
${formal ? '' : '<div class="lh-flag">Draft: finance has not confirmed this money in the bank yet. The official receipt carries its OR number once they do.</div>'}
${party}
    <div><dt>Paid on</dt><dd>${esc(longDate(p.paidAt))}</dd></div>
    <div><dt>Method</dt><dd>${esc(METHOD[p.method] ?? p.method)}</dd></div>
    <div><dt>Invoice</dt><dd>${esc(inv.invoiceNo)}</dd></div>
  </dl></div>
<table class="lh-table"><thead><tr><th>Description</th><th class="num" style="width:22%">Amount</th></tr></thead><tbody>
  <tr><td>Payment for invoice ${esc(inv.invoiceNo)}, cleaning services${p.note ? `<div class="ref">${esc(p.note)}</div>` : ''}</td><td class="num">${ringgit(p.amountSen)}</td></tr>
  <tr class="lh-total"><td>Amount received</td><td class="num">${ringgit(p.amountSen)}</td></tr>
</tbody></table>`;
    return printPage({ company, title: `Receipt ${p.receiptNo ?? inv.invoiceNo}`, body, watermark: formal ? undefined : 'DRAFT', filename: `receipt-${p.receiptNo ?? inv.invoiceNo}.html` });
  }

  const paid = inv.payments.filter(p => p.receiptStatus !== 'CANCELLED');
  const body = `<div class="lh-title"><h1>Invoice</h1><span class="lh-docno">${esc(inv.invoiceNo)}</span></div>
${inv.status === 'CANCELLED' ? '<div class="lh-void">This invoice is cancelled.</div>' : ''}
${party}
    <div><dt>Invoice date</dt><dd>${esc(longDate(inv.invoiceDate))}</dd></div>
  </dl></div>
<table class="lh-table"><thead><tr><th style="width:8%">No</th><th>Description</th><th style="width:16%">Date</th><th class="num" style="width:18%">Amount</th></tr></thead><tbody>
${inv.lines.map((l, i) => `  <tr><td>${i + 1}</td><td>${esc(l.description)}</td><td>${esc(longDate(l.day))}</td><td class="num">${ringgit(l.amountSen)}</td></tr>`).join('\n')}
  <tr class="lh-total"><td colspan="3">Total</td><td class="num">${ringgit(inv.totalSen)}</td></tr>
${paid.map(p => `  <tr class="lh-minor"><td colspan="3">Paid ${esc(longDate(p.paidAt))}, ${esc(METHOD[p.method] ?? p.method)}${p.receiptNo && p.receiptStatus === 'FORMAL' ? ` (${esc(p.receiptNo)})` : ''}</td><td class="num">− ${ringgit(p.amountSen)}</td></tr>`).join('\n')}
${paid.length ? `  <tr class="lh-total"><td colspan="3">Balance due</td><td class="num">${ringgit(inv.outstandingSen)}</td></tr>` : ''}
</tbody></table>`;
  return printPage({ company, title: `Invoice ${inv.invoiceNo}`, body, watermark: inv.status === 'CANCELLED' ? 'CANCELLED' : undefined, filename: `invoice-${inv.invoiceNo}.html` });
};
