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
// Once finance seeds one at go-live (acc/reno-opening, plan Task 8), the contract amount it was seeded at is its
// baseline (reno_so_contracts.golive_contract_sen): a VO after go-live posts the difference from it, as RVO.

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
  /** Signed before the ledger start and seeded at go-live: its baseline counts as posted; it never posts RCON. */
  golive: boolean; ledgerStart: string | null;
  advance: string; control: string; debtorCode: string; partyName: string | null; soDate: string; status: string;
  contractSen: number; postedSen: number; jes: JeRow[]; active: JeRow[];
};
type CtxResult =
  | { ok: true; beforeStart: true; reason: string; status: string }
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
  const { data: contract, error: cErr } = await sb.from('reno_so_contracts').select('advance_account_code, golive_contract_sen')
    .eq('so_doc_no', soDocNo).maybeSingle();
  if (cErr) return { ok: false, status: 'load_failed', reason: cErr.message };
  /* Signed before the ledger start: posts nothing until finance seeds it at go-live (acc/reno-opening); then the
     contract amount it was seeded at counts as posted, and a later VO posts its difference (RVO, never RCON). */
  const golive = isBeforeLedgerStart(signed, ls.settings);
  const baseline = contract?.golive_contract_sen == null ? null : Number(contract.golive_contract_sen);
  if (golive && baseline == null) {
    return { ok: true, beforeStart: true, status: String(so.status ?? ''), reason: `Contract ${soDocNo} was signed before the ledger start (${ls.settings.ledgerStartDate}); the opening balances carry it.` };
  }
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
  let postedSen = golive ? (baseline ?? 0) : 0;
  if (active.length > 0) {
    const { data: lines, error: lErr } = await sb.from('journal_entry_lines').select('journal_entry_id, account_code, debit_sen, credit_sen')
      .in('journal_entry_id', active.map((r) => r.id)).eq('account_code', advance);
    if (lErr) return { ok: false, status: 'load_failed', reason: lErr.message };
    postedSen += ((lines ?? []) as Array<{ debit_sen: number | null; credit_sen: number | null }>)
      .reduce((s, l) => s + Number(l.credit_sen ?? 0) - Number(l.debit_sen ?? 0), 0);
  }
  return { ok: true, beforeStart: false, golive, ledgerStart: ls.settings.ledgerStartDate ?? null, advance, control, debtorCode, partyName, soDate: signed, status: String(so.status ?? ''), contractSen, postedSen, jes: jes.rows, active };
}

export type ContractPostingState =
  | { ok: true; status: 'before_ledger_start'; reason: string }
  | { ok: true; status: 'in_step' | 'under_posted'; contractSen: number; postedSen: number; uncleared?: number }
  | { ok: false; status: string; reason: string };

/** Whether the ledger carries the contract as it stands (finance's "Post contract" shows when it does not). A
    cancelled contract is in step only when its advance sub-account's balance is 0 (`uncleared` = what is left),
    contracts signed before the ledger start included (their opening balance sits on the advance). */
