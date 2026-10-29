// ----------------------------------------------------------------------------
// acc/receipts — Official Receipts (GL redesign item 9, owner 2026-09-05).
//
// One receipt per customer payment, born the moment the payment is recorded
// — rows of scm.acc_official_receipts (its OWN table since docs/bugs/0658:
// the first migration named it acc_receipts, the general money-in receipt's
// table, and so built nothing):
//   DRAFT   printable with a DRAFT stamp, numbered on the draft series
//           ({co}DraftOR-YYMM-NNN) — the salesperson can hand something over;
//   FORMAL  the moment the money is CONFIRMED — which mints the channel
//           number: card when merchant recon confirms that payment; transfer
//           AND cash when finance confirms it against the bank statement and
//           names the bank it landed in (chew, 29 Oct 2026, SOP 4.2/4.5: the
//           company banks all its cash, so cash is confirmed onto a bank,
//           never the CASH account). FORMAL is what "received" means: the
//           payment posts, its deposit invoice issues and the project limit
//           counts it only from here (acc/receipt-confirm.ts).
//
// The channel letters are the PV letter table (scm.acc_bank_letters) — the
// same bank is the same letter on a voucher and a receipt; C is RESERVED for
// cash. Formal-number order per channel = the order money was confirmed, so
// a slow reconciliation never scrambles the cash run (the owner's exact
// worry: 期间的 or number 都是 cash 了不是?).
//
// Everything here is BEST-EFFORT from the payment flows' point of view: a
// receipt that fails to create must never un-record a payment (the money
// happened), so callers log and carry on — and ensureReceiptForPayment heals
// any gap the next time the receipt is needed.
// ----------------------------------------------------------------------------

import { docMonthTag, mintMonthlyDocNo } from '../scm/lib/doc-no';
import { docPrefixForCode } from '../scm/lib/companyScope';
import { resolveRoles } from './rules';

export const CASH_SERIES_LETTER = 'C';

export type ReceiptPaymentInput = {
  source: 'SOPAY' | 'SIPAY';
  paymentId: string;
  companyId: number;
  companyCode: string;
  docNo: string | null;
  customerName?: string | null;
  method: string;
  amountSen: number;
  paidAt: string | null;
  createdBy?: string | null;
};

async function digitsOf(sb: any, companyId: number): Promise<number> {
  const { data, error } = await sb.from('acc_numbering').select('doc_digits').eq('company_id', companyId).maybeSingle();
  /* Width is cosmetic (the parser reads any length) — a blip here must not
     block a money confirmation, so the default width answers, out loud. */
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[receipts] width read failed, defaulting to 3:', error.message);
    return 3;
  }
  return Number((data as { doc_digits?: number } | null)?.doc_digits ?? 3);
}

/** The channel letter for a money account: C for the company's CASH role,
    else the bank's own letter from the PV table. Null = not configured yet. */
export async function channelLetterFor(
  sb: any,
  companyId: number,
  accountCode: string,
): Promise<{ ok: true; letter: string | null } | { ok: false; reason: string }> {
  const roles = await resolveRoles(sb, companyId);
  if (accountCode === roles.CASH) return { ok: true, letter: CASH_SERIES_LETTER };
  const { data, error } = await sb.from('acc_bank_letters')
    .select('letter').eq('company_id', companyId).eq('account_code', accountCode).maybeSingle();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, letter: (data as { letter?: string } | null)?.letter ?? null };
}

/**
 * Create the DRAFT receipt for one recorded payment — idempotent on the
 * payment key (a retry or a second caller finds the existing row). Every
 * method, cash included, stays a draft until finance confirms the money.
 */
