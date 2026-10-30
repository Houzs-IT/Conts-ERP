// ----------------------------------------------------------------------------
// Renovation completion % — for management only, never posted (finance, chew
// 30 Oct 2026; SOP 4.2.1; plan docs/superpowers/plans/2026-10-31-renovation-
// completion-dashboard.md Task 3). The books follow the invoices; this says how
// far the work really is, for the performance P&L and the project status table.
//
//   completion % = cost booked to date ÷ expected total cost, at most 99% until
//                  the contract is handed over (RENO_COMPLETED), then 100%;
//   earned       = completion × revised contract (the exact ratio, rounded to
//                  sen once: the SOP's October is 30,769.23, not 30,770.00);
//   difference   = invoiced − earned (positive: invoiced ahead of the work).
//
// Cost to date is the ledger's EXPENSE lines carrying the contract's project
// (posted entries dated on or before the date; a reversal's contra nets its
// original from the contra's date), plus — for a contract signed before the
// ledger start — the cost AutoCount booked before go-live (golive_cost_sen).
// Expected total cost is the cost of the contract's live lines, VOs included
// (spec section 8: kept simple; the HOD re-estimate comes later). Everything is
// computed on each read and stored nowhere.
// ----------------------------------------------------------------------------

import { paginateAll } from '../scm/lib/paginate-all';
import { RENO_LIVE_STATUSES } from '../scm/lib/renovation-so';

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
  soDocNo: string; projectId: number | null; asOf: string; status: string;
  revisedContractSen: number; expectedCostSen: number; costToDateSen: number; invoicedSen: number;
  differenceSen: number;
  goliveCostMissing: boolean;
}

const day = (v: unknown): string => String(v ?? '').slice(0, 10);
const fail = (what: string, e: { message?: string } | null | undefined): never => { throw new Error(`completion: ${what}: ${e?.message ?? 'failed'}`); };

async function all(q: (from: number, to: number) => any, what: string): Promise<Row[]> {
  const r = await paginateAll(q);
  if (r.error) fail(what, r.error as { message?: string });
  return (r.data ?? []) as Row[];
}

