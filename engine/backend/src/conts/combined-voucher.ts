// Conts only (not part of Houzs's code): one payment voucher for several payment requests and staff claims (chew, 16 Nov
// 2026: tick several and "combine 几个 payment request 去一张 voucher"; a person's claims handed in separately are paid
// back at once; "普通 voucher 应该可以还给很多人").
//   POST /accounting/vouchers/from-claims  { requestIds?, receiptIds?, bankAccountCode, accounts?: { [lineId]: code } }
// An ordinary voucher (Make voucher, the first of the two ways; the other is an AP invoice paid on the Payment voucher
// page): each line debits the account finance chose for it, the bank is credited. Payees on the list or typed in, one or
// many ("Various"). Each line names the request or claim it pays (migration 0330), so each settles by its own lines when
// the voucher posts (claims-voucher-hooks.ts). A request paid through an AP invoice, already being paid, or closed, and a
// claim not checked or already paid back, are refused by name: the same money is never put on two vouchers.
import { hasHouzsPerm } from '../scm/lib/houzs-perms';
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { linesStillOwed } from './payment-requests';
import { claimsDeps, FULL_KEY, isFloatAccountCode, NOT_A_BANK, payBackBank, savedBanksOf } from './petty-cash-routes';
import { linesOf, staffNames, type ReceiptLineRow } from './petty-cash-store';
import { liveBillOf } from './request-ap-invoice';
import { requestPayments } from './request-vouchers';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
type Db = any;
const now = () => new Date().toISOString();
const OPEN = new Set(['SUBMITTED', 'PART_PAID']);
const bodyOf = async (c: Ctx): Promise<Record<string, unknown> | null> => { try { return await c.req.json(); } catch { return null; } };
const ids = (raw: unknown): string[] => (Array.isArray(raw) ? [...new Set(raw.map(String).filter(Boolean))] : []);

type ReqRow = { id: string; request_no: string; payee_name: string; status: string; note: string | null; type: string };
type ReqLine = { id: string; request_id: string; department: string; unit_id: string | null; project_id: number | null; account_code: string | null; amount_sen: number; description: string | null; sort: number; sub_department_id?: string | null };
type Out = { debit: string; amount: number; description: string; department: string; project_id: number | null; unit_id: string | null; sub_department_id: string | null; payment_request_id: string | null; staff_receipt_id: string | null };

async function dropDraft(sb: Db, pvId: string): Promise<void> {
  await sb.from('payment_vouchers').update({ status: 'CANCELLED', updated_at: now() }).eq('id', pvId).eq('status', 'DRAFT');
}

/** The voucher for `requestIds` and `receiptIds`, or the refusal. The request route (one request) and the combined route
 *  both come here. */
