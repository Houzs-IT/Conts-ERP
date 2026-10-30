// ----------------------------------------------------------------------------
// acc/receipt-confirm — what follows finance confirming a customer payment.
//
// Conts (chew, 29 Oct 2026; SOP 4.2/4.5): "Salesperson 在系统更新收款 → 财务核对
// 银行确实收到 → 才算已收，项目额度才增加". The salesperson records the payment
// as before; it stays a DRAFT receipt and posts nothing. Finance checks the bank
// statement and confirms it — the receipt turns FORMAL on the bank it landed in
// (the manual confirm), or on the acquirer's payout bank (card settlement, and
// the receipts backfill that replays it). Only then is the money received:
//   • the payment posts (Dr that bank, or the card clearing account / Cr the
//     customer's control) — acc/payments posts only a confirmed payment;
//   • an order payment's deposit invoice issues;
//   • the project limit counts it (conts/project-limit reads FORMAL receipts).
//
// Best-effort from the confirmer's point of view, like every hook after the
// money: the receipt is formal either way; a posting refusal is returned to
// the manual confirm, logged elsewhere, and healed by the customer-payment
// backfill (Self-check), which posts every confirmed payment it finds.
// ----------------------------------------------------------------------------

import { postSiPayment, postSoPayment, type PostPaymentResult, type SiPaymentRow, type SoPaymentRow } from './payments';
import { formaliseReceiptsForSettlement, receiptConfirmation } from './receipts';
import { issueDepositInvoiceBestEffort } from './deposit-invoices';
import { reverseJournal } from './engine';
import { resolveRoles } from './rules';
import { paymentReconciliation } from './payment-reconciled';
import { creditConfirmedPaymentOfCancelledSo } from '../scm/lib/customer-credits';
import { nextInstalmentAmount } from '../scm/shared/renovation-money';

/* The untyped client the poster takes, borrowed rather than spelled out again
   (a new file's lint ceiling is zero — payout-charge.ts's reason). */
type Db = Parameters<typeof postSoPayment>[0];

const log = (...args: unknown[]): void => {
  // eslint-disable-next-line no-console
  console.error('[acc/receipt-confirm]', ...args);
};

type Fail = { ok: false; status: string; reason: string };

/** The payment's live posted entry when it debits a money account OTHER than
    `bank` — a cash / transfer payment posted before confirmation existed, on the
    old rule's account (cash CASH, transfer BANK_DEFAULT). Null when there is no
    live entry or it already sits on `bank`. */
async function entryOnAnotherBank(
  sb: Db,
  source: 'SOPAY' | 'SIPAY',
  paymentId: string,
  companyId: number,
  bank: string,
): Promise<{ ok: true; entry: { id: string; entry_date: string | null; account: string } | null } | Fail> {
  const { data: jes, error: jeErr } = await sb.from('journal_entries')
    .select('id, je_no, entry_date, reversed').eq('source_type', source).eq('source_doc_no', paymentId).eq('company_id', companyId);
  if (jeErr) return { ok: false, status: 'entry_read_failed', reason: jeErr.message };
  const live = ((jes ?? []) as Array<{ id: string; entry_date: string | null; reversed: boolean | null }>).find((j) => j.reversed !== true);
  if (!live) return { ok: true, entry: null };
  const { data: lines, error: lErr } = await sb.from('journal_entry_lines').select('account_code, debit_sen').eq('journal_entry_id', live.id);
  if (lErr) return { ok: false, status: 'entry_read_failed', reason: lErr.message };
  const debit = ((lines ?? []) as Array<{ account_code: string; debit_sen: number | null }>).find((l) => Number(l.debit_sen ?? 0) > 0);
  if (!debit || debit.account_code === bank) return { ok: true, entry: null };
  return { ok: true, entry: { id: live.id, entry_date: live.entry_date, account: debit.account_code } };
}

