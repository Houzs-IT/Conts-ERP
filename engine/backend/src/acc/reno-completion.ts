// ----------------------------------------------------------------------------
// Renovation completion % — for management only, never posted (finance, chew
// 30 Oct 2026; SOP 4.2.1; plan docs/superpowers/plans/2026-10-31-renovation-
// completion-dashboard.md Task 3). The books follow the invoices; this says how
// far the work really is, for the performance P&L and the project status table.
//
//   completion % = cost booked to date ÷ expected total cost, at most 99% until
//                  the project is handed over, then 100%;
//   earned       = completion × revised contract (the exact ratio, rounded to
//                  sen once: the SOP's October is 30,769.23, not 30,770.00);
//   difference   = invoiced − earned (positive: invoiced ahead of the work).
//
// Everything is as at a date, so a past month never changes when the contract
// moves on: a line counts from its own date (line_date, else the day it was
// keyed in Malaysia); handover from the project's handed_over_at; a cancelled
// contract is live until the day its advance was cleared (RCAN) and from then
// on has earned exactly what it kept (its net invoiced).
//
// Cost to date is the ledger's EXPENSE lines carrying the contract's project,
// counted the way the books count them (acc/reversal-pairs: posted, and neither
// side of a reversal), plus — for a contract signed before the ledger start —
// the cost AutoCount booked before go-live (golive_cost_sen). Expected total
// cost is the cost of the contract's live lines, VOs included, plus the changes
// finance or HOD made to it (reno_expected_cost_changes; plan 2026-11-02-
// renovation-expected-cost-review.md). A change is kept as an adjustment on top
// of the lines and counts from its own day: an earlier month never moves, and a
// later VO still adds its cost.
//
// The data is read once (loadRenovationData) and the figures are worked out in
// memory for any date or period (completionsAt, periodOf): the dashboard reads
// once for all its periods. Computed on each read, stored nowhere.
// ----------------------------------------------------------------------------

import { chunkIn, paginateAll } from '../scm/lib/paginate-all';
import { RENO_LIVE_STATUSES } from '../scm/lib/renovation-so';
import { countsInTheBooks } from './reversal-pairs';
import { CONTRACT_CANCELLED } from './reno-ledger';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped throughout the acc layer */
type Db = any;
type Row = Record<string, any>;

export interface CompletionInput { revisedContractSen: number; expectedCostSen: number; costToDateSen: number; handedOver: boolean }
export interface Completion { pctBp: number; earnedSen: number; overBudget: boolean; lossExpected: boolean }

export function completionOf(i: CompletionInput): Completion {
  const cap = i.handedOver ? 1 : 0.99;
  const ratio = i.handedOver ? 1 : i.expectedCostSen > 0 ? Math.min(Math.max(i.costToDateSen, 0) / i.expectedCostSen, cap) : 0;
  return {
    pctBp: Math.round(ratio * 10000),
    earnedSen: Math.round(i.revisedContractSen * ratio),
    overBudget: i.costToDateSen > i.expectedCostSen,
    lossExpected: i.expectedCostSen > i.revisedContractSen,
  };
}

export interface ContractCompletion extends Completion {
  soDocNo: string; projectId: number | null; asOf: string;
  /** As at the date: the order's status, or 'CANCELLED' once its advance was cleared. */
  status: string;
  revisedContractSen: number; expectedCostSen: number; costToDateSen: number; invoicedSen: number;
  /** The live lines' cost alone, before any change to the expected cost. */
  lineCostSen: number;
  /** Handed over (or closed by cancellation) by the date: the expected cost no longer matters. */
  handedOver: boolean;
  differenceSen: number;
  goliveCostMissing: boolean;
}

/* ── The data, read once ─────────────────────────────────────────────────── */