export async function makeCombinedVoucher(c: Ctx, input: { requestIds: string[]; receiptIds: string[]; bankAccountCode: string; accounts: Record<string, string>; fallbackAccount?: string }): Promise<Response> {
  if (!hasHouzsPerm(c, FULL_KEY)) return c.json({ error: 'forbidden', message: "You don't have permission to do this." }, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const bank = input.bankAccountCode.trim();
  if (!bank) return c.json({ error: 'validation', message: 'Choose the bank this is paid from.' }, 422);
  if (input.requestIds.length + input.receiptIds.length === 0) return c.json({ error: 'validation', message: 'Tick what to pay.' }, 422);
  if (input.requestIds.length + input.receiptIds.length > 100) return c.json({ error: 'validation', message: 'Up to 100 at a time.' }, 422);
  if (await isFloatAccountCode(sb, co.companyId, bank)) return c.json(NOT_A_BANK, 422);
  const problems: string[] = [];
  const out: Out[] = [];
  const payees = new Set<string>();
  const notes: string[] = [];

  /* Payment requests: what each still owes, line by line (a part-paid one pays only the rest). */
  const { data: qd } = input.requestIds.length
    ? await sb.from('payment_requests').select('id, request_no, payee_name, status, note, type').eq('company_id', co.companyId).in('id', input.requestIds)
    : { data: [] };
  const reqs = ((qd ?? []) as ReqRow[]).sort((a, b) => a.request_no.localeCompare(b.request_no));
  if (reqs.length !== input.requestIds.length) problems.push('A request was not found. Open the list again.');
  const pays = await requestPayments(sb, reqs.map(r => r.id));
  const { data: ld } = reqs.length ? await sb.from('payment_request_lines').select('*').in('request_id', reqs.map(r => r.id)) : { data: [] };
  for (const r of reqs) {
    if (!OPEN.has(r.status)) { problems.push(`${r.request_no} is not waiting for payment.`); continue; }
    const bill = await liveBillOf(sb, r.id);
    if (bill) { problems.push(`${r.request_no} is paid through AP invoice ${bill.invoiceNumber}, on the Payment voucher page.`); continue; }
    const vs = pays.vouchers.get(r.id) ?? [];
    const drafting = vs.find(v => v.status === 'DRAFT');
    if (drafting) { problems.push(`${r.request_no} is already on voucher ${drafting.pv_number}. Finish or cancel it first.`); continue; }
    const paid = (pays.lines.get(r.id) ?? []).filter(l => l.pv.status === 'POSTED').reduce((n, l) => n + Number(l.amount_sen), 0);
    const lines = ((ld ?? []) as ReqLine[]).filter(l => l.request_id === r.id).sort((a, b) => a.sort - b.sort);
    const owed = linesStillOwed(lines.map(l => ({ ...l, amount_sen: Number(l.amount_sen) })), paid);
    if (owed.length === 0) { problems.push(`${r.request_no} is already paid in full.`); continue; }
    payees.add(r.payee_name);
    notes.push(`${r.request_no} ${r.payee_name}${r.type === 'DEPOSIT' ? ' (deposit)' : ''}${r.note ? ` — ${r.note}` : ''}`);
    for (const l of owed) {
      const debit = (input.accounts[l.id] || l.account_code || input.fallbackAccount || '').trim();
      if (!debit) { problems.push(`${r.request_no}: choose the account for "${l.description ?? 'a line'}".`); continue; }
      out.push({ debit, amount: l.amount_sen, description: [r.payee_name, l.description ?? r.request_no].join(' · ').slice(0, 300), department: l.department,
        project_id: l.project_id, unit_id: l.unit_id, sub_department_id: l.sub_department_id ?? null, payment_request_id: r.id, staff_receipt_id: null });
    }
  }

  /* Staff claims paid back by finance: checked, not from a float, not paid back yet; to the bank on the claim, else saved. */
  const { data: rd } = input.receiptIds.length
    ? await sb.from('staff_receipts').select('id, receipt_no, submitter_user_id, float_id, status, payback_pv_id, payee_bank_name, payee_account_no, payee_account_name').eq('company_id', co.companyId).in('id', input.receiptIds)
    : { data: [] };
  const receipts = ((rd ?? []) as Array<{ id: string; receipt_no: string; submitter_user_id: string; float_id: string | null; status: string; payback_pv_id: string | null; payee_bank_name: string | null; payee_account_no: string | null; payee_account_name: string | null }>)
    .sort((a, b) => a.receipt_no.localeCompare(b.receipt_no));
  if (receipts.length !== input.receiptIds.length) problems.push('A claim was not found. Open the list again.');
  const names = receipts.length ? await staffNames(sb) : new Map<string, string>();
  const saved = receipts.length ? await savedBanksOf(sb, co.companyId, [...new Set(receipts.map(r => r.submitter_user_id))]) : new Map();
  const rlines = receipts.length ? await linesOf(sb, receipts.map(r => r.id)) : new Map<string, ReceiptLineRow[]>();
  for (const r of receipts) {
    if (r.float_id) { problems.push(`${r.receipt_no} is paid from petty cash.`); continue; }
    if (r.status !== 'CHECKED' || r.payback_pv_id) { problems.push(`${r.receipt_no} is not checked, or is already being paid back.`); continue; }
    const who = names.get(r.submitter_user_id) || 'Staff';
    const details = payBackBank(r, saved.get(r.submitter_user_id) ?? null);
    if (!details) { problems.push(`${r.receipt_no}: bank details missing for ${who}.`); continue; }
    payees.add(who);
    notes.push(`${r.receipt_no} ${who} — ${details.bankName} ${details.accountNo}${details.accountName ? ` (${details.accountName})` : ''}`);
    for (const l of rlines.get(r.id) ?? []) {
      const debit = (input.accounts[l.id] || l.account_code || input.fallbackAccount || '').trim();
      if (!debit) { problems.push(`${r.receipt_no}: choose the account for "${l.description ?? 'a line'}".`); continue; }
      out.push({ debit, amount: Number(l.amount_sen), description: [who, l.description ?? `Receipt ${r.receipt_no}`].join(' · ').slice(0, 300), department: l.department,
        project_id: l.project_id, unit_id: l.unit_id, sub_department_id: l.sub_department_id ?? null, payment_request_id: null, staff_receipt_id: r.id });
    }
  }
  if (problems.length) return c.json({ error: 'cannot_pay', message: problems.join(' '), problems }, 409);
  if (out.length === 0) return c.json({ error: 'nothing_owed', message: 'Nothing is left to pay on what was ticked.' }, 409);

  const single = reqs.length + receipts.length === 1;
  const made = await claimsDeps.createVoucher(c, {
    payeeName: payees.size === 1 ? [...payees][0]! : `Various (${payees.size})`, creditAccountCode: bank, purpose: 'OTHER',
    lines: out.map(l => ({ debitAccountCode: l.debit, amountSen: l.amount, description: l.description, department: l.department })),
    notes: notes.join('\n').slice(0, 4000),
  });
  if (!made.ok) return c.json(made.body, made.status as 400);
  /* One request or claim alone is also named on the voucher, as before: a second draft for it is then refused by the
     database (0178's unique indexes). */
  if (single) {
    const link = await sb.from('payment_vouchers').update(reqs.length ? { payment_request_id: reqs[0]!.id } : { staff_receipt_id: receipts[0]!.id }).eq('id', made.id);
    if (link.error) {
      await dropDraft(sb, made.id);
      return c.json({ error: 'voucher_open', message: 'A voucher for this was just made.' }, 409);
    }
  }
  for (const [i, l] of out.entries()) {
    const up = await sb.from('payment_voucher_lines').update({
      project_id: l.project_id, unit_id: l.unit_id, sub_department_id: l.sub_department_id, payment_request_id: l.payment_request_id, staff_receipt_id: l.staff_receipt_id,
    }).eq('pv_id', made.id).eq('line_no', i + 1);
    if (up.error) { await dropDraft(sb, made.id); return c.json({ error: 'update_failed', reason: up.error.message }, 500); }
  }
  /* Each claim takes this voucher only if none has it: a second click loses here, and its draft goes. */
  for (const r of receipts) {
    const { data: won } = await sb.from('staff_receipts').update({ payback_pv_id: made.id, updated_at: now() }).eq('id', r.id).is('payback_pv_id', null).select('id').maybeSingle();
    if (!won) {
      await sb.from('staff_receipts').update({ payback_pv_id: null, updated_at: now() }).eq('payback_pv_id', made.id);
      await dropDraft(sb, made.id);
      return c.json({ error: 'already_vouchered', message: `${r.receipt_no} was just put on another voucher.` }, 409);
    }
  }
  /* Withdrawn, rejected or closed while the voucher was being made: the request wins and the draft goes. */
  if (reqs.length) {
    const { data: still } = await sb.from('payment_requests').select('id, status').in('id', reqs.map(r => r.id));
    if (((still ?? []) as Array<{ status: string }>).some(s => !OPEN.has(s.status))) {
      await sb.from('staff_receipts').update({ payback_pv_id: null, updated_at: now() }).eq('payback_pv_id', made.id);
      await dropDraft(sb, made.id);
      return c.json({ error: 'not_open', message: 'A request was closed while the voucher was being made.' }, 409);
    }
  }
  return c.json({ pvId: made.id, pvNumber: made.pvNumber }, 201);
}

/** POST /accounting/vouchers/from-claims — one voucher for the ticked requests and claims. */
export const combinedVoucherHandler = async (c: Ctx): Promise<Response> => {
  const b = (await bodyOf(c)) ?? {};
  const accounts = b.accounts && typeof b.accounts === 'object' ? Object.fromEntries(Object.entries(b.accounts as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])) : {};
  return makeCombinedVoucher(c, { requestIds: ids(b.requestIds), receiptIds: ids(b.receiptIds), bankAccountCode: String(b.bankAccountCode ?? ''), accounts });
};