export async function createReceiptForPayment(
  sb: any,
  p: ReceiptPaymentInput,
): Promise<{ ok: true; id: number; orNumber: string; status: string } | { ok: false; reason: string }> {
  const { data: existing, error: exErr } = await sb.from('acc_official_receipts')
    .select('id, or_number, status')
    .eq('payment_source', p.source).eq('payment_id', p.paymentId).maybeSingle();
  if (exErr) return { ok: false, reason: exErr.message };
  if (existing) {
    const cur = existing as { id: number; or_number: string; status: string };
    return { ok: true, id: cur.id, orNumber: cur.or_number, status: cur.status };
  }

  const prefix = docPrefixForCode(p.companyCode);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const draftNo = await mintMonthlyDocNo(sb, 'acc_official_receipts', 'or_number', `${prefix}DraftOR-${docMonthTag(p.paidAt)}`);
    const { data, error } = await sb.from('acc_official_receipts').insert({
      company_id: p.companyId,
      or_number: draftNo,
      status: 'DRAFT',
      payment_source: p.source,
      payment_id: p.paymentId,
      doc_no: p.docNo,
      customer_name: p.customerName ?? null,
      method: p.method,
      amount_sen: p.amountSen,
      paid_at: p.paidAt,
      created_by: p.createdBy ?? null,
    }).select('id').single();
    if (!error) {
      const id = Number((data as { id: number }).id);
      return { ok: true, id, orNumber: draftNo, status: 'DRAFT' };
    }
    const dupPayment = /payment_source|payment_id/.test(String(error.message ?? '')) && /duplicate key/i.test(String(error.message ?? ''));
    if (dupPayment) {
      const { data: again, error: againErr } = await sb.from('acc_official_receipts')
        .select('id, or_number, status').eq('payment_source', p.source).eq('payment_id', p.paymentId).maybeSingle();
      if (againErr) return { ok: false, reason: `receipt exists but could not be read back: ${againErr.message}` };
      if (again) {
        const cur = again as { id: number; or_number: string; status: string };
        return { ok: true, id: cur.id, orNumber: cur.or_number, status: cur.status };
      }
    }
    const numberClash = String(error.code ?? '') === '23505' || /duplicate key/i.test(String(error.message ?? ''));
    if (!numberClash) return { ok: false, reason: error.message };
  }
  return { ok: false, reason: 'could not mint a draft receipt number after 8 attempts' };
}

/**
 * Turn one DRAFT receipt FORMAL: mint the channel number from the money
 * account's letter (C = cash) and stamp who confirmed the money. Idempotent —
 * an already-formal receipt echoes itself.
 */
export async function formaliseReceipt(
  sb: any,
  input: { companyId: number; companyCode: string; receiptId: number; accountCode: string; actor: string | null },
): Promise<{ ok: true; orNumber: string; already?: boolean } | { ok: false; status: string; reason: string }> {
  const { data: rRaw, error: rErr } = await sb.from('acc_official_receipts')
    .select('id, or_number, status, company_id, paid_at')
    .eq('id', input.receiptId).eq('company_id', input.companyId).maybeSingle();
  if (rErr) return { ok: false, status: 'load_failed', reason: rErr.message };
  if (!rRaw) return { ok: false, status: 'not_found', reason: `receipt ${input.receiptId} not found` };
  const r = rRaw as { id: number; or_number: string; status: string; paid_at: string | null };
  if (r.status === 'FORMAL') return { ok: true, orNumber: r.or_number, already: true };

  const ch = await channelLetterFor(sb, input.companyId, input.accountCode);
  if (!ch.ok) return { ok: false, status: 'load_failed', reason: ch.reason };
  if (!ch.letter) {
    return {
      ok: false,
      status: 'bank_letter_missing',
      reason: `${input.accountCode} has no series letter yet — set one on the Voucher numbering card (Reconciliation setup), then confirm again.`,
    };
  }

  const digits = await digitsOf(sb, input.companyId);
  const prefix = docPrefixForCode(input.companyCode);
  const at = new Date().toISOString();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const formalNo = await mintMonthlyDocNo(sb, 'acc_official_receipts', 'or_number', `${prefix}${ch.letter}OR-${docMonthTag(r.paid_at)}`, digits);
    /* Only a DRAFT turns formal: of two confirms racing, the second touches
       nothing and echoes the first — one number, one bank. */
    const { data: won, error } = await sb.from('acc_official_receipts').update({
      or_number: formalNo,
      status: 'FORMAL',
      channel_account_code: input.accountCode,
      issued_at: at,
      issued_by: input.actor,
    }).eq('id', r.id).eq('status', 'DRAFT').select('id');
    if (!error && ((won ?? []) as unknown[]).length > 0) return { ok: true, orNumber: formalNo };
    if (!error) {
      const { data: again, error: againErr } = await sb.from('acc_official_receipts')
        .select('or_number, status').eq('id', r.id).maybeSingle();
      if (againErr) return { ok: false, status: 'load_failed', reason: againErr.message };
      const cur = again as { or_number: string; status: string } | null;
      if (cur?.status === 'FORMAL') return { ok: true, orNumber: cur.or_number, already: true };
      return { ok: false, status: 'save_failed', reason: `receipt ${input.receiptId} changed while it was being confirmed — try again` };
    }
    const clash = String(error.code ?? '') === '23505' || /duplicate key/i.test(String(error.message ?? ''));
    if (!clash) return { ok: false, status: 'save_failed', reason: error.message };
  }
  return { ok: false, status: 'save_failed', reason: 'could not mint a formal receipt number after 8 attempts' };
}