/** May this payment be confirmed onto `bank`? Refused (with the sentence to
    show) when it was posted before confirmation existed onto ANOTHER account
    and that entry is already reconciled — matched on a bank statement, in a
    closed month, settled on a merchant report (acc/payment-reconciled, the
    edit path's own check): the books closed over it, so it is not moved, and
    finance confirms it on the account it sits on. Fails closed. */
export async function bankChangeRefusal(
  sb: Db,
  p: { source: 'SOPAY' | 'SIPAY'; paymentId: string; companyId: number; method: string; bank: string },
): Promise<{ ok: true; refusal: string | null } | Fail> {
  if (p.method !== 'cash' && p.method !== 'transfer') return { ok: true, refusal: null };
  const on = await entryOnAnotherBank(sb, p.source, p.paymentId, p.companyId, p.bank);
  if (!on.ok) return on;
  if (!on.entry) return { ok: true, refusal: null };
  const rec = await paymentReconciliation(sb, p.companyId, p.paymentId, p.source);
  if (!rec.ok) return { ok: false, status: 'reconciliation_unreadable', reason: `Could not check whether this payment is already reconciled, so nothing was changed (${rec.reason}).` };
  if (!rec.by) return { ok: true, refusal: null };
  const where = rec.by.kind === 'bank' ? `matched on the bank statement (entry ${rec.by.jeNo})`
    : rec.by.kind === 'month' ? `in the closed month ${rec.by.month}`
    : `settled on the merchant report of ${rec.by.on}`;
  return { ok: true, refusal: `This payment is already posted to ${on.entry.account} and ${where}, so it cannot move to ${p.bank}: confirm it on ${on.entry.account}.` };
}

/** A cash / transfer payment posted BEFORE confirmation existed sits on the
    accounts of the old rule (cash CASH, transfer BANK_DEFAULT). Confirmed now
    onto another bank, its entry is reversed — the contra dated on the original
    entry, as an edit's is (acc/payment-repost) — so the post that follows lands
    on the bank finance chose. Nothing to do when it already sits there; never
    done to an entry already reconciled (bankChangeRefusal, which the confirm
    route asks first; asked again here so no other caller can move one). */
async function alignToConfirmedBank(
  sb: Db,
  source: 'SOPAY' | 'SIPAY',
  paymentId: string,
  companyId: number,
  method: string,
): Promise<{ ok: true } | Fail> {
  if (method !== 'cash' && method !== 'transfer') return { ok: true };
  const conf = await receiptConfirmation(sb, companyId, source, paymentId);
  if (!conf.ok) return { ok: false, status: 'receipt_read_failed', reason: conf.reason };
  if (!conf.confirmed || conf.legacy) return { ok: true };
  const bank = conf.channelAccountCode || (await resolveRoles(sb, companyId)).BANK_DEFAULT;
  const on = await entryOnAnotherBank(sb, source, paymentId, companyId, bank);
  if (!on.ok) return on;
  if (!on.entry) return { ok: true };
  const live = on.entry;
  const refused = await bankChangeRefusal(sb, { source, paymentId, companyId, method, bank });
  if (!refused.ok) return refused;
  if (refused.refusal) return { ok: false, status: 'payment_reconciled', reason: refused.refusal };
  const undone = await reverseJournal(sb, {
    sourceType: source,
    sourceDocNo: paymentId,
    companyId,
    entryDate: String(live.entry_date ?? '').slice(0, 10) || undefined,
    narration: (orig) => `Reversal of ${orig.je_no} — payment confirmed onto ${bank}`,
  });
  if (!undone.ok) return { ok: false, status: undone.status, reason: undone.reason ?? 'the old entry could not be reversed' };
  return { ok: true };
}

/** Post one confirmed payment, by its source, from the row as stored — and
    issue an order payment's deposit invoice. Idempotent: a posted payment
    answers already_posted, a standing invoice already_issued. */
