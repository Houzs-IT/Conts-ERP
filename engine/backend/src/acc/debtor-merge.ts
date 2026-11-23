// Conts only (not part of Houzs's code): one customer filed under two codes, merged into one (chew, 17 Nov 2026:
// MR WAYNE as 301-M144 in AutoCount and 301-M299 opened with his order). What the old code has on the ledger moves to
// the kept one in a single journal (source DMERGE, dated the day asked), each control by its own net, so every control
// stays as it was and only the party on it changes; manual journals may not touch a control, which is why this is its
// own door. Then the old code's orders, invoices and credits are pointed at the kept one and the old code is switched
// off. A dry run says what would move and changes nothing.
import { postJournal } from './engine';
import { paginateAll } from '../scm/lib/paginate-all';
import type { RuleLine } from './rules';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as everywhere in acc/ */
type Db = any;

export const MERGE_SOURCE = 'DMERGE';

export type DebtorMerge = {
  from: string; to: string; date: string;
  /** Each account the old code has a balance on, Dr positive: it moves to the kept code. */
  moves: { accountCode: string; balanceSen: number }[];
  orders: string[]; invoices: string[]; credits: number;
  done: boolean; jeNo?: string | null;
};
type Debtor = { id: string; code: string; name: string; is_active: boolean | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function mergeDebtors(sb: Db, companyId: number, fromCode: string, toCode: string, date: string, dryRun: boolean):
  Promise<{ ok: true; merge: DebtorMerge } | { ok: false; status: number; error: string }> {
  const from = fromCode.trim(), to = toCode.trim();
  if (!from || !to || from === to) return { ok: false, status: 400, error: 'Name two different customer codes: the one to merge and the one to keep.' };
  if (!DAY.test(date)) return { ok: false, status: 400, error: 'The date must be YYYY-MM-DD.' };
  const { data: rows, error } = await sb.from('debtors').select('id, code, name, is_active').eq('company_id', companyId).in('code', [from, to]);
  if (error) return { ok: false, status: 500, error: error.message };
  const old = (rows as Debtor[] | null)?.find((d) => d.code === from);
  const kept = (rows as Debtor[] | null)?.find((d) => d.code === to);
  if (!old) return { ok: false, status: 404, error: `${from} is not a customer.` };
  if (!kept) return { ok: false, status: 404, error: `${to} is not a customer.` };

  const [gl, orders, invoices, credits] = await Promise.all([
    paginateAll((f, t) => sb.from('v_gl_entries').select('account_code, debit_sen, credit_sen').eq('company_id', companyId).eq('party_code', from).order('line_id').range(f, t)),
    paginateAll((f, t) => sb.from('mfg_sales_orders').select('doc_no').eq('company_id', companyId).eq('debtor_code', from).order('doc_no').range(f, t)),
    paginateAll((f, t) => sb.from('sales_invoices').select('invoice_number').eq('company_id', companyId).eq('debtor_code', from).order('id').range(f, t)),
    paginateAll((f, t) => sb.from('customer_credits').select('id').eq('company_id', companyId).eq('debtor_code', from).order('id').range(f, t)),
  ]);
  const failed = gl.error ?? orders.error ?? invoices.error ?? credits.error;
  if (failed) return { ok: false, status: 500, error: (failed as { message?: string }).message ?? String(failed) };
  const net = new Map<string, number>();
  for (const l of (gl.data ?? []) as Array<{ account_code: string; debit_sen: number; credit_sen: number }>) {
    net.set(l.account_code, (net.get(l.account_code) ?? 0) + Number(l.debit_sen ?? 0) - Number(l.credit_sen ?? 0));
  }
  const merge: DebtorMerge = {
    from, to, date,
    moves: [...net].filter(([, v]) => v !== 0).map(([accountCode, balanceSen]) => ({ accountCode, balanceSen })).sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
    orders: ((orders.data ?? []) as Array<{ doc_no: string }>).map((o) => o.doc_no),
    invoices: ((invoices.data ?? []) as Array<{ invoice_number: string }>).map((i) => i.invoice_number),
    credits: (credits.data ?? []).length,
    done: false,
  };
  if (dryRun) return { ok: true, merge };

  if (merge.moves.length) {
    const party = (code: string, name: string) => ({ partyType: 'CUSTOMER', partyCode: code, partyName: name, department: 'shared' as const, notes: `Customer ${from} merged into ${to}` });
    const lines: RuleLine[] = merge.moves.flatMap((m) => {
      const sen = Math.abs(m.balanceSen);
      const dr = m.balanceSen > 0;
      return [
        { accountCode: m.accountCode, debitSen: dr ? 0 : sen, creditSen: dr ? sen : 0, ...party(old.code, old.name) },
        { accountCode: m.accountCode, debitSen: dr ? sen : 0, creditSen: dr ? 0 : sen, ...party(kept.code, kept.name) },
      ];
    });
    const r = await postJournal(sb, { companyId, entryDate: date, sourceType: MERGE_SOURCE, sourceDocNo: `${from}>${to}`,
      narration: `Customer merge: ${old.name} ${from} into ${to}`.slice(0, 500), lines });
    if (!r.ok) return { ok: false, status: 409, error: `The balance could not be moved: ${r.status}${'reason' in r && r.reason ? ` ${r.reason}` : ''}` };
    merge.jeNo = 'jeNo' in r ? r.jeNo ?? null : null;
  }
  for (const [table, patch] of [
    ['mfg_sales_orders', { debtor_code: to, debtor_name: kept.name }],
    ['sales_invoices', { debtor_code: to, debtor_name: kept.name }],
    ['customer_credits', { debtor_code: to }],
  ] as const) {
    const { error: e } = await sb.from(table).update(patch).eq('company_id', companyId).eq('debtor_code', from);
    if (e) return { ok: false, status: 500, error: `The balance moved${merge.jeNo ? ` (${merge.jeNo})` : ''}, but ${table} could not be pointed at ${to}: ${e.message}` };
  }
  const { error: off } = await sb.from('debtors').update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('company_id', companyId).eq('id', old.id);
  if (off) return { ok: false, status: 500, error: `Merged, but ${from} could not be switched off: ${off.message}` };
  return { ok: true, merge: { ...merge, done: true } };
}
