// ----------------------------------------------------------------------------
// accounting-receipts — the Official Receipts surface (GL redesign item 9).
// The receipts themselves are born inside the payment writers and formalised
// by the money-confirmation hooks (acc/receipts.ts); this file is the screen's
// three doors: list them, fetch-or-heal one for a payment (the print button's
// path), and FINANCE'S CONFIRM (Conts, chew 29 Oct 2026; SOP 4.2/4.5): finance
// checked the bank statement, names the bank the money landed in, and the
// receipt goes formal — which is the payment received: it posts, its deposit
// invoice issues and the project limit counts it (acc/receipt-confirm.ts).
// ----------------------------------------------------------------------------

import { hasHouzsPerm } from '../lib/houzs-perms';
import { requireActiveCompanyId } from '../lib/companyScope';
import { confirmBankRefusal, confirmBanks, ensureReceiptForPayment, formaliseReceipt } from '../../acc/receipts';
import { bankChangeRefusal, nextInstalmentOffer, postConfirmedPayment, soOfPayment } from '../../acc/receipt-confirm';
import { resolveRoles } from '../../acc/rules';
import { companyCodeById } from '../lib/doc-no';
import { paginateAll } from '../lib/paginate-all';
import { monthRange } from './accounting-receipts-check';
import { fmtSen } from '../shared/format';

/* Receipts are a sales-side paper: the writer key covers recording payments,
   so it covers seeing and printing the receipt for one. */
const requirePerm = (c: any): boolean =>
  hasHouzsPerm(c, 'scm.payment_voucher.post') || hasHouzsPerm(c, 'scm.sales_order.write');
/* Confirming the money is finance's alone: the salesperson records, finance
   checks the bank (SOP 4.2). */
const requireConfirmPerm = (c: any): boolean => hasHouzsPerm(c, 'scm.payment_voucher.post');

/* ── GET /accounting/receipts?status=&limit=&month=YYYY-MM ─────────────────
   Without a month: the newest `limit` receipts. With one: every receipt whose
   payment day falls in it, oldest first, so the month reads whole beside its
   check (accounting-receipts-check.ts). */
export const receiptsList = async (c: any): Promise<Response> => {
  if (!requirePerm(c)) return c.json({ error: "You don't have permission to see receipts." }, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const status = String(c.req.query('status') ?? '').trim().toUpperCase();
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 100) || 100));
  const month = String(c.req.query('month') ?? '').trim();
  const range = month ? monthRange(month) : null;
  if (month && !range) return c.json({ error: 'bad_month', message: 'Which month? YYYY-MM.' }, 400);

  const COLS = 'id, or_number, status, payment_source, payment_id, doc_no, customer_name, method, amount_sen, paid_at, channel_account_code, issued_at, issued_by, created_at';
  const scoped = (q: any) => (status === 'DRAFT' || status === 'FORMAL' ? q.eq('status', status) : q);
  if (range) {
    const all = await paginateAll<Record<string, unknown>>((from, to) => scoped(sb.from('acc_official_receipts').select(COLS)
      .eq('company_id', co.companyId).gte('paid_at', range.from).lte('paid_at', range.to))
      .order('paid_at', { ascending: true }).order('or_number', { ascending: true }).range(from, to));
    if (all.error) return c.json({ error: 'load_failed', reason: all.error.message }, 500);
    return c.json({ receipts: all.data ?? [] });
  }
  const { data, error } = await scoped(sb.from('acc_official_receipts').select(COLS).eq('company_id', co.companyId))
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ receipts: data ?? [] });
};

