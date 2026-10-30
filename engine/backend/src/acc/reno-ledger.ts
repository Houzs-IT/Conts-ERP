// Renovation contracts in the ledger (finance, chew 30 Oct 2026; spec docs/superpowers/specs/2026-10-30-renovation-
// revenue-einvoice-design.md 2.1; plan 2026-10-30-renovation-revenue-ledger.md Task 4).
//
// A contract is posted whole at signing — Dr the customer control (party = the project's own debtor) / Cr the project's
// advance sub-account (480-xxxx / 481-xxxx) — and each later change (VO, price change) posts only the difference between
// the contract as it stands and what is already posted, up or down. Called after the SQL transaction that changed the
// contract commits, best-effort: a refusal leaves the change unposted and is reported, and the next call catches up,
// because it always posts the whole difference.
//
// Contracts signed before the ledger start post nothing: the opening balances carry their receivable and advance.

import { paginateAll } from '../scm/lib/paginate-all';
import { postJournal } from './engine';
import { isBeforeLedgerStart, loadLedgerSettings } from './ledger-settings';
import { noCustomerAccountReason } from '../conts/parties';
import { todayMyt } from '../scm/lib/my-time';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as everywhere in acc/ */
type Sb = any;

export type RenoPostResult =
  | { ok: true; status: 'posted' | 'already_posted' | 'nothing' | 'before_ledger_start'; jeNo?: string; deltaSen?: number; reason?: string }
  | { ok: false; status: string; reason?: string };

/** Source types of the contract's own postings: the signing, then each change. */
export const CONTRACT_SIGNED = 'RCON';
export const CONTRACT_CHANGED = 'RVO';

/** The contract as it stands: its live SO rows, without the RENO-CREDIT rows a credit note adds (a credit note posts
    its own journal against revenue; it does not move the advance). */
export async function contractPostedSen(sb: Sb, soDocNo: string, companyId?: number): Promise<number> {
  const { data, error } = await paginateAll((from, to) => {
    let q = sb.from('mfg_sales_order_items').select('id, item_code, total_sen, cancelled').eq('doc_no', soDocNo);
    if (companyId != null) q = q.eq('company_id', companyId);
    return q.order('id').range(from, to);
  });
  if (error) throw new Error(`The lines of ${soDocNo} could not be read: ${(error as { message?: string }).message ?? String(error)}`);
  return ((data ?? []) as Array<{ item_code: string | null; total_sen: number | null; cancelled: boolean | null }>)
    .filter((r) => r.cancelled !== true && r.item_code !== 'RENO-CREDIT')
    .reduce((s, r) => s + Number(r.total_sen ?? 0), 0);
}

type JeRow = { id: string; source_type: string; source_doc_no: string; reversed: boolean | null };

/** The contract's RCON / RVO journals (active and reversed). */
async function contractJournals(sb: Sb, companyId: number, soDocNo: string): Promise<{ ok: true; rows: JeRow[] } | { ok: false; error: string }> {
  const { data, error } = await sb.from('journal_entries').select('id, source_type, source_doc_no, reversed')
    .eq('company_id', companyId).in('source_type', [CONTRACT_SIGNED, CONTRACT_CHANGED]).like('source_doc_no', `${soDocNo}%`);
  if (error) return { ok: false, error: error.message };
  const rvo = new RegExp(`^${soDocNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  return {
    ok: true,
    rows: ((data ?? []) as JeRow[]).filter((r) => (r.source_type === CONTRACT_SIGNED ? r.source_doc_no === soDocNo : rvo.test(r.source_doc_no))),
  };
}

type Ctx = {
  advance: string; control: string; debtorCode: string; partyName: string | null; soDate: string;
  contractSen: number; postedSen: number; jes: JeRow[]; active: JeRow[];
};
type CtxResult =
  | { ok: true; beforeStart: true; reason: string }
  | ({ ok: true; beforeStart: false } & Ctx)
  | { ok: false; status: string; reason: string };

/** Everything a posting needs: the contract, its accounts, what it stands at and what is already posted. */
async function loadContractCtx(sb: Sb, companyId: number, soDocNo: string): Promise<CtxResult> {
  const { data: so, error: soErr } = await sb.from('mfg_sales_orders').select('doc_no, so_kind, so_date, debtor_code')
    .eq('company_id', companyId).eq('doc_no', soDocNo).maybeSingle();
  if (soErr) return { ok: false, status: 'load_failed', reason: soErr.message };
  if (!so || so.so_kind !== 'RENOVATION') return { ok: false, status: 'not_renovation', reason: `${soDocNo} is not a renovation contract.` };

  const ls = await loadLedgerSettings(sb, companyId);
  if (!ls.ok) return { ok: false, status: 'ledger_settings_failed', reason: 'The ledger settings could not be read.' };
  const signed = String(so.so_date ?? '').slice(0, 10);
  if (isBeforeLedgerStart(signed, ls.settings)) {
    return { ok: true, beforeStart: true, reason: `Contract ${soDocNo} was signed before the ledger start (${ls.settings.ledgerStartDate}); the opening balances carry it.` };
  }

  const { data: contract, error: cErr } = await sb.from('reno_so_contracts').select('advance_account_code')
    .eq('so_doc_no', soDocNo).maybeSingle();
  if (cErr) return { ok: false, status: 'load_failed', reason: cErr.message };
  const advance = String(contract?.advance_account_code ?? '').trim();
  if (!advance) return { ok: false, status: 'no_advance_account', reason: `Contract ${soDocNo} has no advance account. Set it, then post again.` };

  const debtorCode = String(so.debtor_code ?? '').trim();
  let control: string | null = null;
  let partyName: string | null = null;
  if (debtorCode) {
    const { data: debtor, error: dErr } = await sb.from('debtors').select('control_account, name')
      .eq('company_id', companyId).eq('code', debtorCode).maybeSingle();
    if (dErr) return { ok: false, status: 'load_failed', reason: `The customer's control could not be read: ${dErr.message}` };
    control = debtor?.control_account ?? null;
    partyName = debtor?.name ?? null;
  }
  if (!control) return { ok: false, status: 'no_customer_account', reason: noCustomerAccountReason(debtorCode) };

  let contractSen: number;
  try {
    contractSen = await contractPostedSen(sb, soDocNo, companyId);
  } catch (err) {
    return { ok: false, status: 'load_failed', reason: err instanceof Error ? err.message : String(err) };
  }

  const jes = await contractJournals(sb, companyId, soDocNo);
  if (!jes.ok) return { ok: false, status: 'load_failed', reason: jes.error };
  const active = jes.rows.filter((r) => !r.reversed);
  let postedSen = 0;
  if (active.length > 0) {
    const { data: lines, error: lErr } = await sb.from('journal_entry_lines').select('journal_entry_id, account_code, debit_sen, credit_sen')
      .in('journal_entry_id', active.map((r) => r.id)).eq('account_code', advance);
    if (lErr) return { ok: false, status: 'load_failed', reason: lErr.message };
    postedSen = ((lines ?? []) as Array<{ debit_sen: number | null; credit_sen: number | null }>)
      .reduce((s, l) => s + Number(l.credit_sen ?? 0) - Number(l.debit_sen ?? 0), 0);
  }
  return { ok: true, beforeStart: false, advance, control, debtorCode, partyName, soDate: signed, contractSen, postedSen, jes: jes.rows, active };
}