export async function postConfirmedPayment(
  sb: Db,
  source: 'SOPAY' | 'SIPAY',
  paymentId: string,
  companyId: number,
  /* True only when THIS call's confirmation turned the receipt formal: a payment confirmed before its order was
     cancelled is already in the cancel-time credit, and a re-run must not add it again. */
  opts: { newlyConfirmed?: boolean } = {},
): Promise<PostPaymentResult> {
  if (source === 'SIPAY') {
    const { data, error } = await sb.from('sales_invoice_payments')
      .select('id, sales_invoice_id, paid_at, method, merchant_provider, amount_sen, company_id')
      .eq('id', paymentId).eq('company_id', companyId).maybeSingle();
    if (error) return { ok: false, status: 'payment_read_failed', reason: error.message };
    if (!data) return { ok: false, status: 'payment_not_found', reason: `invoice payment ${paymentId} not found` };
    const aligned = await alignToConfirmedBank(sb, 'SIPAY', paymentId, companyId, String((data as SiPaymentRow).method));
    if (!aligned.ok) return aligned;
    return postSiPayment(sb, data as SiPaymentRow);
  }
  const { data, error } = await sb.from('mfg_sales_order_payments')
    .select('id, so_doc_no, paid_at, method, merchant_provider, amount_sen, company_id, converted_from_so_doc_no, created_at, created_by')
    .eq('id', paymentId).eq('company_id', companyId).maybeSingle();
  if (error) return { ok: false, status: 'payment_read_failed', reason: error.message };
  if (!data) return { ok: false, status: 'payment_not_found', reason: `order payment ${paymentId} not found` };
  const aligned = await alignToConfirmedBank(sb, 'SOPAY', paymentId, companyId, String((data as SoPaymentRow).method));
  if (!aligned.ok) return aligned;
  const posted = await postSoPayment(sb, data as SoPaymentRow);
  /* The deposit invoice stands on the confirmation, not on the posting: a
     posting refusal (a customer with no account yet) is healed separately. */
  await issueDepositInvoiceBestEffort(sb, data as Record<string, unknown>, 'confirm');
  /* A cancelled order credited the money confirmed when it was cancelled;
     money confirmed since joins the customer's credit (idempotent per payment). */
  if (!opts.newlyConfirmed) return posted;
  const row = data as SoPaymentRow;
  const credited = await creditConfirmedPaymentOfCancelledSo(sb, {
    paymentId, docNo: row.so_doc_no, amountSen: Number(row.amount_sen), method: row.method, companyId,
  });
  if (credited.reason && credited.reason !== 'order_live' && credited.reason !== 'already_credited') log('confirm: cancelled-order credit not added:', paymentId, credited.reason);
  return posted;
}

/** Settlement's confirm (and the receipts backfill replaying it): the card
    receipts turn FORMAL on the payout bank, and each confirmed payment posts
    (an already-formal one too: a retry after a refused post heals, and a posted
    one echoes). Never throws; the outcomes are formaliseReceiptsForSettlement's. */
export async function confirmReceiptsForSettlement(
  sb: Db,
  companyId: number,
  companyCode: string,
  payments: Array<{ source: string; id: string }>,
  bankAccountCode: string | null,
  actor: string | null,
): Promise<Array<{ paymentId: string; outcome: string }>> {
  const outcomes = await formaliseReceiptsForSettlement(sb, companyId, companyCode, payments, bankAccountCode, actor);
  for (const o of outcomes) {
    if (o.outcome !== 'formalised' && o.outcome !== 'already_formal') continue;
    const source = payments.find((p) => p.id === o.paymentId)?.source === 'SIPAY' ? 'SIPAY' : 'SOPAY';
    try {
      const r = await postConfirmedPayment(sb, source, o.paymentId, companyId, { newlyConfirmed: o.outcome === 'formalised' });
      if (!r.ok) log(`settlement: ${source} ${o.paymentId} confirmed but not posted:`, r.status, r.reason);
    } catch (e) {
      log(`settlement: posting ${source} ${o.paymentId} threw:`, e);
    }
  }
  return outcomes;
}