/** Methods whose rows are not money arriving from a customer, so finance has
    nothing to confirm and they keep their own rules: money moved between
    orders and its refund / move-out mirrors ('converted'), migration-era rows
    ('imported'), a customer credit balance applied to an invoice ('credit'). */
const NOT_RECEIVED_MONEY = new Set(['converted', 'imported', 'credit']);

/** Does this payment row count as received only once finance confirms it? */
export const awaitsConfirmation = (method: string | null | undefined, amountSen: unknown): boolean =>
  !NOT_RECEIVED_MONEY.has(String(method ?? '')) && Number(amountSen ?? 0) > 0;

/** The payments among these that already carry a LIVE posted entry (SOPAY /
    SIPAY, not reversed). A payment posted under the rule before confirmation
    (posted at recording) counts as confirmed: its money is in the books. */
async function livePostedIds(
  sb: any,
  companyId: number | null,
  source: 'SOPAY' | 'SIPAY',
  paymentIds: string[],
): Promise<{ ok: true; ids: Set<string> } | { ok: false; reason: string }> {
  const ids = new Set<string>();
  for (let i = 0; i < paymentIds.length; i += 150) {
    let q = sb.from('journal_entries').select('source_doc_no, reversed')
      .eq('source_type', source).eq('posted', true).in('source_doc_no', paymentIds.slice(i, i + 150));
    if (companyId != null) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) return { ok: false, reason: error.message };
    /* `reversed` filtered here, not in the query — the fake leaves it absent on a fresh row (payment-repost.ts). */
    for (const r of (data ?? []) as Array<{ source_doc_no: string; reversed: boolean | null }>) if (r.reversed !== true) ids.add(String(r.source_doc_no));
  }
  return { ok: true, ids };
}

/** Has finance confirmed this payment? Its receipt FORMAL = confirmed, with
    the money account it was confirmed onto. No FORMAL receipt but a live
    posted entry = confirmed under the old rule (`legacy`: posted at
    recording, before confirmation existed; no bank named). Otherwise not. */
export async function receiptConfirmation(
  sb: any,
  companyId: number | null,
  source: 'SOPAY' | 'SIPAY',
  paymentId: string,
): Promise<{ ok: true; confirmed: boolean; legacy: boolean; channelAccountCode: string | null } | { ok: false; reason: string }> {
  let q = sb.from('acc_official_receipts')
    .select('status, channel_account_code')
    .eq('payment_source', source).eq('payment_id', paymentId);
  if (companyId != null) q = q.eq('company_id', companyId);
  const { data, error } = await q.maybeSingle();
  if (error) return { ok: false, reason: error.message };
  const r = data as { status?: string; channel_account_code?: string | null } | null;
  if (r?.status === 'FORMAL') return { ok: true, confirmed: true, legacy: false, channelAccountCode: r.channel_account_code ?? null };
  const live = await livePostedIds(sb, companyId, source, [paymentId]);
  if (!live.ok) return live;
  const legacy = live.ids.has(paymentId);
  return { ok: true, confirmed: legacy, legacy, channelAccountCode: null };
}

/** Which of these payments finance has confirmed (a FORMAL receipt, or a live
    posted entry from before confirmation existed) — one read per 150 ids, for
    the readers that sum received money (the project limit, the Self-check,
    a cancelled order's credit). A null company reads across companies. */
export async function confirmedPaymentIds(
  sb: any,
  companyId: number | null,
  source: 'SOPAY' | 'SIPAY',
  paymentIds: string[],
): Promise<{ ok: true; ids: Set<string> } | { ok: false; reason: string }> {
  const ids = new Set<string>();
  for (let i = 0; i < paymentIds.length; i += 150) {
    let q = sb.from('acc_official_receipts')
      .select('payment_id')
      .eq('payment_source', source).eq('status', 'FORMAL')
      .in('payment_id', paymentIds.slice(i, i + 150));
    if (companyId != null) q = q.eq('company_id', companyId);
    const { data, error } = await q;
    if (error) return { ok: false, reason: error.message };
    for (const r of (data ?? []) as Array<{ payment_id: string }>) ids.add(String(r.payment_id));
  }
  const rest = paymentIds.filter((id) => !ids.has(id));
  if (rest.length === 0) return { ok: true, ids };
  const live = await livePostedIds(sb, companyId, source, rest);
  if (!live.ok) return live;
  for (const id of live.ids) ids.add(id);
  return { ok: true, ids };
}

