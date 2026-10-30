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

//
// Invoices and credit notes (plan Tasks 5–6): each one moves revenue by the waterfall. What every event allocated to
// which contract line and revenue account is kept in scm.reno_revenue_allocations, so the next event posts only the
// difference between the waterfall's target at the new cumulative and what is allocated so far (a negative difference
// is a debit: a VO or a credit that lowered a filled tier gives back from it). The cumulative is what is allocated so
// far plus this event's amount, so the journal always equals the document. The counter leg:
//   • an invoice                 Dr the advance sub-account (the contract was posted whole to it at signing);
//   • a contract credit note     Cr the customer control — the credit lowers what the customer owes and the contract;
//   • a negative instalment      Cr the advance — the VO that made it already lowered the customer.
// Cancel contract (Task 7) clears the advance left — Dr advance / Cr customer — with no credit note.

import { paginateAll } from '../scm/lib/paginate-all';
import { postJournal, reverseJournal } from './engine';
import { isBeforeLedgerStart, loadLedgerSettings } from './ledger-settings';
import { noCustomerAccountReason } from '../conts/parties';
import { todayMyt } from '../scm/lib/my-time';
import { allocationDelta, waterfallTarget } from './reno-waterfall';
import { resolveLineAccounts } from './reno-accounts';
import { contractRevenueLines, type ContractRevenueLine } from '../scm/lib/reno-contract-lines';
import { fmtSen } from '../scm/shared/format';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as everywhere in acc/ */
type Sb = any;

export type RenoPostResult =
  | { ok: true; status: 'posted' | 'already_posted' | 'nothing' | 'before_ledger_start'; jeNo?: string; deltaSen?: number; reason?: string }
  | { ok: false; status: string; reason?: string };

/** Source types of the contract's own postings: the signing, then each change. */
export const CONTRACT_SIGNED = 'RCON';
export const CONTRACT_CHANGED = 'RVO';
export const CONTRACT_CANCELLED = 'RCAN';

/** Allocation source types: what moved revenue, and so which counter leg it took. */
export const ALLOC_OPENING = 'OPENING';
export const ALLOC_INVOICE = 'SI';
export const ALLOC_CREDIT = 'CN';
export const ALLOC_BILL_CREDIT = 'BILL_CN';
/** The sources that moved the advance (an invoice out of it, a negative instalment back into it). */
const MOVES_ADVANCE = new Set([ALLOC_INVOICE, ALLOC_BILL_CREDIT]);

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

/** The project's debtor and its control. A debtor with no control refuses (PR #473): never guessed onto the AR rule. */
async function customerOf(sb: Sb, companyId: number, debtorCode: string): Promise<
  { ok: true; control: string; partyName: string | null } | { ok: false; status: string; reason: string }
> {
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
  return { ok: true, control, partyName };
}

type Ctx = {
  advance: string; control: string; debtorCode: string; partyName: string | null; soDate: string; status: string;
  contractSen: number; postedSen: number; jes: JeRow[]; active: JeRow[];
};
type CtxResult =
  | { ok: true; beforeStart: true; reason: string }
  | ({ ok: true; beforeStart: false } & Ctx)
  | { ok: false; status: string; reason: string };

/** Everything a posting needs: the contract, its accounts, what it stands at and what is already posted. */
async function loadContractCtx(sb: Sb, companyId: number, soDocNo: string): Promise<CtxResult> {
  const { data: so, error: soErr } = await sb.from('mfg_sales_orders').select('doc_no, so_kind, so_date, debtor_code, status')
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
  const customer = await customerOf(sb, companyId, debtorCode);
  if (!customer.ok) return customer;
  const { control, partyName } = customer;

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
  return { ok: true, beforeStart: false, advance, control, debtorCode, partyName, soDate: signed, status: String(so.status ?? ''), contractSen, postedSen, jes: jes.rows, active };
}

export type ContractPostingState =
  | { ok: true; status: 'before_ledger_start'; reason: string }
  | { ok: true; status: 'in_step' | 'under_posted'; contractSen: number; postedSen: number; uncleared?: number }
  | { ok: false; status: string; reason: string };

/** Whether the ledger carries the contract as it stands (finance's "Post contract" shows when it does not). A
    cancelled contract is also under-posted while the advance left was not cleared (`uncleared`). */