export async function contractPostingState(sb: Sb, p: { companyId: number; soDocNo: string }): Promise<ContractPostingState> {
  const ctx = await loadContractCtx(sb, p.companyId, p.soDocNo);
  if (!ctx.ok) return ctx;
  const base = ctx.beforeStart ? { contractSen: 0, postedSen: 0 } : { contractSen: ctx.contractSen, postedSen: ctx.postedSen };
  const status = ctx.status;
  if (status === 'CANCELLED') {
    const cc = await loadCancelCtx(sb, p.companyId, p.soDocNo);
    if (!cc.ok) return ctx.beforeStart && cc.status === 'no_advance_account' ? { ok: true, status: 'before_ledger_start', reason: ctx.reason } : cc;
    return cc.balanceSen === 0 ? { ok: true, status: 'in_step', ...base } : { ok: true, status: 'under_posted', ...base, uncleared: cc.balanceSen };
  }
  if (ctx.beforeStart) return { ok: true, status: 'before_ledger_start', reason: ctx.reason };
  return { ok: true, status: ctx.contractSen === ctx.postedSen ? 'in_step' : 'under_posted', ...base };
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

    const first = !ctx.golive && !ctx.active.some((r) => r.source_type === CONTRACT_SIGNED);
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
    let entryDate = p.date ?? (first ? ctx.soDate : todayMyt());
    /* A seeded old contract's VO dated before go-live but applied after the seeding: the baseline does not carry
       it, so it posts on the ledger start. */
    if (ctx.golive && ctx.ledgerStart && entryDate < ctx.ledgerStart) entryDate = ctx.ledgerStart;
    const r = await postJournal(sb, {
      companyId,
      entryDate,
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

type RevenueCtx = {
  status: string; advance: string; control: string; debtorCode: string; partyName: string | null; billedBeforeSen: number;
  lines: ContractRevenueLine[]; accountOf: (l: ContractRevenueLine) => string; allocs: AllocRow[];
};

/** What a revenue event needs: the contract's accounts, its lines with their revenue accounts, and its allocations.
    A line whose product has no group, or whose sub-category and group have no sales account, refuses by name. */
async function loadRevenueCtx(sb: Sb, companyId: number, soDocNo: string): Promise<{ ok: true; ctx: RevenueCtx } | { ok: false; status: string; reason: string }> {
  const { data: so, error: soErr } = await sb.from('mfg_sales_orders').select('doc_no, so_kind, debtor_code, status')
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
      status: String(so.status ?? ''), advance, control: customer.control, debtorCode, partyName: customer.partyName,
      billedBeforeSen: Number(contract?.billed_before_golive_sen ?? 0),
      lines, accountOf: (l) => accounts.accountOf({ group: l.group, subCategory: l.subCategory }), allocs: allocs.rows,
    },
  };
}

/** An old contract's first event: what AutoCount invoiced before go-live is filled first, with no journal (the
    opening balances carry it). Two first events racing both seed; each then keeps the lowest id per line and deletes
    the rest, so they converge on one seed (the amounts are the same target either way). Returns the allocations. */
async function seedOpening(sb: Sb, companyId: number, soDocNo: string, ctx: RevenueCtx): Promise<{ ok: true; rows: AllocRow[] } | { ok: false; status: string; reason: string }> {
  let target: Map<string, number>;
  try {
    target = waterfallTarget(ctx.lines, ctx.billedBeforeSen);
  } catch (err) {
    return { ok: false, status: 'post_failed', reason: `${soDocNo}: ${err instanceof Error ? err.message : String(err)}` };
  }
  const rows = ctx.lines.filter((l) => (target.get(l.key) ?? 0) !== 0).map((l) => ({
    company_id: companyId, so_doc_no: soDocNo, source_type: ALLOC_OPENING, source_doc_no: soDocNo,
    line_key: l.key, account_code: ctx.accountOf(l), amount_sen: target.get(l.key) ?? 0,
  }));
  const { error } = await sb.from('reno_revenue_allocations').insert(rows);
  if (error) return { ok: false, status: 'allocations_failed', reason: `The go-live allocation of ${soDocNo} could not be saved: ${error.message}` };
  const after = await readAllocations(sb, companyId, soDocNo);
  if (!after.ok) return { ok: false, status: 'load_failed', reason: after.error };
  const keep = new Map<string, string>();
  for (const a of after.rows.filter((r) => r.source_type === ALLOC_OPENING)) {
    const k = keep.get(a.line_key);
    if (k === undefined || String(a.id) < k) keep.set(a.line_key, String(a.id));
  }
  const extra = after.rows.filter((r) => r.source_type === ALLOC_OPENING && keep.get(r.line_key) !== String(r.id)).map((r) => r.id);
  if (extra.length > 0) {
    const { error: dErr } = await sb.from('reno_revenue_allocations').delete().in('id', extra);
    if (dErr) return { ok: false, status: 'allocations_failed', reason: `The go-live allocation of ${soDocNo} was saved twice and could not be tidied: ${dErr.message}` };
  }
  return { ok: true, rows: after.rows.filter((r) => !extra.includes(r.id)) };
}

export type RevenueEventResult =
  | { ok: true; status: 'posted' | 'already_posted'; jeNo: string; jeId: string }
  | { ok: false; status: string; reason: string };

type Move = { key: string; account: string; amount: number };

/** Post one revenue event (see the header). `amountSen` is signed: + an invoice, − a credit. Idempotent on
    (journalSource, docNo): a second call answers already_posted and leaves the allocations as they are. A give-back
    debits the accounts the line's revenue was booked to (latest first), not today's binding. On a cancelled contract
    the advance is cleared again after posting. */
async function postRevenueEvent(sb: Sb, p: {
  companyId: number; soDocNo: string; allocSource: string; journalSource: string; docNo: string; date: string;
  amountSen: number; counter: 'advance' | 'customer'; narration: string;
}): Promise<RevenueEventResult> {
  const loaded = await loadRevenueCtx(sb, p.companyId, p.soDocNo);
  if (!loaded.ok) return loaded;
  const ctx = loaded.ctx;

  if (ctx.allocs.length === 0 && ctx.billedBeforeSen > 0) {
    const seeded = await seedOpening(sb, p.companyId, p.soDocNo, ctx);
    if (!seeded.ok) return seeded;
    ctx.allocs = seeded.rows;
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
  /* Per line, what sits on each account (insertion order), for give-backs. */
  const booked = new Map<string, Map<string, number>>();
  for (const a of ctx.allocs) {
    if (isMine(a)) continue;
    already.set(a.line_key, (already.get(a.line_key) ?? 0) + a.amount_sen);
    const m = booked.get(a.line_key) ?? new Map<string, number>();
    m.set(a.account_code, (m.get(a.account_code) ?? 0) + a.amount_sen);
    booked.set(a.line_key, m);
  }
  const bindingOf = new Map(ctx.lines.map((l) => [l.key, ctx.accountOf(l)]));
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
  /* In the contract's line order (then lines no longer on it). */
  const order = [...ctx.lines.map((l) => l.key), ...[...delta.keys()].filter((k) => !bindingOf.has(k))];
  const moves: Move[] = [];
  for (const key of order) {
    const d = delta.get(key);
    if (!d) continue;
    const onAccounts = [...(booked.get(key) ?? new Map<string, number>())].filter(([, v]) => v > 0);
    if (d > 0) {
      moves.push({ key, account: bindingOf.get(key) ?? onAccounts[onAccounts.length - 1]?.[0] ?? '', amount: d });
      continue;
    }
    let left = -d;
    for (const [account, v] of [...onAccounts].reverse()) {
      if (left <= 0) break;
      const take = Math.min(left, v);
      moves.push({ key, account, amount: -take });
      left -= take;
    }
    if (left > 0) moves.push({ key, account: bindingOf.get(key) ?? onAccounts[0]?.[0] ?? '', amount: -left });
  }
  if (moves.some((m) => !m.account)) return { ok: false, status: 'post_failed', reason: `${p.soDocNo}: a line has no revenue account to post to.` };
  const nets = new Map<string, number>();
  for (const m of moves) nets.set(m.account, (nets.get(m.account) ?? 0) + m.amount);

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
    const rows = moves.filter((m) => m.amount !== 0).map((m) => ({
      company_id: p.companyId, so_doc_no: p.soDocNo, source_type: p.allocSource, source_doc_no: p.docNo,
      line_key: m.key, account_code: m.account, amount_sen: m.amount,
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
  if (r.status === 'posted' && ctx.status === 'CANCELLED') await reclearIfCancelled(sb, p.companyId, p.soDocNo);
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

type NoteLineRow = { company_id: number; note_id: string; line_no: number; description: string | null; account_code: string; amount_sen: number };

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
  if (r.ok && r.status === 'posted') await rewriteNoteLines(sb, p.companyId, n, r.jeId);
  return r;
}

/** Best-effort: the journal is the record; the lines only tell the reader where it went. Never leaves a note with
    no lines — a failed insert puts the old lines back. */
async function rewriteNoteLines(sb: Sb, companyId: number, n: { id: string; note_number: string; reason?: string | null }, jeId: string): Promise<void> {
  const { data: jl, error: jErr } = await sb.from('journal_entry_lines').select('account_code, debit_sen, credit_sen').eq('journal_entry_id', jeId);
  if (jErr) return;
  const all = (jl ?? []) as Array<{ account_code: string; debit_sen: number; credit_sen: number }>;
  const debits = all.filter((l) => Number(l.debit_sen) > 0);
  /* Only when the counter leg is the one credit: the note's lines become the revenue debits. */
  if (all.filter((l) => Number(l.credit_sen) > 0).length !== 1 || debits.length === 0) return;
  const { data: oldData, error: oErr } = await sb.from('acc_credit_note_lines').select('company_id, note_id, line_no, description, account_code, amount_sen')
    .eq('company_id', companyId).eq('note_id', n.id);
  if (oErr) return;
  const old = (oldData ?? []) as NoteLineRow[];
  const { error: delErr } = await sb.from('acc_credit_note_lines').delete().eq('company_id', companyId).eq('note_id', n.id);
  if (delErr) { console.error(`[reno-ledger] lines of ${n.note_number} not rewritten:`, delErr.message); return; }
  const { error: insErr } = await sb.from('acc_credit_note_lines').insert(debits.map((l, i) => ({
    company_id: companyId, note_id: n.id, line_no: i + 1, description: `${n.reason ?? 'Renovation credit'} — revenue given back`,
    account_code: l.account_code, amount_sen: Number(l.debit_sen),
  })));
  if (insErr) {
    console.error(`[reno-ledger] lines of ${n.note_number} not rewritten, old lines put back:`, insErr.message);
    const { error: backErr } = await sb.from('acc_credit_note_lines').insert(old);
    if (backErr) console.error(`[reno-ledger] ${n.note_number} has lost its lines: ${backErr.message}`);
  }
}

/** The SO header roll-up from its live lines (the REST twin of renovation-so recomputeSoHeader). */
async function recomputeSoHeaderRest(sb: Sb, companyId: number, soDocNo: string): Promise<void> {
  const { data: items, error } = await paginateAll((from, to) => sb.from('mfg_sales_order_items').select('id, total_sen, line_cost_sen, cancelled')
    .eq('company_id', companyId).eq('doc_no', soDocNo).order('id').range(from, to));
  if (error) { console.error(`[reno-ledger] ${soDocNo} header not recomputed:`, (error as { message?: string }).message); return; }
  const live = ((items ?? []) as Array<{ total_sen: number | null; line_cost_sen: number | null; cancelled: boolean | null }>).filter((r) => r.cancelled !== true);
  const total = live.reduce((s, r) => s + Number(r.total_sen ?? 0), 0);
  const cost = live.reduce((s, r) => s + Number(r.line_cost_sen ?? 0), 0);
  const { data: so, error: soErr } = await sb.from('mfg_sales_orders').select('paid_sen, version').eq('company_id', companyId).eq('doc_no', soDocNo).maybeSingle();
  if (soErr || !so) return;
  const { error: upErr } = await sb.from('mfg_sales_orders').update({
    local_total_sen: total, subtotal_sen: total, total_revenue_sen: total, others_sen: total, total_cost_sen: cost, others_cost_sen: cost,
    total_margin_sen: total - cost, line_count: live.length, balance_sen: total - Number(so.paid_sen ?? 0), version: Number(so.version ?? 0) + 1,
    updated_at: new Date().toISOString(),
  }).eq('company_id', companyId).eq('doc_no', soDocNo);
  if (upErr) console.error(`[reno-ledger] ${soDocNo} header not recomputed:`, upErr.message);
}

/** Cancelling a credit note takes its revenue allocation away (its journal is reversed by the caller); a contract
    credit's RENO-CREDIT row is cancelled too, so the contract stands at its amount again; a cancelled contract is
    cleared again. Best-effort, logged. */
export async function releaseRenovationCredit(sb: Sb, p: { companyId: number; noteId: string; noteNumber: string; soDocNo?: string | null }): Promise<void> {
  const { error } = await sb.from('reno_revenue_allocations').delete().eq('company_id', p.companyId)
    .in('source_type', [ALLOC_CREDIT, ALLOC_BILL_CREDIT]).eq('source_doc_no', p.noteNumber);
  if (error) console.error(`[reno-ledger] allocations of ${p.noteNumber} not cleared:`, error.message);
  const { data: cc, error: ccErr } = await sb.from('reno_contract_credits').select('id, so_doc_no').eq('company_id', p.companyId).eq('credit_note_id', p.noteId);
  if (ccErr) { console.error(`[reno-ledger] contract credit of ${p.noteNumber} not read:`, ccErr.message); return; }
  const rows = (cc ?? []) as Array<{ id: string; so_doc_no: string }>;
  if (rows.length > 0) {
    const { error: upErr } = await sb.from('mfg_sales_order_items').update({ cancelled: true }).in('id', rows.map((r) => r.id)).eq('item_code', 'RENO-CREDIT');
    if (upErr) console.error(`[reno-ledger] RENO-CREDIT row of ${p.noteNumber} not cancelled:`, upErr.message);
    else await recomputeSoHeaderRest(sb, p.companyId, rows[0].so_doc_no);
  }
  const so = p.soDocNo ?? rows[0]?.so_doc_no ?? null;
  if (so) await reclearIfCancelled(sb, p.companyId, so);
}

/** A cancelled invoice gives its tiers back: its allocations go (the caller reversed its journal). */
export async function releaseInvoiceAllocations(sb: Sb, invoiceNumber: string, companyId: number | null): Promise<{ ok: true; soDocNo: string | null } | { ok: false; reason: string }> {
  const scoped = (q: Sb) => (companyId != null ? q.eq('company_id', companyId) : q);
  const { data, error: rErr } = await scoped(sb.from('reno_revenue_allocations').select('so_doc_no').eq('source_type', ALLOC_INVOICE).eq('source_doc_no', invoiceNumber));
  if (rErr) return { ok: false, reason: rErr.message };
  const rows = (data ?? []) as Array<{ so_doc_no: string }>;
  if (rows.length === 0) return { ok: true, soDocNo: null };
  const { error } = await scoped(sb.from('reno_revenue_allocations').delete().eq('source_type', ALLOC_INVOICE).eq('source_doc_no', invoiceNumber));
  return error ? { ok: false, reason: error.message } : { ok: true, soDocNo: rows[0].so_doc_no };
}

/* ── Cancel contract ────────────────────────────────────────────────────────────────────────────────────────────── */

/** The live ledger balance of one account in one company (credit − debit): posted, not reversed, not a contra —
    the rule the balance views use. The OPENING journal counts like any other. */
async function accountBalance(sb: Sb, companyId: number, accountCode: string): Promise<{ ok: true; sen: number } | { ok: false; status: string; reason: string }> {
  const { data, error } = await paginateAll((from, to) => sb.from('journal_entry_lines').select('journal_entry_id, debit_sen, credit_sen')
    .eq('account_code', accountCode).order('journal_entry_id').range(from, to));
  if (error) return { ok: false, status: 'load_failed', reason: `The balance of ${accountCode} could not be read: ${(error as { message?: string }).message ?? String(error)}` };
  const lines = (data ?? []) as Array<{ journal_entry_id: string; debit_sen: number | null; credit_sen: number | null }>;
  const ids = [...new Set(lines.map((l) => String(l.journal_entry_id)))];
  const live = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: jes, error: jErr } = await sb.from('journal_entries').select('id, company_id, posted, reversed, reversed_by_je').in('id', ids.slice(i, i + 200));
    if (jErr) return { ok: false, status: 'load_failed', reason: `The journals on ${accountCode} could not be read: ${jErr.message}` };
    for (const j of (jes ?? []) as Array<{ id: string; company_id: number | null; posted: boolean | null; reversed: boolean | null; reversed_by_je: string | null }>) {
      if (Number(j.company_id) === companyId && j.posted !== false && !j.reversed && !j.reversed_by_je) live.add(String(j.id));
    }
  }
  return { ok: true, sen: lines.filter((l) => live.has(String(l.journal_entry_id))).reduce((s, l) => s + Number(l.credit_sen ?? 0) - Number(l.debit_sen ?? 0), 0) };
}

type CancelCtx = {
  status: string; advance: string; control: string; debtorCode: string; partyName: string | null; balanceSen: number;
  rcan: Array<{ source_doc_no: string; reversed: boolean | null }>;
};

/** A contract's clearing state, whenever it was signed: its advance account's balance and its RCAN journals. */
async function loadCancelCtx(sb: Sb, companyId: number, soDocNo: string): Promise<({ ok: true } & CancelCtx) | { ok: false; status: string; reason: string }> {
  const { data: so, error: soErr } = await sb.from('mfg_sales_orders').select('doc_no, so_kind, debtor_code, status')
    .eq('company_id', companyId).eq('doc_no', soDocNo).maybeSingle();
  if (soErr) return { ok: false, status: 'load_failed', reason: soErr.message };
  if (!so || so.so_kind !== 'RENOVATION') return { ok: false, status: 'not_renovation', reason: `${soDocNo} is not a renovation contract.` };
  const { data: contract, error: cErr } = await sb.from('reno_so_contracts').select('advance_account_code').eq('so_doc_no', soDocNo).maybeSingle();
  if (cErr) return { ok: false, status: 'load_failed', reason: cErr.message };
  const advance = String(contract?.advance_account_code ?? '').trim();
  if (!advance) return { ok: false, status: 'no_advance_account', reason: `Contract ${soDocNo} has no advance account. Set it, then post again.` };
  const debtorCode = String(so.debtor_code ?? '').trim();
  const customer = await customerOf(sb, companyId, debtorCode);
  if (!customer.ok) return customer;
  const bal = await accountBalance(sb, companyId, advance);
  if (!bal.ok) return bal;
  const { data: jes, error: jErr } = await sb.from('journal_entries').select('source_doc_no, reversed')
    .eq('company_id', companyId).eq('source_type', CONTRACT_CANCELLED).like('source_doc_no', `${soDocNo}%`);
  if (jErr) return { ok: false, status: 'load_failed', reason: jErr.message };
  const rcanRe = new RegExp(`^${soDocNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-\\d+)?$`);
  return {
    ok: true, status: String(so.status ?? ''), advance, control: customer.control, debtorCode, partyName: customer.partyName, balanceSen: bal.sen,
    rcan: ((jes ?? []) as Array<{ source_doc_no: string; reversed: boolean | null }>).filter((r) => rcanRe.test(r.source_doc_no)),
  };
}

/** On a CANCELLED contract: clear what its advance sub-account holds — the ledger balance, so a late invoice, a
    reversal or an opening balance is caught too — Dr advance / Cr the customer control (the reverse for a debit
    balance). Source RCAN: doc = the SO the first time, then SO-2, SO-3 … each time the balance is non-zero again.
    Dated `date` (the cancel date) or today, never before the ledger start. Whatever was invoiced and not credited
    stays as revenue. */
export async function postContractCancel(sb: Sb, p: { companyId: number; soDocNo: string; date: string | null; actor: string | null }): Promise<RenoPostResult> {
  const { companyId, soDocNo } = p;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const c = await loadCancelCtx(sb, companyId, soDocNo);
    if (!c.ok) return c;
    if (c.status !== 'CANCELLED') return { ok: false, status: 'not_cancelled', reason: `Contract ${soDocNo} is not cancelled.` };
    if (c.balanceSen === 0) return { ok: true, status: attempt === 0 ? 'nothing' : 'already_posted', deltaSen: 0 };

    const ls = await loadLedgerSettings(sb, companyId);
    if (!ls.ok) return { ok: false, status: 'ledger_settings_failed', reason: 'The ledger settings could not be read.' };
    let date = p.date ?? todayMyt();
    if (isBeforeLedgerStart(date, ls.settings)) date = String(ls.settings.ledgerStartDate);

    const n = c.rcan.reduce((m, r) => Math.max(m, r.source_doc_no === soDocNo ? 1 : Number(r.source_doc_no.slice(soDocNo.length + 1)) || 0), 0) + 1;
    const sourceDocNo = n === 1 ? soDocNo : `${soDocNo}-${n}`;
    const amount = Math.abs(c.balanceSen);
    const customer = { accountCode: c.control, partyType: 'CUSTOMER', partyCode: c.debtorCode, partyName: c.partyName };
    const lines = c.balanceSen > 0
      ? [{ accountCode: c.advance, debitSen: amount, creditSen: 0 }, { ...customer, debitSen: 0, creditSen: amount }]
      : [{ ...customer, debitSen: amount, creditSen: 0 }, { accountCode: c.advance, debitSen: 0, creditSen: amount }];
    const r = await postJournal(sb, {
      companyId, entryDate: date, sourceType: CONTRACT_CANCELLED, sourceDocNo,
      narration: `Renovation contract ${soDocNo} cancelled — advance ${c.advance} cleared${p.actor ? ` (${p.actor})` : ''}`,
      lines,
    });
    if (!r.ok) return { ok: false, status: r.status, reason: r.reason };
    if (r.status !== 'already_posted') return { ok: true, status: 'posted', jeNo: r.jeNo, deltaSen: c.balanceSen };
  }
  return { ok: true, status: 'already_posted' };
}

/** After a posting or reversal that touched a contract's advance: when the contract is cancelled, clear it again.
    Best-effort, logged — finance's "Post contract" retries. */
export async function reclearIfCancelled(sb: Sb, companyId: number, soDocNo: string): Promise<void> {
  try {
    const { data: so } = await sb.from('mfg_sales_orders').select('status, so_kind').eq('company_id', companyId).eq('doc_no', soDocNo).maybeSingle();
    if (!so || so.so_kind !== 'RENOVATION' || so.status !== 'CANCELLED') return;
    const r = await postContractCancel(sb, { companyId, soDocNo, date: null, actor: null });
    if (!r.ok) console.error(`[reno-ledger] ${soDocNo} advance not cleared again:`, r.status, r.reason);
  } catch (err) {
    console.error(`[reno-ledger] ${soDocNo} advance not cleared again:`, err);
  }
}

export type CancelGate = { ok: true } | { ok: false; status: 'forbidden' | 'contract_under_posted' | 'documents_unposted' | 'load_failed'; reason: string };

/** Before a contract is cancelled. A billed contract needs finance (scm.payment_voucher.post). The contract must be
    posted in full (RCON / RVO in step), and every issued invoice and credit note on it posted — otherwise the
    clearing would miss them. Contracts signed before the ledger start are not held by their contract posting. */
export async function cancelGate(sb: Sb, p: { companyId: number; soDocNo: string; isFinance: boolean }): Promise<CancelGate> {
  const { companyId, soDocNo } = p;
  const { data: bills, error: bErr } = await sb.from('reno_instalment_bills').select('id').eq('so_doc_no', soDocNo).limit(1);
  if (bErr) return { ok: false, status: 'load_failed', reason: bErr.message };
  if ((bills ?? []).length > 0 && !p.isFinance) {
    return { ok: false, status: 'forbidden', reason: 'This contract has been billed: cancelling it needs the "scm.payment_voucher.post" permission (finance).' };
  }

  const state = await contractPostingState(sb, { companyId, soDocNo });
  if (!state.ok) return { ok: false, status: 'contract_under_posted', reason: `Contract ${soDocNo} is not posted (${state.reason}). Finance posts it first, then cancel.` };
  if (state.status === 'under_posted') {
    return { ok: false, status: 'contract_under_posted', reason: `Contract ${soDocNo} is not fully posted (ledger ${fmtSen(state.postedSen)} of ${fmtSen(state.contractSen)}). Finance posts the contract first, then cancel.` };
  }

  const ls = await loadLedgerSettings(sb, companyId);
  if (!ls.ok) return { ok: false, status: 'load_failed', reason: 'The ledger settings could not be read.' };
  const inLedger = (d: string | null | undefined) => !isBeforeLedgerStart(String(d ?? '').slice(0, 10), ls.settings);
  const unposted: string[] = [];

  const { data: sis, error: sErr } = await sb.from('sales_invoices').select('invoice_number, invoice_date, status, migrated_no_stock, opening_balance')
    .eq('company_id', companyId).eq('so_doc_no', soDocNo);
  if (sErr) return { ok: false, status: 'load_failed', reason: sErr.message };
  const issued = ((sis ?? []) as Array<{ invoice_number: string; invoice_date: string; status: string; migrated_no_stock?: boolean | null; opening_balance?: boolean | null }>)
    .filter((s) => !['DRAFT', 'CANCELLED'].includes(String(s.status).toUpperCase()) && !s.migrated_no_stock && !s.opening_balance && inLedger(s.invoice_date));
  if (issued.length > 0) {
    const { data: jes, error: jErr } = await sb.from('journal_entries').select('source_doc_no, reversed')
      .eq('company_id', companyId).eq('source_type', 'SI').in('source_doc_no', issued.map((s) => s.invoice_number));
    if (jErr) return { ok: false, status: 'load_failed', reason: jErr.message };
    const posted = new Set(((jes ?? []) as Array<{ source_doc_no: string; reversed: boolean | null }>).filter((j) => !j.reversed).map((j) => j.source_doc_no));
    unposted.push(...issued.filter((s) => !posted.has(s.invoice_number)).map((s) => s.invoice_number));
  }

  const { data: notes, error: nErr } = await sb.from('acc_credit_notes').select('note_number, note_date, status')
    .eq('company_id', companyId).eq('so_doc_no', soDocNo).eq('status', 'DRAFT');
  if (nErr) return { ok: false, status: 'load_failed', reason: nErr.message };
  unposted.push(...((notes ?? []) as Array<{ note_number: string; note_date: string }>).filter((n) => inLedger(n.note_date)).map((n) => n.note_number));

  if (unposted.length > 0) {
    return { ok: false, status: 'documents_unposted', reason: `${unposted.join(', ')} on ${soDocNo} ${unposted.length === 1 ? 'is' : 'are'} not posted yet. Post ${unposted.length === 1 ? 'it' : 'them'} first, then cancel.` };
  }
  return { ok: true };
}