/** A deleted payment's DRAFT receipt goes with it — a draft is not an official
    number, and confirming money that is gone must be impossible. A FORMAL one
    stays on file (the receipts check names it as a receipt whose payment is
    gone); its number is never re-used and it cannot be confirmed again. */
export async function dropDraftReceipt(sb: any, source: 'SOPAY' | 'SIPAY', paymentId: string): Promise<void> {
  const { error } = await sb.from('acc_official_receipts').delete()
    .eq('payment_source', source).eq('payment_id', paymentId).eq('status', 'DRAFT');
  // eslint-disable-next-line no-console
  if (error) console.error('[receipts] draft receipt of a deleted payment not removed:', source, paymentId, error.message);
}

/** An edited payment's DRAFT receipt follows it — amount, method, day — so
    what finance confirms is what the payment says. A FORMAL one is left as
    issued (the receipts check names a difference). */
export async function syncDraftReceipt(
  sb: any,
  source: 'SOPAY' | 'SIPAY',
  paymentId: string,
  p: { amountSen: number; method: string; paidAt: string | null },
): Promise<void> {
  const { error } = await sb.from('acc_official_receipts')
    .update({ amount_sen: p.amountSen, method: p.method, paid_at: (p.paidAt ?? '').slice(0, 10) || null })
    .eq('payment_source', source).eq('payment_id', paymentId).eq('status', 'DRAFT');
  // eslint-disable-next-line no-console
  if (error) console.error('[receipts] draft receipt of an edited payment not updated:', source, paymentId, error.message);
}

export type ConfirmBank = { code: string; name: string };

/** The banks finance may confirm customer money onto: the company's active
    money accounts, less the CASH account and every petty cash float's account
    — the company banks all customer cash, never keeps it in a drawer or float. */
export async function confirmBanks(
  sb: any,
  companyId: number,
): Promise<{ ok: true; banks: ConfirmBank[]; defaultCode: string } | { ok: false; reason: string }> {
  const [accts, floats] = await Promise.all([
    sb.from('accounts').select('account_code, account_name, acc_money, is_active').eq('company_id', companyId).eq('acc_money', true).order('account_code'),
    sb.from('petty_cash_floats').select('account_code').eq('company_id', companyId),
  ]);
  if (accts.error) return { ok: false, reason: accts.error.message };
  if (floats.error) return { ok: false, reason: floats.error.message };
  const roles = await resolveRoles(sb, companyId);
  const floatCodes = new Set(((floats.data ?? []) as Array<{ account_code: string | null }>).map((f) => String(f.account_code ?? '')));
  const banks = ((accts.data ?? []) as Array<{ account_code: string; account_name: string | null; is_active: boolean | null }>)
    .filter((a) => a.is_active === true && a.account_code !== roles.CASH && !floatCodes.has(a.account_code))
    .map((a) => ({ code: a.account_code, name: a.account_name ?? a.account_code }));
  return { ok: true, banks, defaultCode: roles.BANK_DEFAULT };
}

/** Why customer money may not be confirmed onto this account — null when it may. */
export async function confirmBankRefusal(
  sb: any,
  companyId: number,
  accountCode: string,
): Promise<{ ok: true; refusal: string | null } | { ok: false; reason: string }> {
  const roles = await resolveRoles(sb, companyId);
  if (accountCode === roles.CASH) {
    return { ok: true, refusal: `${accountCode} is the CASH account. Customer cash is banked: confirm it onto the bank it was deposited in.` };
  }
  const { data: floats, error: fErr } = await sb.from('petty_cash_floats').select('id').eq('company_id', companyId).eq('account_code', accountCode).limit(1);
  if (fErr) return { ok: false, reason: fErr.message };
  if (((floats ?? []) as unknown[]).length > 0) {
    return { ok: true, refusal: `${accountCode} is a petty cash float. Confirm customer money onto the bank it landed in.` };
  }
  const list = await confirmBanks(sb, companyId);
  if (!list.ok) return list;
  if (!list.banks.some((b) => b.code === accountCode)) {
    return { ok: true, refusal: `${accountCode} is not an active bank account. Choose the bank the money landed in.` };
  }
  return { ok: true, refusal: null };
}

/**
 * Find-or-create the receipt for a payment that exists in the ledgered
 * tables — the healing path for rows recorded before this module, or through
 * a writer that has no hook. Reads the payment row itself, so a caller needs
 * only the key.
 */
