// Conts only: a petty cash keeper's "Ask for a top-up" is a payment request to finance (chew, 26 Nov 2026: "当做是一个
// payment request，总之有关系到出钱的的会去payment request吧"). It lists on Payment requests with everything else that
// pays money out: made out to the keeper, for what brings the float back to its amount, one line on the float's own
// cash-in-hand account. Finance pays it as any request; the voucher is the float's top-up (petty-cash-routes
// raiseTopUp): when it posts, the float is paid in and the request is paid. A top-up raised from the Petty cash page
// pays the open request too. One open request per float; a rejected or withdrawn one lets the keeper ask again.

import { docMonthTag, insertWithDocNoRetry, mintMonthlyDocNo } from '../scm/lib/doc-no';
import { todayMyt } from '../scm/lib/my-time';
import { topUpAmount } from './petty-cash';
import { departmentNames, floatBalances, staffNames, type FloatRow } from './petty-cash-store';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as in the other conts/ stores */
type Db = any;

export const TOP_UP_KEY = 'pettycash-topup:';
const OPEN = ['SUBMITTED', 'PART_PAID'];

/** The float a request tops up, or null when it is not a top-up request. Key: pettycash-topup:<floatId>:<when asked>. */
export function topUpFloatOf(sourceKey: string | null | undefined): string | null {
  const k = String(sourceKey ?? '');
  if (!k.startsWith(TOP_UP_KEY)) return null;
  return k.slice(TOP_UP_KEY.length).split(':')[0] || null;
}

/** The open top-up request of each float. */
export async function openTopUpRequests(sb: Db, companyId: number, floatIds: string[]): Promise<Map<string, { id: string; requestNo: string }>> {
  const out = new Map<string, { id: string; requestNo: string }>();
  if (floatIds.length === 0) return out;
  const { data } = await sb.from('payment_requests').select('id, request_no, source_key').eq('company_id', companyId)
    .like('source_key', `${TOP_UP_KEY}%`).in('status', OPEN);
  for (const r of (data ?? []) as Array<{ id: string; request_no: string; source_key: string }>) {
    const f = topUpFloatOf(r.source_key);
    if (f && floatIds.includes(f)) out.set(f, { id: r.id, requestNo: r.request_no });
  }
  return out;
}

export type AskTopUpResult =
  | { ok: true; created: boolean; id: string; requestNo: string; amountSen: number }
  | { ok: false; status: 409 | 500; error: string; message?: string };

/** The keeper asks finance to top the float up: a payment request for what brings it back to its amount. Asking again
 *  while one is open answers with that one. */
export async function askTopUp(sb: Db, companyId: number, keeperUserId: string, f: FloatRow): Promise<AskTopUpResult> {
  const open = (await openTopUpRequests(sb, companyId, [f.id])).get(f.id);
  if (open) {
    const { data } = await sb.from('payment_requests').select('amount_sen').eq('id', open.id).maybeSingle();
    return { ok: true, created: false, id: open.id, requestNo: open.requestNo, amountSen: Number((data as { amount_sen?: number } | null)?.amount_sen ?? 0) };
  }
  if (!f.account_code) return { ok: false, status: 409, error: 'float_account_missing', message: 'Finance has not set this float\'s petty cash account yet.' };
  const bal = (await floatBalances(sb, [f])).get(f.id);
  const amount = topUpAmount(Number(f.float_sen), bal?.balanceSen ?? Number(f.float_sen));
  if (amount <= 0) return { ok: false, status: 409, error: 'nothing_to_top_up', message: 'The float is already at its amount.' };
  const [names, depts] = await Promise.all([staffNames(sb), departmentNames(sb)]);
  const dept = depts.get(String(f.department_id)) ?? 'department';
  const id = crypto.randomUUID();
  const { data: row, error } = await insertWithDocNoRetry<{ id: string; request_no: string }>(
    () => mintMonthlyDocNo(sb, 'payment_requests', 'request_no', `PRQ-${docMonthTag(todayMyt())}`),
    no => sb.from('payment_requests').insert({
      id, company_id: companyId, request_no: no, type: 'PAYMENT', requester_user_id: keeperUserId,
      supplier_id: null, payee_name: (names.get(String(f.keeper_user_id)) || 'Petty cash keeper').slice(0, 200), payee_to_check: false,
      purchase_order_id: null, wanted_on: todayMyt(), owes_formal_invoice: false, source_key: `${TOP_UP_KEY}${f.id}:${Date.now()}`,
      note: `Petty cash top-up — ${dept}: brings the float back to its amount.`.slice(0, 500),
      amount_sen: amount, status: 'SUBMITTED',
    }).select('id, request_no').single(),
  );
  if (error || !row) return { ok: false, status: 500, error: 'save_failed', message: error?.message ?? 'insert returned nothing' };
  const ins = await sb.from('payment_request_lines').insert({
    id: crypto.randomUUID(), request_id: id, department: 'shared', unit_id: null, maintenance_issue_id: null, project_id: null,
    account_code: f.account_code, amount_sen: amount, description: `Petty cash top-up — ${dept}`, sort: 0,
  });
  if (ins.error) {
    await sb.from('payment_requests').delete().eq('id', id);
    return { ok: false, status: 500, error: 'save_failed', message: ins.error.message };
  }
  await sb.from('petty_cash_floats').update({ topup_requested_at: new Date().toISOString() }).eq('id', f.id);
  return { ok: true, created: true, id, requestNo: row.request_no, amountSen: amount };
}

/** A top-up voucher just raised for the float pays its open request: the request takes the voucher's amount (the float
 *  may have moved since it was asked) and the voucher names it, so posting the voucher pays the request. */
export async function linkTopUpRequest(sb: Db, companyId: number, floatId: string, pvId: string, amountSen: number): Promise<void> {
  const open = (await openTopUpRequests(sb, companyId, [floatId])).get(floatId);
  if (!open) return;
  await sb.from('payment_requests').update({ amount_sen: amountSen, updated_at: new Date().toISOString() }).eq('id', open.id);
  await sb.from('payment_request_lines').update({ amount_sen: amountSen }).eq('request_id', open.id);
  await sb.from('payment_vouchers').update({ payment_request_id: open.id }).eq('id', pvId);
  await sb.from('payment_voucher_lines').update({ payment_request_id: open.id }).eq('pv_id', pvId);
}