/* ── Payment before its invoice (renovation; spec 7.6, plan 2026-10-30-renovation-revenue-ledger.md Task 9) ──────── */

export type BillNextOffer = {
  soDocNo: string; instalmentId: string; seq: number; label: string;
  /** What the bill route expects (`expectedAmountSen`), worked out as billInstalment does. */
  amountSen: number;
  receivedSen: number; billedSen: number;
};

const RENO_LIVE = ['RENO_CONFIRMED', 'RENO_IN_PROGRESS', 'RENO_COMPLETED'];

/** The SO a payment belongs to: an order payment's own, an invoice payment's invoice's. */
export async function soOfPayment(sb: Db, source: 'SOPAY' | 'SIPAY', paymentId: string, companyId: number): Promise<string | null> {
  if (source === 'SOPAY') {
    const { data } = await sb.from('mfg_sales_order_payments').select('so_doc_no').eq('id', paymentId).eq('company_id', companyId).maybeSingle();
    return (data as { so_doc_no?: string | null } | null)?.so_doc_no ?? null;
  }
  const { data: pay } = await sb.from('sales_invoice_payments').select('sales_invoice_id').eq('id', paymentId).eq('company_id', companyId).maybeSingle();
  const siId = (pay as { sales_invoice_id?: string | null } | null)?.sales_invoice_id;
  if (!siId) return null;
  const { data: si } = await sb.from('sales_invoices').select('so_doc_no').eq('id', siId).eq('company_id', companyId).maybeSingle();
  return (si as { so_doc_no?: string | null } | null)?.so_doc_no ?? null;
}

/** After a confirm on a live renovation contract: when the money finance has confirmed on it exceeds what it has
    invoiced net (issued invoices + what AutoCount invoiced before go-live - contract credits - negative instalments,
    the rule of renovation-billing netBilledSql), the next unbilled instalment, when billing it would raise an
    invoice. Null otherwise, and on any read that does not answer: the offer is a convenience, and the bill route
    checks everything again. */