/** Each live renovation contract of the company signed on or before `asOf` (or only `soDocNos`), as at `asOf`. */
export async function contractCompletions(sb: Db, companyId: number, asOf: string, soDocNos?: string[]): Promise<ContractCompletion[]> {
  let cq = sb.from('reno_so_contracts').select('so_doc_no, project_id, doc_date, billed_before_golive_sen, golive_cost_sen').eq('company_id', companyId);
  if (soDocNos) cq = cq.in('so_doc_no', soDocNos);
  const { data: cRows, error: cErr } = await cq;
  if (cErr) fail('contracts', cErr);
  const signed = ((cRows ?? []) as Row[]).filter((c) => !c.doc_date || day(c.doc_date) <= asOf);
  if (signed.length === 0) return [];
  const docs = signed.map((c) => String(c.so_doc_no));

  const [{ data: soRows, error: soErr }, { data: set, error: setErr }] = await Promise.all([
    sb.from('mfg_sales_orders').select('doc_no, status, project_id').eq('company_id', companyId).in('doc_no', docs),
    sb.from('acc_company_settings').select('ledger_start_date').eq('company_id', companyId).maybeSingle(),
  ]);
  if (soErr) fail('orders', soErr);
  if (setErr) fail('settings', setErr);
  const orders = new Map(((soRows ?? []) as Row[]).map((o) => [String(o.doc_no), o]));
  const live = signed.filter((c) => (RENO_LIVE_STATUSES as readonly string[]).includes(String(orders.get(String(c.so_doc_no))?.status ?? '')));
  if (live.length === 0) return [];
  const liveDocs = live.map((c) => String(c.so_doc_no));
  const ledgerStart = day((set as Row | null)?.ledger_start_date) || null;
  const projectOf = (c: Row): number | null => {
    const p = c.project_id ?? orders.get(String(c.so_doc_no))?.project_id;
    return p == null ? null : Number(p);
  };
  const projects = [...new Set(live.map(projectOf).filter((p): p is number => p != null))];

  const [items, invoices, credits, negBills, costLines, expense] = await Promise.all([
    all((f, t) => sb.from('mfg_sales_order_items').select('id, doc_no, total_sen, line_cost_sen, cancelled, item_code, created_at')
      .eq('company_id', companyId).in('doc_no', liveDocs).order('id').range(f, t), 'contract lines'),
    all((f, t) => sb.from('sales_invoices').select('id, so_doc_no, invoice_date, total_sen, status')
      .eq('company_id', companyId).in('so_doc_no', liveDocs).order('id').range(f, t), 'invoices'),
    all((f, t) => sb.from('reno_contract_credits').select('so_doc_no, credit_note_id, amount_sen').in('so_doc_no', liveDocs).order('so_doc_no').range(f, t), 'contract credits'),
    all((f, t) => sb.from('reno_instalment_bills').select('so_doc_no, kind, amount_sen, invoice_date, credit_note_id')
      .in('so_doc_no', liveDocs).eq('kind', 'CREDIT_NOTE').order('so_doc_no').range(f, t), 'instalment credits'),
    projects.length
      ? all((f, t) => sb.from('journal_entry_lines').select('id, journal_entry_id, account_code, debit_sen, credit_sen, project_id')
        .eq('company_id', companyId).in('project_id', projects).order('id').range(f, t), 'cost lines')
      : Promise.resolve([] as Row[]),
    all((f, t) => sb.from('accounts').select('account_code').eq('company_id', companyId).eq('account_type', 'EXPENSE').order('account_code').range(f, t), 'accounts'),
  ]);

  const noteIds = [...new Set([...credits, ...negBills].map((r) => r.credit_note_id).filter(Boolean).map(String))];
  const jeIds = [...new Set(costLines.map((l) => String(l.journal_entry_id)))];
  const [notes, jes] = await Promise.all([
    noteIds.length ? all((f, t) => sb.from('acc_credit_notes').select('id, note_date, status').eq('company_id', companyId).in('id', noteIds).order('id').range(f, t), 'credit notes') : Promise.resolve([] as Row[]),
    jeIds.length ? all((f, t) => sb.from('journal_entries').select('id, entry_date, posted').eq('company_id', companyId).in('id', jeIds).order('id').range(f, t), 'journal entries') : Promise.resolve([] as Row[]),
  ]);
  const noteById = new Map(notes.map((n) => [String(n.id), n]));
  const liveNote = (id: unknown): Row | null => {
    const n = id ? noteById.get(String(id)) : null;
    return n && n.status !== 'CANCELLED' ? n : null;
  };
  const jeById = new Map(jes.map((j) => [String(j.id), j]));
  const expenseCodes = new Set(expense.map((a) => String(a.account_code)));

  const costByProject = new Map<number, number>();
  for (const l of costLines) {
    const je = jeById.get(String(l.journal_entry_id));
    if (!je || je.posted !== true || day(je.entry_date) > asOf || !expenseCodes.has(String(l.account_code))) continue;
    const p = Number(l.project_id);
    costByProject.set(p, (costByProject.get(p) ?? 0) + Number(l.debit_sen ?? 0) - Number(l.credit_sen ?? 0));
  }

  return live.map((c) => {
    const doc = String(c.so_doc_no);
    const status = String(orders.get(doc)?.status ?? '');
    const lines = items.filter((i) => String(i.doc_no) === doc && i.cancelled !== true && (!i.created_at || day(i.created_at) <= asOf));
    const revisedContractSen = lines.reduce((s, i) => s + Number(i.total_sen ?? 0), 0);
    const expectedCostSen = lines.reduce((s, i) => s + Number(i.line_cost_sen ?? 0), 0);
    const signedBefore = !!ledgerStart && !!c.doc_date && day(c.doc_date) < ledgerStart;
    const golive = c.golive_cost_sen == null ? 0 : Number(c.golive_cost_sen);
    const projectId = projectOf(c);
    const costToDateSen = (projectId != null ? costByProject.get(projectId) ?? 0 : 0) + golive;
    const invoicedSen = invoices
      .filter((i) => String(i.so_doc_no) === doc && !['DRAFT', 'CANCELLED'].includes(String(i.status)) && day(i.invoice_date) <= asOf)
      .reduce((s, i) => s + Number(i.total_sen ?? 0), 0)
      + Number(c.billed_before_golive_sen ?? 0)
      - credits.filter((r) => String(r.so_doc_no) === doc).reduce((s, r) => {
        const n = liveNote(r.credit_note_id);
        return n && day(n.note_date) <= asOf ? s + Number(r.amount_sen ?? 0) : s;
      }, 0)
      - negBills.filter((b) => String(b.so_doc_no) === doc && day(b.invoice_date) <= asOf && liveNote(b.credit_note_id))
        .reduce((s, b) => s - Number(b.amount_sen ?? 0), 0);
    const comp = completionOf({ revisedContractSen, expectedCostSen, costToDateSen, handedOver: status === 'RENO_COMPLETED' });
    return {
      soDocNo: doc, projectId, asOf, status, revisedContractSen, expectedCostSen, costToDateSen, invoicedSen,
      ...comp, differenceSen: invoicedSen - comp.earnedSen, goliveCostMissing: signedBefore && c.golive_cost_sen == null,
    };
  });
}