type Contract = {
  soDocNo: string; projectId: number | null; signedOn: string | null; status: string;
  billedBeforeGoLiveSen: number; goliveCostSen: number | null; handedOverOn: string | null; cancelledOn: string | null;
};
type Line = { doc: string; date: string; sen: number; costSen: number; cancelled: boolean };
type Dated = { doc: string; date: string; sen: number };
type CostLine = { projectId: number; account: string; date: string; sen: number };

export interface RenovationData {
  ledgerStart: string | null;
  contracts: Contract[];
  lines: Line[];
  /** Issued invoices (+), contract credits (−) and negative instalments (−), each on its own date. */
  invoiced: Dated[];
  costLines: CostLine[];
  /** Changes to the expected cost, each from its own day (effective_on). */
  adjustments: Dated[];
}

const day = (v: unknown): string => String(v ?? '').slice(0, 10);
/** A timestamp's day in Malaysia (UTC+8): a VO keyed at 07:00 on 1 Nov is November's. */
const mytDay = (ts: unknown): string => {
  const t = Date.parse(String(ts ?? ''));
  return Number.isFinite(t) ? new Date(t + 8 * 3_600_000).toISOString().slice(0, 10) : '';
};
const fail = (what: string, e: { message?: string } | null | undefined): never => { throw new Error(`completion: ${what}: ${e?.message ?? 'failed'}`); };

async function all(q: (from: number, to: number) => any, what: string): Promise<Row[]> {
  const r = await paginateAll(q);
  if (r.error) fail(what, r.error as { message?: string });
  return (r.data ?? []) as Row[];
}
/** An `in` read split to the URL budget (paginate-all chunkIn): a long list never fails the whole report. */
export async function inChunks<V extends string | number>(values: V[], q: (batch: V[], from: number, to: number) => any, what: string): Promise<Row[]> {
  if (values.length === 0) return [];
  const r = await chunkIn<Row, V>(values, q);
  if (r.error) fail(what, r.error);
  return r.data;
}

const CANCELLED = new Set(['CANCELLED', 'RENO_CANCELLED']);

/** Every renovation contract of the company (or only `soDocNos`) with what the figures need, in one pass of reads.
    `knownLedgerStart`: the ledger start when the caller has it already (undefined = read it). */