/* ── POST /accounting/receipts/ensure — {source, paymentId} ──────────────── */
export const receiptEnsure = async (c: any): Promise<Response> => {
  if (!requirePerm(c)) return c.json({ error: "You don't have permission to issue receipts." }, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const source = String(body.source ?? '').trim().toUpperCase();
  const paymentId = String(body.paymentId ?? '').trim();
  if ((source !== 'SOPAY' && source !== 'SIPAY') || !paymentId) {
    return c.json({ error: 'bad_key', message: 'source (SOPAY/SIPAY) and paymentId are required.' }, 400);
  }
  const sb = c.get('supabase');
  // company-scope: ensureReceiptForPayment reads the receipt and the payment with co.companyId
  const r = await ensureReceiptForPayment(sb, source as 'SOPAY' | 'SIPAY', paymentId, co.companyId);
  if (!r.ok) return c.json({ error: 'ensure_failed', reason: r.reason }, r.reason.endsWith('not found') ? 404 : 500);
  /* The caller is about to PRINT: hand back the whole row (customer, method,
     amounts, issued-by), not just the number — one round trip, server truth. */
  const { data: row, error: rowErr } = await sb.from('acc_official_receipts').select('*').eq('id', r.id).maybeSingle();
  if (rowErr || !row) return c.json({ error: 'ensure_failed', reason: rowErr?.message ?? 'receipt vanished after ensure' }, 500);
  return c.json({ receipt: row });
};

/* ── GET /accounting/receipts/banks ─────────────────────────────────────────
   The banks the confirm may name (active money accounts, never CASH or a
   petty cash float) and the default one — the confirm dialog's choice. */
export const receiptConfirmBanks = async (c: any): Promise<Response> => {
  if (!requireConfirmPerm(c)) return c.json({ error: "You don't have permission to confirm receipts." }, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const r = await confirmBanks(c.get('supabase'), co.companyId);
  if (!r.ok) return c.json({ error: 'load_failed', reason: r.reason }, 500);
  return c.json({ defaultCode: r.defaultCode, banks: r.banks });
};

/* ── POST /accounting/receipts/:id/formalise — {accountCode?} ─────────────
   Finance checked the bank: the money is real. accountCode names the bank it
   landed in; left out, the company's default bank answers (BANK_DEFAULT). The
   payment then posts at once, best-effort — the answer says what posted, or
   why not; the receipt is formal either way. */
export const receiptFormalise = async (c: any): Promise<Response> => {
  if (!requireConfirmPerm(c)) return c.json({ error: "Only finance can confirm customer payments." }, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'bad_id' }, 400);
  let body: any = {};
  try { body = await c.req.json(); } catch { /* empty body = default bank */ }
  const sb = c.get('supabase');

  /* The receipt and the payment behind it, before anything is written: money
     that is gone cannot be confirmed, and finance confirms the amount it saw. */
  const { data: recRaw, error: recErr } = await sb.from('acc_official_receipts')
    .select('id, status, payment_source, payment_id, amount_sen').eq('id', id).eq('company_id', co.companyId).maybeSingle();
  if (recErr) return c.json({ error: 'load_failed', reason: recErr.message }, 500);
  if (!recRaw) return c.json({ error: 'not_found', message: `Receipt ${id} not found.` }, 404);
  const rec = recRaw as { status: string; payment_source: string; payment_id: string; amount_sen: number };
  const source = rec.payment_source === 'SIPAY' ? 'SIPAY' : 'SOPAY';
  const { data: payRaw, error: payErr } = await sb.from(source === 'SIPAY' ? 'sales_invoice_payments' : 'mfg_sales_order_payments')
    .select('id, amount_sen, method').eq('id', rec.payment_id).eq('company_id', co.companyId).maybeSingle();
  if (payErr) return c.json({ error: 'load_failed', reason: payErr.message }, 500);
  if (!payRaw) return c.json({ error: 'payment_gone', message: 'The payment behind this receipt was deleted, so there is nothing to confirm.' }, 409);
  const paySen = Number((payRaw as { amount_sen: number }).amount_sen);
  if (rec.status !== 'FORMAL' && Number(rec.amount_sen) !== paySen) {
    return c.json({
      error: 'payment_edited',
      message: `The payment was edited since this receipt was made (receipt ${fmtSen(Number(rec.amount_sen))}, payment ${fmtSen(paySen)}). Refresh and check it before confirming.`,
    }, 409);
  }

  const roles = await resolveRoles(sb, co.companyId);
  const accountCode = String(body?.accountCode ?? '').trim() || roles.BANK_DEFAULT;
  const allowed = await confirmBankRefusal(sb, co.companyId, accountCode);
  if (!allowed.ok) return c.json({ error: 'load_failed', reason: allowed.reason }, 500);
  if (allowed.refusal) return c.json({ error: 'bank_not_allowed', message: allowed.refusal }, 400);
  /* Posted before confirmation existed onto another account, and already
     reconciled there: it is not moved — confirm it where it sits. */
  if (rec.status !== 'FORMAL') {
    const moving = await bankChangeRefusal(sb, {
      source, paymentId: String(rec.payment_id), companyId: co.companyId, method: String((payRaw as { method?: string }).method ?? ''), bank: accountCode,
    });
    if (!moving.ok) return c.json({ error: moving.status, message: moving.reason }, 500);
    if (moving.refusal) return c.json({ error: 'payment_reconciled', message: moving.refusal }, 409);
  }
  const code = await companyCodeById(sb, co.companyId);
  if (!code) return c.json({ error: 'load_failed', reason: `company ${co.companyId} has no code` }, 500);

  const actor = (c.get('houzsUser') as { name?: string } | undefined)?.name ?? null;
  const r = await formaliseReceipt(sb, { companyId: co.companyId, companyCode: code, receiptId: id, accountCode, actor });
  if (!r.ok) {
    return c.json({ error: r.status, message: r.reason }, r.status === 'bank_letter_missing' ? 409 : r.status === 'not_found' ? 404 : 500);
  }

  /* Confirmed = received: post the payment now (an already-formal receipt
     re-runs the post, which echoes or heals). */
  let posting: { status: string; jeNo?: string; reason?: string };
  try {
    const p = await postConfirmedPayment(sb, source, String(rec.payment_id), co.companyId, { newlyConfirmed: r.already !== true });
    posting = p.ok
      ? { status: p.status, ...('jeNo' in p ? { jeNo: p.jeNo } : {}) }
      : { status: p.status, ...(p.reason ? { reason: p.reason } : {}) };
  } catch (e) {
    posting = { status: 'not_posted', reason: e instanceof Error ? e.message : String(e) };
  }
  /* A renovation payment ahead of its invoice (spec 7.6): more confirmed than invoiced offers the next instalment,
     which the screen bills through the renovation bill route at this amount, or leaves for later. */
  let billNext = null;
  try {
    const soDocNo = await soOfPayment(sb, source, String(rec.payment_id), co.companyId);
    if (soDocNo) billNext = await nextInstalmentOffer(sb, co.companyId, soDocNo);
  } catch { billNext = null; }
  return c.json({ ok: true, orNumber: r.orNumber, already: r.already === true, posting, ...(billNext ? { billNext } : {}) });
};