export type ContractPostingState =
  | { ok: true; status: 'before_ledger_start'; reason: string }
  | { ok: true; status: 'in_step' | 'under_posted'; contractSen: number; postedSen: number }
  | { ok: false; status: string; reason: string };

/** Whether the ledger carries the contract as it stands (finance's "Post contract" shows when it does not). */
export async function contractPostingState(sb: Sb, p: { companyId: number; soDocNo: string }): Promise<ContractPostingState> {
  const ctx = await loadContractCtx(sb, p.companyId, p.soDocNo);
  if (!ctx.ok) return ctx;
  if (ctx.beforeStart) return { ok: true, status: 'before_ledger_start', reason: ctx.reason };
  return { ok: true, status: ctx.contractSen === ctx.postedSen ? 'in_step' : 'under_posted', contractSen: ctx.contractSen, postedSen: ctx.postedSen };
}

/** Post the contract's change since its last posting (see the header). `date` is the document date of the change:
    the contract date at signing, the VO's date after; null (finance posting again) = the contract date for the first
    posting, today after. Two changes racing for one number: the one answered
    already_posted reads again and posts what remains under the next number (once). */
export async function postContractChange(sb: Sb, p: { companyId: number; soDocNo: string; date: string | null; actor: string | null }): Promise<RenoPostResult> {
  const { companyId, soDocNo } = p;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ctx = await loadContractCtx(sb, companyId, soDocNo);
    if (!ctx.ok) return ctx;
    if (ctx.beforeStart) return { ok: true, status: 'before_ledger_start', reason: ctx.reason };

    const delta = ctx.contractSen - ctx.postedSen;
    if (delta === 0) return { ok: true, status: attempt === 0 ? 'nothing' : 'already_posted', deltaSen: 0 };

    const first = !ctx.active.some((r) => r.source_type === CONTRACT_SIGNED);
    let sourceType = CONTRACT_SIGNED;
    let sourceDocNo = soDocNo;
    if (!first) {
      /* The next number after every change ever posted, reversed ones included, so a number is never reused. */
      const n = ctx.jes.filter((r) => r.source_type === CONTRACT_CHANGED)
        .reduce((m, r) => Math.max(m, Number(r.source_doc_no.slice(soDocNo.length + 1)) || 0), 0) + 1;
      sourceType = CONTRACT_CHANGED;
      sourceDocNo = `${soDocNo}-${n}`;
    }
    const amount = Math.abs(delta);
    const customer = { accountCode: ctx.control, partyType: 'CUSTOMER', partyCode: ctx.debtorCode, partyName: ctx.partyName };
    const lines = delta > 0
      ? [{ ...customer, debitSen: amount, creditSen: 0 }, { accountCode: ctx.advance, debitSen: 0, creditSen: amount }]
      : [{ accountCode: ctx.advance, debitSen: amount, creditSen: 0 }, { ...customer, debitSen: 0, creditSen: amount }];
    const r = await postJournal(sb, {
      companyId,
      entryDate: p.date ?? (first ? ctx.soDate : todayMyt()),
      sourceType,
      sourceDocNo,
      narration: first
        ? `Renovation contract ${soDocNo} signed`
        : `Renovation contract ${soDocNo} ${delta > 0 ? 'increased' : 'reduced'} by variation${p.actor ? ` (${p.actor})` : ''}`,
      lines,
    });
    if (!r.ok) return { ok: false, status: r.status, reason: r.reason };
    if (r.status !== 'already_posted') return { ok: true, status: 'posted', jeNo: r.jeNo, deltaSen: delta };
  }
  return { ok: true, status: 'already_posted' };
}