export async function loadRenovationData(sb: Db, companyId: number, soDocNos?: string[], knownLedgerStart?: string | null): Promise<RenovationData> {
  const contractRows = soDocNos
    ? await inChunks(soDocNos, (b, f, t) => sb.from('reno_so_contracts').select('so_doc_no, project_id, doc_date, billed_before_golive_sen, golive_cost_sen')
      .eq('company_id', companyId).in('so_doc_no', b).order('so_doc_no').range(f, t), 'contracts')
    : await all((f, t) => sb.from('reno_so_contracts').select('so_doc_no, project_id, doc_date, billed_before_golive_sen, golive_cost_sen')
      .eq('company_id', companyId).order('so_doc_no').range(f, t), 'contracts');
  let ledgerStart = knownLedgerStart === undefined ? null : knownLedgerStart;
  if (knownLedgerStart === undefined) {
    const { data: set, error: setErr } = await sb.from('acc_company_settings').select('ledger_start_date').eq('company_id', companyId).maybeSingle();
    if (setErr) fail('settings', setErr);
    ledgerStart = day((set as Row | null)?.ledger_start_date) || null;
  }
  if (contractRows.length === 0) return { ledgerStart, contracts: [], lines: [], invoiced: [], costLines: [], adjustments: [] };
  const docs = contractRows.map((c) => String(c.so_doc_no));

  const [orders, items, invoices, credits, negBills, rcan, expense, changes] = await Promise.all([
    inChunks(docs, (b, f, t) => sb.from('mfg_sales_orders').select('doc_no, status, project_id').eq('company_id', companyId).in('doc_no', b).order('doc_no').range(f, t), 'orders'),
    inChunks(docs, (b, f, t) => sb.from('mfg_sales_order_items').select('id, doc_no, total_sen, line_cost_sen, cancelled, line_date, created_at')
      .eq('company_id', companyId).in('doc_no', b).order('id').range(f, t), 'contract lines'),
    inChunks(docs, (b, f, t) => sb.from('sales_invoices').select('id, so_doc_no, invoice_date, total_sen, status')
      .eq('company_id', companyId).in('so_doc_no', b).order('id').range(f, t), 'invoices'),
    inChunks(docs, (b, f, t) => sb.from('reno_contract_credits').select('so_doc_no, credit_note_id, amount_sen').in('so_doc_no', b).order('so_doc_no').range(f, t), 'contract credits'),
    inChunks(docs, (b, f, t) => sb.from('reno_instalment_bills').select('so_doc_no, kind, amount_sen, invoice_date, credit_note_id')
      .in('so_doc_no', b).eq('kind', 'CREDIT_NOTE').order('so_doc_no').range(f, t), 'instalment credits'),
    all((f, t) => sb.from('journal_entries').select('id, source_doc_no, entry_date, posted, reversed, reversed_by_je')
      .eq('company_id', companyId).eq('source_type', CONTRACT_CANCELLED).order('id').range(f, t), 'contract cancellations'),
    all((f, t) => sb.from('accounts').select('account_code').eq('company_id', companyId).eq('account_type', 'EXPENSE').order('account_code').range(f, t), 'accounts'),
    inChunks(docs, (b, f, t) => sb.from('reno_expected_cost_changes').select('id, so_doc_no, effective_on, adjustment_sen')
      .eq('company_id', companyId).in('so_doc_no', b).order('id').range(f, t), 'expected cost changes'),
  ]);

  const orderOf = new Map(orders.map((o) => [String(o.doc_no), o]));
  const projectOf = (c: Row): number | null => {
    const p = c.project_id ?? orderOf.get(String(c.so_doc_no))?.project_id;
    return p == null ? null : Number(p);
  };
  const projectIds = [...new Set(contractRows.map(projectOf).filter((p): p is number => p != null))];
  const noteIds = [...new Set([...credits, ...negBills].map((r) => r.credit_note_id).filter(Boolean).map(String))];

  const [projects, notes, costRows] = await Promise.all([
    inChunks(projectIds, (b, f, t) => sb.schema('public').from('projects').select('id, handed_over_at').eq('company_id', companyId).in('id', b).order('id').range(f, t), 'projects'),
    inChunks(noteIds, (b, f, t) => sb.from('acc_credit_notes').select('id, note_date, status').eq('company_id', companyId).in('id', b).order('id').range(f, t), 'credit notes'),
    inChunks(projectIds, (b, f, t) => sb.from('journal_entry_lines').select('id, journal_entry_id, account_code, debit_sen, credit_sen, project_id')
      .eq('company_id', companyId).in('project_id', b).order('id').range(f, t), 'cost lines'),
  ]);
  const jeIds = [...new Set(costRows.map((l) => String(l.journal_entry_id)))];
  const jes = await inChunks(jeIds, (b, f, t) => sb.from('journal_entries').select('id, entry_date, posted, reversed, reversed_by_je')
    .eq('company_id', companyId).in('id', b).order('id').range(f, t), 'journal entries');

  /* The day a cancelled contract's advance was cleared: its first RCAN that the books count. */
  const cancelledOn = new Map<string, string>();
  for (const j of rcan) {
    if (!countsInTheBooks(j)) continue;
    const doc = docs.find((d) => j.source_doc_no === d || String(j.source_doc_no).startsWith(`${d}-`));
    if (!doc) continue;
    const at = cancelledOn.get(doc);
    if (!at || day(j.entry_date) < at) cancelledOn.set(doc, day(j.entry_date));
  }
  const handedOn = new Map(projects.map((p) => [Number(p.id), p.handed_over_at ? mytDay(p.handed_over_at) : null]));
  const noteOf = new Map(notes.map((n) => [String(n.id), n]));
  const liveNote = (id: unknown): Row | null => {
    const n = id ? noteOf.get(String(id)) : null;
    return n && n.status !== 'CANCELLED' ? n : null;
  };
  const jeOf = new Map(jes.map((j) => [String(j.id), j]));
  const expenseCodes = new Set(expense.map((a) => String(a.account_code)));

  const contracts: Contract[] = contractRows.map((c) => {
    const doc = String(c.so_doc_no);
    const projectId = projectOf(c);
    return {
      soDocNo: doc, projectId, signedOn: c.doc_date ? day(c.doc_date) : null, status: String(orderOf.get(doc)?.status ?? ''),
      billedBeforeGoLiveSen: Number(c.billed_before_golive_sen ?? 0), goliveCostSen: c.golive_cost_sen == null ? null : Number(c.golive_cost_sen),
      handedOverOn: projectId != null ? handedOn.get(projectId) ?? null : null, cancelledOn: cancelledOn.get(doc) ?? null,
    };
  });
  const lines: Line[] = items.map((i) => ({
    doc: String(i.doc_no), date: i.line_date ? day(i.line_date) : mytDay(i.created_at),
    sen: Number(i.total_sen ?? 0), costSen: Number(i.line_cost_sen ?? 0), cancelled: i.cancelled === true,
  }));
  const invoiced: Dated[] = [
    ...invoices.filter((i) => !['DRAFT', 'CANCELLED'].includes(String(i.status))).map((i) => ({ doc: String(i.so_doc_no), date: day(i.invoice_date), sen: Number(i.total_sen ?? 0) })),
    ...credits.flatMap((r) => { const n = liveNote(r.credit_note_id); return n ? [{ doc: String(r.so_doc_no), date: day(n.note_date), sen: -Number(r.amount_sen ?? 0) }] : []; }),
    /* A negative instalment's amount is negative already. */
    ...negBills.filter((b) => liveNote(b.credit_note_id)).map((b) => ({ doc: String(b.so_doc_no), date: day(b.invoice_date), sen: Number(b.amount_sen ?? 0) })),
  ];
  const costLines: CostLine[] = costRows.flatMap((l) => {
    const je = jeOf.get(String(l.journal_entry_id));
    if (!je || !countsInTheBooks(je) || !expenseCodes.has(String(l.account_code))) return [];
    return [{ projectId: Number(l.project_id), account: String(l.account_code), date: day(je.entry_date), sen: Number(l.debit_sen ?? 0) - Number(l.credit_sen ?? 0) }];
  });
  const adjustments: Dated[] = changes.map((x) => ({ doc: String(x.so_doc_no), date: day(x.effective_on), sen: Number(x.adjustment_sen ?? 0) }));
  return { ledgerStart, contracts, lines, invoiced, costLines, adjustments };
}

