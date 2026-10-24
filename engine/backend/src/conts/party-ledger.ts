// Conts only (not part of Houzs's code): one customer's or supplier's ledger (finance phase 1.5; SOP 2.1: "每个顾客看得
// 到欠款、所有往来和余额"). Every posted line naming the party on a customer control (SDC) or a supplier control (SCC):
// the balance brought forward, then each line of the period with a running balance — a customer's as what they owe
// (debit), a supplier's as what is owed to them (credit). Mounted under /accounting, behind the Ledger guard.
//   GET /accounting/party-ledger?kind=debtor|creditor&code=&from=&to=
import { hasHouzsPerm } from '../scm/lib/houzs-perms';
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { paginateAll } from '../scm/lib/paginate-all';
import { isReversalPair } from '../acc/reversal-pairs';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Line = {
  line_id: number; je_no: string; entry_date: string; source_type: string; source_doc_no: string | null; line_no: number;
  account_code: string; debit_sen: number; credit_sen: number; notes: string | null; reversed: boolean | null; reversed_by_je: string | null;
};
export type PartyLedgerLine = {
  date: string; jeNo: string; sourceType: string; doc: string | null; description: string | null; account: string;
  debitSen: number; creditSen: number; balanceSen: number;
};

export const partyLedgerHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, 'scm.payment_voucher.post')) return c.json({ error: "You don't have permission to read the ledger." }, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const kind = String(c.req.query('kind') ?? '');
  const code = String(c.req.query('code') ?? '').trim();
  const from = String(c.req.query('from') ?? '').trim();
  const to = String(c.req.query('to') ?? '').trim();
  if (kind !== 'debtor' && kind !== 'creditor') return c.json({ error: 'bad_kind', message: 'kind is debtor or creditor.' }, 400);
  if (!code) return c.json({ error: 'code_required' }, 400);
  if (!DATE.test(from) || !DATE.test(to) || from > to) return c.json({ error: 'bad_range', message: 'from and to must be YYYY-MM-DD, from no later than to.' }, 400);
  const sb = c.get('supabase');

  const { data: party, error: pErr } = await sb.from(kind === 'debtor' ? 'debtors' : 'suppliers').select('code, name, control_account')
    .eq('company_id', co.companyId).eq('code', code).maybeSingle();
  if (pErr) return c.json({ error: 'load_failed', reason: pErr.message }, 500);
  if (!party) return c.json({ error: 'not_found', message: `${code} is not a ${kind === 'debtor' ? 'customer' : 'supplier'}.` }, 404);

  /* The controls the party's lines can sit on: every customer control for a customer, every supplier control for a supplier. */
  const { data: ctl, error: cErr } = await sb.from('accounts').select('account_code')
    .eq('company_id', co.companyId).eq('special_type', kind === 'debtor' ? 'SDC' : 'SCC');
  if (cErr) return c.json({ error: 'load_failed', reason: cErr.message }, 500);
  const controls = ((ctl ?? []) as Array<{ account_code: string }>).map((a) => a.account_code);
  if (controls.length === 0) return c.json({ party, openingSen: 0, lines: [], debitSen: 0, creditSen: 0, closingSen: 0 });

  const read = await paginateAll<Line>((f, t) => sb.from('v_gl_entries')
    .select('line_id, je_no, entry_date, source_type, source_doc_no, line_no, account_code, debit_sen, credit_sen, notes, reversed, reversed_by_je')
    .eq('company_id', co.companyId).eq('party_code', code).in('account_code', controls).lte('entry_date', to)
    .order('line_id').range(f, t));
  if (read.error) return c.json({ error: 'load_failed', reason: String((read.error as { message?: string }).message ?? read.error) }, 500);
  /* A reversed entry and its contra cancel out: neither is shown, as the general ledger does by default. */
  const lines = ((read.data ?? []) as Line[]).filter((l) => !isReversalPair(l));
  const sign = (l: Line) => (kind === 'debtor' ? 1 : -1) * (Number(l.debit_sen) - Number(l.credit_sen));

  const openingSen = lines.filter((l) => l.entry_date < from).reduce((s, l) => s + sign(l), 0);
  const period = lines.filter((l) => l.entry_date >= from)
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.je_no.localeCompare(b.je_no) || Number(a.line_no) - Number(b.line_no));

  const jeNos = [...new Set(period.map((l) => l.je_no))];
  const narration = new Map<string, string | null>();
  for (let i = 0; i < jeNos.length; i += 150) {
    const { data, error } = await sb.from('journal_entries').select('je_no, narration').eq('company_id', co.companyId).in('je_no', jeNos.slice(i, i + 150));
    if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
    for (const j of (data ?? []) as Array<{ je_no: string; narration: string | null }>) narration.set(j.je_no, j.narration);
  }

  let balance = openingSen;
  let dr = 0;
  let cr = 0;
  const out: PartyLedgerLine[] = period.map((l) => {
    balance += sign(l);
    dr += Number(l.debit_sen);
    cr += Number(l.credit_sen);
    return {
      date: String(l.entry_date).slice(0, 10), jeNo: l.je_no, sourceType: l.source_type, doc: l.source_doc_no,
      description: (l.notes && String(l.notes)) || narration.get(l.je_no) || null, account: l.account_code,
      debitSen: Number(l.debit_sen), creditSen: Number(l.credit_sen), balanceSen: balance,
    };
  });
  return c.json({ party, from, to, openingSen, lines: out, debitSen: dr, creditSen: cr, closingSen: balance });
};