export async function ensureReceiptForPayment(
  sb: any,
  source: 'SOPAY' | 'SIPAY',
  paymentId: string,
  /* The caller's active company: a payment id from another company's books is
     refused before anything is written. null only for a caller that has
     already scoped the payment itself. */
  activeCompanyId: number | null,
): Promise<{ ok: true; id: number; orNumber: string; status: string } | { ok: false; reason: string }> {
  let existingQuery = sb.from('acc_official_receipts')
    .select('id, or_number, status')
    .eq('payment_source', source).eq('payment_id', paymentId);
  if (activeCompanyId !== null) existingQuery = existingQuery.eq('company_id', activeCompanyId);
  const { data: existing, error: exErr } = await existingQuery.maybeSingle();
  if (exErr) return { ok: false, reason: exErr.message };
  if (existing) {
    const cur = existing as { id: number; or_number: string; status: string };
    return { ok: true, id: cur.id, orNumber: cur.or_number, status: cur.status };
  }

  const table = source === 'SOPAY' ? 'mfg_sales_order_payments' : 'sales_invoice_payments';
  const cols = source === 'SOPAY'
    ? 'id, so_doc_no, paid_at, method, amount_sen, company_id, created_by'
    : 'id, sales_invoice_id, paid_at, method, amount_sen, company_id, created_by';
  let paymentQuery = sb.from(table).select(cols).eq('id', paymentId);
  if (activeCompanyId !== null) paymentQuery = paymentQuery.eq('company_id', activeCompanyId);
  const { data: payRaw, error: payErr } = await paymentQuery.maybeSingle();
  if (payErr) return { ok: false, reason: payErr.message };
  if (!payRaw) return { ok: false, reason: `payment ${source}:${paymentId} not found` };
  const pay = payRaw as Record<string, unknown>;
  /* Money moved from a cancelled order (docs/bugs/0927) was receipted when it
     was received; the moved row gets no receipt of its own. */
  if (String(pay.method ?? '') === 'converted') return { ok: false, reason: `payment ${source}:${paymentId} is money moved from a cancelled order — its receipt is on that order` };
  const companyId = Number(pay.company_id ?? 0);
  if (!companyId) return { ok: false, reason: `payment ${source}:${paymentId} carries no company` };

  const { data: coRaw, error: coErr } = await sb.schema('public').from('companies')
    .select('code').eq('id', companyId).maybeSingle();
  if (coErr) return { ok: false, reason: coErr.message };
  const companyCode = String((coRaw as { code?: string } | null)?.code ?? '');
  if (!companyCode) return { ok: false, reason: `company ${companyId} has no code` };

  return createReceiptForPayment(sb, {
    source,
    paymentId,
    companyId,
    companyCode,
    docNo: source === 'SOPAY' ? String(pay.so_doc_no ?? '') || null : String(pay.sales_invoice_id ?? '') || null,
    method: String(pay.method ?? ''),
    amountSen: Number(pay.amount_sen ?? 0),
    paidAt: String(pay.paid_at ?? '').slice(0, 10) || null,
    createdBy: (pay.created_by as string | null) ?? null,
  });
}

/**
 * Card money confirmed by merchant reconciliation → the payments' receipts
 * turn FORMAL on the acquirer's payout bank. BEST-EFFORT by design: the
 * settlement confirm must never fail over a receipt (the fee entry is the
 * money truth); a missing letter or absent receipt is reported, not thrown.
 */
export async function formaliseReceiptsForSettlement(
  sb: any,
  companyId: number,
  companyCode: string,
  payments: Array<{ source: string; id: string }>,
  bankAccountCode: string | null,
  actor: string | null,
): Promise<Array<{ paymentId: string; outcome: string }>> {
  const out: Array<{ paymentId: string; outcome: string }> = [];
  if (!bankAccountCode) return payments.map((p) => ({ paymentId: p.id, outcome: 'no_bank_configured' }));
  for (const p of payments) {
    const { data, error } = await sb.from('acc_official_receipts')
      .select('id, status')
      .eq('payment_source', p.source).eq('payment_id', p.id).maybeSingle();
    /* A blip is NOT "no receipt" — reported as its own outcome so the sweep's
       answer never lies about what it saw. */
    if (error) { out.push({ paymentId: p.id, outcome: 'read_failed' }); continue; }
    const r = data as { id: number; status: string } | null;
    if (!r) { out.push({ paymentId: p.id, outcome: 'no_receipt' }); continue; }
    if (r.status === 'FORMAL') { out.push({ paymentId: p.id, outcome: 'already_formal' }); continue; }
    const f = await formaliseReceipt(sb, { companyId, companyCode, receiptId: r.id, accountCode: bankAccountCode, actor });
    out.push({ paymentId: p.id, outcome: f.ok ? 'formalised' : f.status });
  }
  return out;
}