/* ── The figures, in memory ──────────────────────────────────────────────── */

/** Each contract signed by `asOf` that is live then (or cancelled by then: it keeps what it invoiced), as at `asOf`. */
export function completionsAt(d: RenovationData, asOf: string): ContractCompletion[] {
  const out: ContractCompletion[] = [];
  for (const c of d.contracts) {
    if (c.signedOn && c.signedOn > asOf) continue;
    const isCancelled = CANCELLED.has(c.status);
    if (isCancelled && !c.cancelledOn) continue;                        // cancelled with nothing cleared: never counted
    if (!isCancelled && !(RENO_LIVE_STATUSES as readonly string[]).includes(c.status)) continue;
    const closed = isCancelled && !!c.cancelledOn && c.cancelledOn <= asOf;
    const mine = d.lines.filter((l) => l.doc === c.soDocNo && !l.cancelled && l.date <= asOf);
    const lineCostSen = mine.reduce((s, l) => s + l.costSen, 0);
    const expectedCostSen = lineCostSen + d.adjustments.filter((x) => x.doc === c.soDocNo && x.date <= asOf).reduce((s, x) => s + x.sen, 0);
    const invoicedSen = d.invoiced.filter((x) => x.doc === c.soDocNo && x.date <= asOf).reduce((s, x) => s + x.sen, 0) + c.billedBeforeGoLiveSen;
    const revisedContractSen = closed ? invoicedSen : mine.reduce((s, l) => s + l.sen, 0);
    const costToDateSen = (c.projectId != null
      ? d.costLines.filter((l) => l.projectId === c.projectId && l.date <= asOf).reduce((s, l) => s + l.sen, 0) : 0)
      + (c.goliveCostSen ?? 0);
    const handedOver = closed || (c.handedOverOn != null ? c.handedOverOn <= asOf : c.status === 'RENO_COMPLETED');
    const comp = completionOf({ revisedContractSen, expectedCostSen, costToDateSen, handedOver });
    const signedBefore = !!d.ledgerStart && !!c.signedOn && c.signedOn < d.ledgerStart;
    out.push({
      soDocNo: c.soDocNo, projectId: c.projectId, asOf, status: closed ? 'CANCELLED' : isCancelled ? 'RENO_IN_PROGRESS' : c.status,
      revisedContractSen, expectedCostSen, costToDateSen, invoicedSen, lineCostSen, handedOver,
      ...comp, differenceSen: invoicedSen - comp.earnedSen, goliveCostMissing: signedBefore && c.goliveCostSen == null,
    });
  }
  return out;
}