export async function nextInstalmentOffer(sb: Db, companyId: number, soDocNo: string): Promise<BillNextOffer | null> {
  try {
    const { data: so } = await sb.from('mfg_sales_orders').select('so_kind, status').eq('company_id', companyId).eq('doc_no', soDocNo).maybeSingle();
    const head = so as { so_kind?: string; status?: string } | null;
    if (!head || head.so_kind !== 'RENOVATION' || !RENO_LIVE.includes(String(head.status))) return null;

    const [items, insts, bills, sis, contract, credits, soPays] = await Promise.all([
      sb.from('mfg_sales_order_items').select('total_sen, cancelled').eq('company_id', companyId).eq('doc_no', soDocNo),
      sb.from('reno_doc_instalments').select('id, seq, label, pct_bp').eq('so_doc_no', soDocNo),
      sb.from('reno_instalment_bills').select('instalment_id, kind, amount_sen, credit_note_id').eq('so_doc_no', soDocNo),
      sb.from('sales_invoices').select('id, status, total_sen').eq('company_id', companyId).eq('so_doc_no', soDocNo),
      sb.from('reno_so_contracts').select('billed_before_golive_sen').eq('so_doc_no', soDocNo).maybeSingle(),
      sb.from('reno_contract_credits').select('credit_note_id, amount_sen').eq('so_doc_no', soDocNo),
      sb.from('mfg_sales_order_payments').select('id').eq('company_id', companyId).eq('so_doc_no', soDocNo),
    ]);
    for (const r of [items, insts, bills, sis, contract, credits, soPays]) if (r.error) return null;
    type Bill = { instalment_id: string; kind: string; amount_sen: number; credit_note_id: string | null };
    type Si = { id: string; status: string; total_sen: number };
    const billRows = (bills.data ?? []) as Bill[];
    const creditRows = (credits.data ?? []) as Array<{ credit_note_id: string | null; amount_sen: number }>;

    /* Cancelled credit notes lower nothing. */
    const noteIds = [...new Set([...creditRows.map((c) => c.credit_note_id), ...billRows.map((b) => b.credit_note_id)].filter((x): x is string => !!x))];
    const cancelledNotes = new Set<string>();
    if (noteIds.length > 0) {
      const { data: notes, error } = await sb.from('acc_credit_notes').select('id, status').in('id', noteIds);
      if (error) return null;
      for (const n of (notes ?? []) as Array<{ id: string; status: string }>) if (n.status === 'CANCELLED') cancelledNotes.add(n.id);
    }
    const live = (id: string | null) => !id || !cancelledNotes.has(id);
    const creditedSen = creditRows.filter((c) => live(c.credit_note_id)).reduce((s, c) => s + Number(c.amount_sen), 0);

    const siRows = (sis.data ?? []) as Si[];
    const issued = siRows.filter((s) => !['DRAFT', 'CANCELLED'].includes(String(s.status).toUpperCase()));
    const netBilledSen = issued.reduce((s, x) => s + Number(x.total_sen ?? 0), 0)
      + Number((contract.data as { billed_before_golive_sen?: number } | null)?.billed_before_golive_sen ?? 0)
      - creditedSen
      - billRows.filter((b) => b.kind === 'CREDIT_NOTE' && live(b.credit_note_id)).reduce((s, b) => s - Number(b.amount_sen), 0);

    /* Confirmed money: the FORMAL receipts of the order's payments and of its invoices' payments. */
    const soPayIds = ((soPays.data ?? []) as Array<{ id: string }>).map((p) => String(p.id));
    let siPayIds: string[] = [];
    if (siRows.length > 0) {
      const { data: sp, error } = await sb.from('sales_invoice_payments').select('id').eq('company_id', companyId).in('sales_invoice_id', siRows.map((s) => s.id));
      if (error) return null;
      siPayIds = ((sp ?? []) as Array<{ id: string }>).map((p) => String(p.id));
    }
    let receivedSen = 0;
    for (const [source, ids] of [['SOPAY', soPayIds], ['SIPAY', siPayIds]] as const) {
      if (ids.length === 0) continue;
      const { data: recs, error } = await sb.from('acc_official_receipts').select('amount_sen')
        .eq('company_id', companyId).eq('payment_source', source).eq('status', 'FORMAL').in('payment_id', ids);
      if (error) return null;
      receivedSen += ((recs ?? []) as Array<{ amount_sen: number }>).reduce((s, r) => s + Number(r.amount_sen ?? 0), 0);
    }
    if (receivedSen <= netBilledSen) return null;

    /* The next instalment at billInstalment's amount: the schedule as billingView reads it. */
    const schedule = ((insts.data ?? []) as Array<{ id: string; seq: number; label: string | null; pct_bp: number }>)
      .map((i) => ({ ...i, seq: Number(i.seq), pct_bp: Number(i.pct_bp) })).sort((a, b) => a.seq - b.seq);
    const billed = new Set(billRows.map((b) => b.instalment_id));
    const next = schedule.find((i) => !billed.has(i.id));
    if (!next) return null;
    const revisedSen = ((items.data ?? []) as Array<{ total_sen: number | null; cancelled: boolean | null }>)
      .filter((r) => r.cancelled !== true).reduce((s, r) => s + Number(r.total_sen ?? 0), 0);
    const { amountSen } = nextInstalmentAmount({
      instalments: schedule.map((i) => ({ seq: i.seq, pctBp: i.pct_bp })),
      seq: next.seq,
      revisedContractSen: revisedSen,
      billedSen: billRows.reduce((s, b) => s + Number(b.amount_sen), 0) - creditedSen,
    });
    if (amountSen <= 0) return null;
    return { soDocNo, instalmentId: next.id, seq: next.seq, label: next.label || `Instalment ${next.seq}`, amountSen, receivedSen, billedSen: netBilledSen };
  } catch (e) {
    log('next instalment offer not worked out:', soDocNo, e);
    return null;
  }
}