export async function contractPostingState(sb: Sb, p: { companyId: number; soDocNo: string }): Promise<ContractPostingState> {
  const ctx = await loadContractCtx(sb, p.companyId, p.soDocNo);
  if (!ctx.ok) return ctx;
  if (ctx.beforeStart) return { ok: true, status: 'before_ledger_start', reason: ctx.reason };
  const base = { contractSen: ctx.contractSen, postedSen: ctx.postedSen };
  if (ctx.contractSen !== ctx.postedSen) return { ok: true, status: 'under_posted', ...base };
  if (ctx.status === 'CANCELLED') {
    const left = await advanceLeft(sb, p.companyId, p.soDocNo, ctx.postedSen);
    if (!left.ok) return left;
    const { data, error } = await sb.from('journal_entries').select('id, reversed')
      .eq('company_id', p.companyId).eq('source_type', CONTRACT_CANCELLED).eq('source_doc_no', p.soDocNo);
    if (error) return { ok: false, status: 'load_failed', reason: error.message };
    const cleared = ((data ?? []) as Array<{ reversed: boolean | null }>).some((r) => !r.reversed);
    if (!cleared && left.sen !== 0) return { ok: true, status: 'under_posted', ...base, uncleared: left.sen };
  }
  return { ok: true, status: 'in_step', ...base };
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

/* ── Revenue: invoices and credit notes ─────────────────────────────────────────────────────────────────────────── */

type AllocRow = { id: string; source_type: string; source_doc_no: string; line_key: string; account_code: string; amount_sen: number };

async function readAllocations(sb: Sb, companyId: number, soDocNo: string): Promise<{ ok: true; rows: AllocRow[] } | { ok: false; error: string }> {
  const { data, error } = await paginateAll((from, to) => sb.from('reno_revenue_allocations')
    .select('id, source_type, source_doc_no, line_key, account_code, amount_sen')
    .eq('company_id', companyId).eq('so_doc_no', soDocNo).order('id').range(from, to));
  if (error) return { ok: false, error: `The revenue allocations of ${soDocNo} could not be read: ${(error as { message?: string }).message ?? String(error)}` };
  return { ok: true, rows: ((data ?? []) as AllocRow[]).map((r) => ({ ...r, amount_sen: Number(r.amount_sen) })) };
}

/** The advance the contract still holds: what its RCON / RVO posted, less what invoices moved out of it (and
    negative instalments moved back). */
async function advanceLeft(sb: Sb, companyId: number, soDocNo: string, postedSen: number): Promise<{ ok: true; sen: number } | { ok: false; status: string; reason: string }> {
  const allocs = await readAllocations(sb, companyId, soDocNo);
  if (!allocs.ok) return { ok: false, status: 'load_failed', reason: allocs.error };
  const moved = allocs.rows.filter((a) => MOVES_ADVANCE.has(a.source_type)).reduce((s, a) => s + a.amount_sen, 0);
  return { ok: true, sen: postedSen - moved };
}

type RevenueCtx = {
  advance: string; control: string; debtorCode: string; partyName: string | null; billedBeforeSen: number;
  lines: ContractRevenueLine[]; accountOf: (l: ContractRevenueLine) => string; allocs: AllocRow[];
};

/** What a revenue event needs: the contract's accounts, its lines with their revenue accounts, and its allocations.
    A line whose product has no group, or whose sub-category and group have no sales account, refuses by name. */
async function loadRevenueCtx(sb: Sb, companyId: number, soDocNo: string): Promise<{ ok: true; ctx: RevenueCtx } | { ok: false; status: string; reason: string }> {
  const { data: so, error: soErr } = await sb.from('mfg_sales_orders').select('doc_no, so_kind, debtor_code')
    .eq('company_id', companyId).eq('doc_no', soDocNo).maybeSingle();
  if (soErr) return { ok: false, status: 'load_failed', reason: soErr.message };
  if (!so || so.so_kind !== 'RENOVATION') return { ok: false, status: 'not_renovation', reason: `${soDocNo} is not a renovation contract.` };

  const { data: contract, error: cErr } = await sb.from('reno_so_contracts').select('advance_account_code, billed_before_golive_sen')
    .eq('so_doc_no', soDocNo).maybeSingle();
  if (cErr) return { ok: false, status: 'load_failed', reason: cErr.message };
  const advance = String(contract?.advance_account_code ?? '').trim();
  if (!advance) return { ok: false, status: 'no_advance_account', reason: `Contract ${soDocNo} has no advance account. Set it, then post again.` };

  const debtorCode = String(so.debtor_code ?? '').trim();
  const customer = await customerOf(sb, companyId, debtorCode);
  if (!customer.ok) return customer;

  let lines: ContractRevenueLine[];
  try {
    lines = await contractRevenueLines(sb, soDocNo, companyId);
  } catch (err) {
    return { ok: false, status: 'load_failed', reason: err instanceof Error ? err.message : String(err) };
  }
  const ungrouped = [...new Set(lines.filter((l) => !l.group).map((l) => l.itemCode || l.key))];
  if (ungrouped.length > 0) {
    return {
      ok: false,
      status: 'line_ungrouped',
      reason: `${ungrouped.join(', ')} on ${soDocNo} ${ungrouped.length === 1 ? 'has' : 'have'} no product group — set the product's category, then post again.`,
    };
  }
  const accounts = await resolveLineAccounts(sb, companyId, lines.map((l) => ({ group: l.group, subCategory: l.subCategory })), 'sales_account');
  if (!accounts.ok) return { ok: false, status: accounts.status, reason: accounts.reason };

  const allocs = await readAllocations(sb, companyId, soDocNo);
  if (!allocs.ok) return { ok: false, status: 'load_failed', reason: allocs.error };
  return {
    ok: true,
    ctx: {
      advance, control: customer.control, debtorCode, partyName: customer.partyName,
      billedBeforeSen: Number(contract?.billed_before_golive_sen ?? 0),
      lines, accountOf: (l) => accounts.accountOf({ group: l.group, subCategory: l.subCategory }), allocs: allocs.rows,
    },
  };
}

export type RevenueEventResult =
  | { ok: true; status: 'posted' | 'already_posted'; jeNo: string; jeId: string }
  | { ok: false; status: string; reason: string };

/** Post one revenue event (see the header). `amountSen` is signed: + an invoice, − a credit. Idempotent on
    (journalSource, docNo): a second call answers already_posted and leaves the allocations as they are. */
async function postRevenueEvent(sb: Sb, p: {
  companyId: number; soDocNo: string; allocSource: string; journalSource: string; docNo: string; date: string;
  amountSen: number; counter: 'advance' | 'customer'; narration: string;
}): Promise<RevenueEventResult> {
  const loaded = await loadRevenueCtx(sb, p.companyId, p.soDocNo);
  if (!loaded.ok) return loaded;
  const ctx = loaded.ctx;

  /* An old contract's first event: what AutoCount invoiced before go-live is filled first, with no journal (the
     opening balances carry it). */
  if (ctx.allocs.length === 0 && ctx.billedBeforeSen > 0) {
    let target: Map<string, number>;
    try {
      target = waterfallTarget(ctx.lines, ctx.billedBeforeSen);
    } catch (err) {
      return { ok: false, status: 'post_failed', reason: `${p.soDocNo}: ${err instanceof Error ? err.message : String(err)}` };
    }
    const rows = ctx.lines.filter((l) => (target.get(l.key) ?? 0) !== 0).map((l) => ({
      company_id: p.companyId, so_doc_no: p.soDocNo, source_type: ALLOC_OPENING, source_doc_no: p.soDocNo,
      line_key: l.key, account_code: ctx.accountOf(l), amount_sen: target.get(l.key) ?? 0,
    }));
    const { data, error } = await sb.from('reno_revenue_allocations').insert(rows).select('id, source_type, source_doc_no, line_key, account_code, amount_sen');
    if (error) return { ok: false, status: 'allocations_failed', reason: `The go-live allocation of ${p.soDocNo} could not be saved: ${error.message}` };
    ctx.allocs = ((data ?? rows) as AllocRow[]).map((r) => ({ ...r, amount_sen: Number(r.amount_sen) }));
  }

  const isMine = (a: AllocRow) => a.source_type === p.allocSource && a.source_doc_no === p.docNo;
  const mine = ctx.allocs.filter(isMine);
  if (mine.length > 0) {
    const { data: jes, error: jeErr } = await sb.from('journal_entries').select('id, je_no, reversed')
      .eq('company_id', p.companyId).eq('source_type', p.journalSource).eq('source_doc_no', p.docNo);
    if (jeErr) return { ok: false, status: 'load_failed', reason: jeErr.message };
    const live = ((jes ?? []) as Array<{ id: string; je_no: string; reversed: boolean | null }>).find((j) => !j.reversed);
    if (live) return { ok: true, status: 'already_posted', jeNo: live.je_no, jeId: live.id };
  }

  const already = new Map<string, number>();
  const accountOfKey = new Map<string, string>();
  for (const a of ctx.allocs) {
    if (isMine(a)) continue;
    already.set(a.line_key, (already.get(a.line_key) ?? 0) + a.amount_sen);
    accountOfKey.set(a.line_key, a.account_code);
  }
  for (const l of ctx.lines) accountOfKey.set(l.key, ctx.accountOf(l));
  const allocatedSen = [...already.values()].reduce((s, v) => s + v, 0);
  const cumulative = allocatedSen + p.amountSen;
  if (cumulative < 0) {
    return {
      ok: false,
      status: 'credit_exceeds_billed',
      reason: `A credit of ${fmtSen(-p.amountSen)} is more than ${p.soDocNo} has invoiced so far (${fmtSen(allocatedSen)} net). Lower it, then post again.`,
    };
  }
  if (cumulative > 0 && !ctx.lines.some((l) => l.amountSen > 0)) {
    return { ok: false, status: 'post_failed', reason: `${p.soDocNo} has no amount on any line to carry its revenue.` };
  }

  let delta: Map<string, number>;
  try {
    delta = allocationDelta(waterfallTarget(ctx.lines, cumulative), already);
  } catch (err) {
    return { ok: false, status: 'post_failed', reason: `${p.soDocNo}: ${err instanceof Error ? err.message : String(err)}` };
  }
  /* Net per revenue account, in the contract's line order (then lines no longer on it). */
  const order = [...ctx.lines.map((l) => l.key), ...[...delta.keys()].filter((k) => !ctx.lines.some((l) => l.key === k))];
  const nets = new Map<string, number>();
  for (const key of order) {
    const d = delta.get(key);
    if (!d) continue;
    const account = accountOfKey.get(key)!;
    nets.set(account, (nets.get(account) ?? 0) + d);
  }

  const counterLine = p.counter === 'advance'
    ? { accountCode: ctx.advance }
    : { accountCode: ctx.control, partyType: 'CUSTOMER', partyCode: ctx.debtorCode, partyName: ctx.partyName };
  const amount = Math.abs(p.amountSen);
  const lines = [
    { ...counterLine, debitSen: p.amountSen > 0 ? amount : 0, creditSen: p.amountSen > 0 ? 0 : amount },
    ...[...nets].filter(([, n]) => n !== 0).map(([accountCode, n]) => ({ accountCode, debitSen: n < 0 ? -n : 0, creditSen: n > 0 ? n : 0 })),
  ];
  const r = await postJournal(sb, { companyId: p.companyId, entryDate: p.date, sourceType: p.journalSource, sourceDocNo: p.docNo, narration: p.narration, lines });
  if (!r.ok) return { ok: false, status: r.status, reason: r.reason ?? r.status };

  /* What this event allocated, replacing any stale rows of its own (a journal reversed by hand, posted again). */
  if (r.status === 'posted' || mine.length === 0) {
    if (mine.length > 0) {
      const { error } = await sb.from('reno_revenue_allocations').delete().in('id', mine.map((a) => a.id));
      if (error) return { ok: false, status: 'allocations_failed', reason: `${p.docNo} posted as ${r.jeNo}, but its old allocations could not be cleared: ${error.message}` };
    }
    const rows = order.filter((k) => delta.get(k)).map((k) => ({
      company_id: p.companyId, so_doc_no: p.soDocNo, source_type: p.allocSource, source_doc_no: p.docNo,
      line_key: k, account_code: accountOfKey.get(k)!, amount_sen: delta.get(k)!,
    }));
    if (rows.length > 0) {
      const { error } = await sb.from('reno_revenue_allocations').insert(rows);
      if (error) {
        /* Without its allocations the next event would post this one's revenue again: take the journal back. */
        await reverseJournal(sb, {
          sourceType: p.journalSource, sourceDocNo: p.docNo, companyId: p.companyId,
          narration: (orig) => `Reversal of ${orig.je_no} — its revenue allocation could not be saved`,
        });
        return { ok: false, status: 'allocations_failed', reason: `${p.docNo} was not posted: its revenue allocation could not be saved (${error.message}).` };
      }
    }
  }
  return { ok: true, status: r.status === 'already_posted' ? 'already_posted' : 'posted', jeNo: r.jeNo, jeId: r.jeId };
}

/** A renovation invoice: Dr the contract's advance sub-account / Cr revenue by the waterfall (source SI). */
export async function postRenovationInvoice(sb: Sb, si: {
  companyId: number; soDocNo: string; invoiceNumber: string; invoiceDate: string; totalSen: number; debtorName: string | null;
}): Promise<RevenueEventResult> {
  return postRevenueEvent(sb, {
    companyId: si.companyId, soDocNo: si.soDocNo, allocSource: ALLOC_INVOICE, journalSource: 'SI', docNo: si.invoiceNumber,
    date: si.invoiceDate, amountSen: si.totalSen, counter: 'advance',
    narration: `Sales invoice ${si.invoiceNumber} — ${si.debtorName ?? ''} (renovation ${si.soDocNo})`,
  });
}

/** Which renovation credit a credit note is, if any: a contract credit (creditContract) or a negative instalment
    (billInstalment). Anything else posts as an ordinary note. */
export async function renovationCreditKind(sb: Sb, companyId: number, noteId: string): Promise<{ ok: true; kind: 'contract' | 'instalment' | null } | { ok: false; reason: string }> {
  const [cc, bill] = await Promise.all([
    sb.from('reno_contract_credits').select('id').eq('company_id', companyId).eq('credit_note_id', noteId).limit(1),
    sb.from('reno_instalment_bills').select('id').eq('company_id', companyId).eq('credit_note_id', noteId).limit(1),
  ]);
  if (cc.error) return { ok: false, reason: cc.error.message };
  if (bill.error) return { ok: false, reason: bill.error.message };
  if ((cc.data ?? []).length > 0) return { ok: true, kind: 'contract' };
  if ((bill.data ?? []).length > 0) return { ok: true, kind: 'instalment' };
  return { ok: true, kind: null };
}

/** A renovation credit note: Dr revenue (given back from the last tier filled) / Cr the customer control for a
    contract credit, or Cr the advance for a negative instalment (source CN, doc = the note number). On a fresh posting
    the note's own lines are rewritten to the revenue accounts it debited, when every one of them is a debit. */
export async function postRenovationCredit(sb: Sb, p: {
  companyId: number; kind: 'contract' | 'instalment';
  note: { id: string; note_number: string; note_date: string; so_doc_no: string; total_sen: number; party_name?: string | null; reason?: string | null };
}): Promise<RevenueEventResult> {
  const n = p.note;
  const r = await postRevenueEvent(sb, {
    companyId: p.companyId, soDocNo: n.so_doc_no, allocSource: p.kind === 'contract' ? ALLOC_CREDIT : ALLOC_BILL_CREDIT, journalSource: 'CN',
    docNo: n.note_number, date: String(n.note_date).slice(0, 10), amountSen: -Number(n.total_sen), counter: p.kind === 'contract' ? 'customer' : 'advance',
    narration: `Credit note ${n.note_number} — ${n.party_name ?? ''} (renovation ${n.so_doc_no})${n.reason ? ` (${n.reason})` : ''}`,
  });
  if (r.ok && r.status === 'posted') {
    const { data: jl } = await sb.from('journal_entry_lines').select('account_code, debit_sen, credit_sen, party_code').eq('journal_entry_id', r.jeId);
    const all = (jl ?? []) as Array<{ account_code: string; debit_sen: number; credit_sen: number }>;
    const debits = all.filter((l) => Number(l.debit_sen) > 0);
    const credits = all.filter((l) => Number(l.credit_sen) > 0);
    /* Only the counter leg is a credit: the note's lines become the revenue debits. Best-effort — the journal is
       the record; the lines only tell the reader where it went. */
    if (credits.length === 1 && debits.length > 0) {
      const { error: delErr } = await sb.from('acc_credit_note_lines').delete().eq('company_id', p.companyId).eq('note_id', n.id);
      if (!delErr) {
        await sb.from('acc_credit_note_lines').insert(debits.map((l, i) => ({
          company_id: p.companyId, note_id: n.id, line_no: i + 1, description: `${n.reason ?? 'Renovation credit'} — revenue given back`,
          account_code: l.account_code, amount_sen: Number(l.debit_sen),
        })));
      }
    }
  }
  return r;
}

/** Cancelling a credit note takes its revenue allocation away (its journal is reversed by the caller); a contract
    credit's RENO-CREDIT row is cancelled too, so the contract stands at its amount again. Best-effort, logged. */
export async function releaseRenovationCredit(sb: Sb, p: { companyId: number; noteId: string; noteNumber: string }): Promise<void> {
  const { error } = await sb.from('reno_revenue_allocations').delete().eq('company_id', p.companyId)
    .in('source_type', [ALLOC_CREDIT, ALLOC_BILL_CREDIT]).eq('source_doc_no', p.noteNumber);
  if (error) console.error(`[reno-ledger] allocations of ${p.noteNumber} not cleared:`, error.message);
  const { data: cc, error: ccErr } = await sb.from('reno_contract_credits').select('id').eq('company_id', p.companyId).eq('credit_note_id', p.noteId);
  if (ccErr) { console.error(`[reno-ledger] contract credit of ${p.noteNumber} not read:`, ccErr.message); return; }
  const ids = ((cc ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ids.length > 0) {
    const { error: upErr } = await sb.from('mfg_sales_order_items').update({ cancelled: true }).in('id', ids).eq('item_code', 'RENO-CREDIT');
    if (upErr) console.error(`[reno-ledger] RENO-CREDIT row of ${p.noteNumber} not cancelled:`, upErr.message);
  }
}

/** A cancelled invoice gives its tiers back: its allocations go (the caller reversed its journal). */
export async function releaseInvoiceAllocations(sb: Sb, invoiceNumber: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { error } = await sb.from('reno_revenue_allocations').delete().eq('source_type', ALLOC_INVOICE).eq('source_doc_no', invoiceNumber);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

/* ── Cancel contract ────────────────────────────────────────────────────────────────────────────────────────────── */

/** After the contract is CANCELLED: clear the advance it still holds (what was never invoiced) — Dr advance / Cr the
    customer control, source RCAN, doc = the SO. Whatever was invoiced and not credited stays as revenue. */
export async function postContractCancel(sb: Sb, p: { companyId: number; soDocNo: string; date: string | null; actor: string | null }): Promise<RenoPostResult> {
  const ctx = await loadContractCtx(sb, p.companyId, p.soDocNo);
  if (!ctx.ok) return ctx;
  if (ctx.beforeStart) return { ok: true, status: 'before_ledger_start', reason: ctx.reason };
  if (ctx.status !== 'CANCELLED') return { ok: false, status: 'not_cancelled', reason: `Contract ${p.soDocNo} is not cancelled.` };
  const left = await advanceLeft(sb, p.companyId, p.soDocNo, ctx.postedSen);
  if (!left.ok) return left;
  if (left.sen === 0) return { ok: true, status: 'nothing', deltaSen: 0 };
  const amount = Math.abs(left.sen);
  const customer = { accountCode: ctx.control, partyType: 'CUSTOMER', partyCode: ctx.debtorCode, partyName: ctx.partyName };
  const lines = left.sen > 0
    ? [{ accountCode: ctx.advance, debitSen: amount, creditSen: 0 }, { ...customer, debitSen: 0, creditSen: amount }]
    : [{ ...customer, debitSen: amount, creditSen: 0 }, { accountCode: ctx.advance, debitSen: 0, creditSen: amount }];
  const r = await postJournal(sb, {
    companyId: p.companyId,
    entryDate: p.date ?? todayMyt(),
    sourceType: CONTRACT_CANCELLED,
    sourceDocNo: p.soDocNo,
    narration: `Renovation contract ${p.soDocNo} cancelled — the part never invoiced cleared${p.actor ? ` (${p.actor})` : ''}`,
    lines,
  });
  if (!r.ok) return { ok: false, status: r.status, reason: r.reason };
  return { ok: true, status: r.status === 'already_posted' ? 'already_posted' : 'posted', jeNo: r.jeNo, deltaSen: left.sen };
}