/** Each live renovation contract of the company signed on or before `asOf` (or only `soDocNos`), as at `asOf`. */
export async function contractCompletions(sb: Db, companyId: number, asOf: string, soDocNos?: string[]): Promise<ContractCompletion[]> {
  return completionsAt(await loadRenovationData(sb, companyId, soDocNos), asOf);
}

export interface RenovationPeriod {
  /** Σ over contracts of earned at `to` − earned the day before `from`. */
  earnedSen: number;
  /** The same change in what was invoiced (what the books show). */
  invoicedSen: number;
  contracts: number;
  /** The period's booked cost on the contracts' projects, by EXPENSE account: the performance P&L takes it out of the
      expenses as booked and shows it as the renovation cost. */
  costByAccount: Record<string, number>;
}

const dayBefore = (d: string): string => new Date(new Date(`${d}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);

/** Renovation for the performance P&L over [from, to] (Task 5), from data read once. Never posted. */
export function periodOf(d: RenovationData, from: string, to: string): RenovationPeriod {
  const atEnd = completionsAt(d, to);
  const start = new Map(completionsAt(d, dayBefore(from)).map((c) => [c.soDocNo, c]));
  let earnedSen = 0;
  let invoicedSen = 0;
  for (const c of atEnd) {
    const s = start.get(c.soDocNo);
    earnedSen += c.earnedSen - (s?.earnedSen ?? 0);
    invoicedSen += c.invoicedSen - (s?.invoicedSen ?? 0);
  }
  const projects = new Set(atEnd.map((c) => c.projectId).filter((p): p is number => p != null));
  const costByAccount: Record<string, number> = {};
  for (const l of d.costLines) {
    if (!projects.has(l.projectId) || l.date < from || l.date > to) continue;
    costByAccount[l.account] = (costByAccount[l.account] ?? 0) + l.sen;
  }
  for (const [k, v] of Object.entries(costByAccount)) if (v === 0) delete costByAccount[k];
  return { earnedSen, invoicedSen, contracts: atEnd.filter((c) => c.status !== 'CANCELLED').length, costByAccount };
}

export async function renovationForPeriod(sb: Db, companyId: number, from: string, to: string): Promise<RenovationPeriod> {
  return periodOf(await loadRenovationData(sb, companyId), from, to);
}
