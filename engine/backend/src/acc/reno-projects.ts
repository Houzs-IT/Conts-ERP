// ----------------------------------------------------------------------------
// Renovation project status table (finance, chew 23 Oct 2026; SOP 4.2.3; plan
// docs/superpowers/plans/2026-10-31-renovation-completion-dashboard.md Task 6).
// One row per live renovation contract as at a date: the work (completion %,
// earned), the money (received, collected %, next instalment, the gaps between
// instalments), the cost (expected, spent, ordered but not billed, owed to
// suppliers) and the margins, with the alerts as plain flags. Management only:
// nothing here posts. Completion comes from acc/reno-completion; the project
// limit is read per row by the screen (the existing limit route), not here.
//
// Reads go in parallel per source for all contracts at once, never per row.
// ----------------------------------------------------------------------------

import { paginateAll } from '../scm/lib/paginate-all';
import { nextInstalmentAmount } from '../scm/shared/renovation-money';
import { confirmedPaymentIds } from './receipts';
import { contractCompletions, type ContractCompletion } from './reno-completion';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped throughout the acc layer */
type Db = any;
type Row = Record<string, any>;

/** Completion this many points ahead of collection is flagged (SOP 4.2.3: 做在钱前面). */
export const WORK_AHEAD_BP = 2000;

export interface RenoProjectRow {
  soDocNo: string; projectId: number | null; projectName: string; customerCode: string | null; customerName: string;
  salesperson: string | null; brand: string | null; kind: 'RENOVATION' | 'INHOUSE_RENOVATION'; status: string; stage: string | null;
  handoverDate: string | null; delayed: boolean;
  contractSen: number; voSen: number; revisedContractSen: number;
  receivedSen: number; outstandingSen: number; collectedBp: number | null;
  nextInstalment: { seq: number; label: string; amountSen: number; trigger: string } | null;
  gapsByInvoiceDays: Array<number | null>; gapsByPaymentDays: Array<number | null>;
  invoicedSen: number; advanceLeftSen: number; completionBp: number; earnedSen: number; differenceSen: number;
  expectedCostSen: number; costSpentSen: number; orderedNotBilledSen: number; remainingCostSen: number; owedToSuppliersSen: number;
  overBudget: boolean; lossExpected: boolean; goliveCostMissing: boolean;
  expectedGpBp: number | null; gpToDateBp: number | null;
  workAheadOfMoney: boolean;
}

const day = (v: unknown): string => String(v ?? '').slice(0, 10);
const bp = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part * 10000) / whole) : null);
const daysBetween = (a: string | null, b: string | null): number | null =>
  a && b ? Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) : null;
const fail = (what: string, e: { message?: string } | null | undefined): never => { throw new Error(`project status: ${what}: ${e?.message ?? 'failed'}`); };

async function all(q: (from: number, to: number) => any, what: string): Promise<Row[]> {
  const r = await paginateAll(q);
  if (r.error) fail(what, r.error as { message?: string });
  return (r.data ?? []) as Row[];
}

const BRAND_OF_PARENT: Record<string, string> = { '480': 'Dream Crafter', '481': 'The Conts' };

/** The gaps, in days, between consecutive dates (1→2, 2→3, 3→4). */
const gaps = (dates: Array<string | null>): Array<number | null> => [1, 2, 3].map((i) => daysBetween(dates[i - 1] ?? null, dates[i] ?? null));

export async function renoProjectRows(sb: Db, companyId: number, asOf: string): Promise<RenoProjectRow[]> {
  const comps = await contractCompletions(sb, companyId, asOf);
  if (comps.length === 0) return [];
  const docs = comps.map((c) => c.soDocNo);
  const projectIds = [...new Set(comps.map((c) => c.projectId).filter((p): p is number => p != null))];

  const [contracts, orders, projects, instalments, bills, soPays, invoices, pos] = await Promise.all([
    all((f, t) => sb.from('reno_so_contracts').select('so_doc_no, original_contract_sen, advance_account_code, customer_name')
      .eq('company_id', companyId).in('so_doc_no', docs).order('so_doc_no').range(f, t), 'contracts'),
    all((f, t) => sb.from('mfg_sales_orders').select('doc_no, debtor_code, debtor_name, agent').eq('company_id', companyId).in('doc_no', docs).order('doc_no').range(f, t), 'orders'),
    projectIds.length
      ? all((f, t) => sb.schema('public').from('projects').select('id, code, name, reno_stage, planned_handover_date, salesperson_name')
        .eq('company_id', companyId).in('id', projectIds).order('id').range(f, t), 'projects')
      : Promise.resolve([] as Row[]),
    all((f, t) => sb.from('reno_doc_instalments').select('so_doc_no, seq, label, pct_bp, trigger').in('so_doc_no', docs).order('so_doc_no').order('seq').range(f, t), 'instalments'),
    all((f, t) => sb.from('reno_instalment_bills').select('so_doc_no, seq, kind, amount_sen, invoice_date').in('so_doc_no', docs).order('so_doc_no').order('seq').range(f, t), 'bills'),
    all((f, t) => sb.from('mfg_sales_order_payments').select('id, so_doc_no, paid_at, amount_sen').eq('company_id', companyId).in('so_doc_no', docs).order('id').range(f, t), 'order payments'),
    all((f, t) => sb.from('sales_invoices').select('id, so_doc_no, status').eq('company_id', companyId).in('so_doc_no', docs).order('id').range(f, t), 'invoices'),
    projectIds.length
      ? all((f, t) => sb.from('purchase_orders').select('id, project_id, status, total_sen').eq('company_id', companyId).in('project_id', projectIds).order('id').range(f, t), 'purchase orders')
      : Promise.resolve([] as Row[]),
  ]);

  const liveSi = invoices.filter((i) => !['DRAFT', 'CANCELLED', 'VOID'].includes(String(i.status).toUpperCase()));
  const siDoc = new Map(liveSi.map((i) => [String(i.id), String(i.so_doc_no)]));
  const livePos = pos.filter((p) => !['CANCELLED', 'DRAFT'].includes(String(p.status).toUpperCase()));
  const poIds = livePos.map((p) => String(p.id));
  const [siPays, pis, apLines] = await Promise.all([
    liveSi.length
      ? all((f, t) => sb.from('sales_invoice_payments').select('id, sales_invoice_id, paid_at, amount_sen').eq('company_id', companyId)
        .in('sales_invoice_id', liveSi.map((i) => String(i.id))).order('id').range(f, t), 'invoice payments')
      : Promise.resolve([] as Row[]),
    poIds.length
      ? all((f, t) => sb.from('purchase_invoices').select('id, purchase_order_id, status, total_sen, paid_sen').eq('company_id', companyId).in('purchase_order_id', poIds).order('id').range(f, t), 'purchase invoices')
      : Promise.resolve([] as Row[]),
    projectIds.length
      ? all((f, t) => sb.from('ap_invoice_lines').select('invoice_id, project_id, amount_sen').eq('company_id', companyId).in('project_id', projectIds).order('invoice_id').range(f, t), 'AP invoice lines')
      : Promise.resolve([] as Row[]),
  ]);
  const apIds = [...new Set(apLines.map((l) => String(l.invoice_id)))];
  const [soOk, siOk, aps] = await Promise.all([
    confirmedPaymentIds(sb, companyId, 'SOPAY', soPays.map((p) => String(p.id))),
    confirmedPaymentIds(sb, companyId, 'SIPAY', siPays.map((p) => String(p.id))),
    apIds.length
      ? all((f, t) => sb.from('ap_invoices').select('id, status, total_sen, paid_sen').eq('company_id', companyId).in('id', apIds).order('id').range(f, t), 'AP invoices')
      : Promise.resolve([] as Row[]),
  ]);
  if (!soOk.ok) fail('receipts', { message: soOk.reason });
  if (!siOk.ok) fail('receipts', { message: siOk.reason });

  /* Confirmed money per contract, dated (SOP 4.2: a payment counts once finance confirms it). */
  const paidBy = new Map<string, Array<{ date: string; sen: number }>>();
  const addPay = (doc: string | undefined, p: Row) => {
    if (!doc || day(p.paid_at) > asOf) return;
    const at = paidBy.get(doc) ?? [];
    at.push({ date: day(p.paid_at), sen: Number(p.amount_sen ?? 0) });
    paidBy.set(doc, at);
  };
  for (const p of soPays) if ((soOk as { ids: Set<string> }).ids.has(String(p.id))) addPay(String(p.so_doc_no), p);
  for (const p of siPays) if ((siOk as { ids: Set<string> }).ids.has(String(p.id))) addPay(siDoc.get(String(p.sales_invoice_id)), p);

  /* Supplier side per project. */
  const piByPo = new Map<string, Row[]>();
  for (const pi of pis.filter((x) => String(x.status).toUpperCase() !== 'CANCELLED')) {
    const at = piByPo.get(String(pi.purchase_order_id)) ?? [];
    at.push(pi);
    piByPo.set(String(pi.purchase_order_id), at);
  }
  const orderedNotBilled = new Map<number, number>();
  const owed = new Map<number, number>();
  const add = (m: Map<number, number>, k: number, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const po of livePos) {
    const p = Number(po.project_id);
    const billed = (piByPo.get(String(po.id)) ?? []).reduce((s, pi) => s + Number(pi.total_sen ?? 0), 0);
    add(orderedNotBilled, p, Math.max(Number(po.total_sen ?? 0) - billed, 0));
    for (const pi of piByPo.get(String(po.id)) ?? []) add(owed, p, Math.max(Number(pi.total_sen ?? 0) - Number(pi.paid_sen ?? 0), 0));
  }
  const apById = new Map(aps.map((a) => [String(a.id), a]));
  for (const l of apLines) {
    const ap = apById.get(String(l.invoice_id));
    if (!ap || ['CANCELLED', 'DRAFT'].includes(String(ap.status).toUpperCase())) continue;
    const total = Number(ap.total_sen ?? 0);
    const outstanding = Math.max(total - Number(ap.paid_sen ?? 0), 0);
    if (total > 0) add(owed, Number(l.project_id), Math.round((outstanding * Number(l.amount_sen ?? 0)) / total));
  }

  const contractOf = new Map(contracts.map((c) => [String(c.so_doc_no), c]));
  const orderOf = new Map(orders.map((o) => [String(o.doc_no), o]));
  const projectOf = new Map(projects.map((p) => [Number(p.id), p]));

  return comps.map((c: ContractCompletion): RenoProjectRow => {
    const k = contractOf.get(c.soDocNo) ?? {};
    const o = orderOf.get(c.soDocNo) ?? {};
    const p = c.projectId != null ? projectOf.get(c.projectId) : undefined;
    const contractSen = Number(k.original_contract_sen ?? c.revisedContractSen);
    const pays = (paidBy.get(c.soDocNo) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    const receivedSen = pays.reduce((s, x) => s + x.sen, 0);
    const myInst = instalments.filter((i) => String(i.so_doc_no) === c.soDocNo).sort((a, b) => Number(a.seq) - Number(b.seq));
    const myBills = bills.filter((b) => String(b.so_doc_no) === c.soDocNo && day(b.invoice_date) <= asOf).sort((a, b) => Number(a.seq) - Number(b.seq));
    const billedSeqs = new Set(myBills.map((b) => Number(b.seq)));
    const next = myInst.find((i) => !billedSeqs.has(Number(i.seq)));
    let nextInstalment: RenoProjectRow['nextInstalment'] = null;
    if (next) {
      const n = nextInstalmentAmount({
        instalments: myInst.map((i) => ({ seq: Number(i.seq), pctBp: Number(i.pct_bp) })), seq: Number(next.seq),
        revisedContractSen: c.revisedContractSen, billedSen: c.invoicedSen,
      });
      nextInstalment = { seq: Number(next.seq), label: String(next.label ?? ''), amountSen: n.amountSen, trigger: String(next.trigger ?? '') };
    }
    /* Gaps: by invoice date between instalment invoices; by payment date, the day confirmed money first covered each. */
    const invoiceDates = myBills.filter((b) => b.kind === 'INVOICE').map((b) => day(b.invoice_date));
    let cumBilled = 0;
    const coveredDates = myBills.filter((b) => b.kind === 'INVOICE').map((b) => {
      cumBilled += Number(b.amount_sen ?? 0);
      let cum = 0;
      for (const x of pays) { cum += x.sen; if (cum >= cumBilled) return x.date; }
      return null;
    });
    const handover = p?.planned_handover_date ? day(p.planned_handover_date) : null;
    const costSpentSen = c.costToDateSen;
    const collectedBp = bp(receivedSen, c.revisedContractSen);
    const parent = String(k.advance_account_code ?? '').slice(0, 3);
    return {
      soDocNo: c.soDocNo, projectId: c.projectId, projectName: String(p?.name ?? k.customer_name ?? c.soDocNo),
      customerCode: o.debtor_code ?? null, customerName: String(o.debtor_name ?? k.customer_name ?? ''),
      salesperson: p?.salesperson_name ?? o.agent ?? null, brand: BRAND_OF_PARENT[parent] ?? null,
      kind: String(o.debtor_code ?? '').startsWith('302-') ? 'INHOUSE_RENOVATION' : 'RENOVATION',
      status: c.status, stage: p?.reno_stage ?? null,
      handoverDate: handover, delayed: !!handover && handover < asOf && c.status !== 'RENO_COMPLETED',
      contractSen, voSen: c.revisedContractSen - contractSen, revisedContractSen: c.revisedContractSen,
      receivedSen, outstandingSen: c.revisedContractSen - receivedSen, collectedBp,
      nextInstalment,
      gapsByInvoiceDays: gaps(invoiceDates), gapsByPaymentDays: gaps(coveredDates),
      invoicedSen: c.invoicedSen, advanceLeftSen: c.revisedContractSen - c.invoicedSen,
      completionBp: c.pctBp, earnedSen: c.earnedSen, differenceSen: c.differenceSen,
      expectedCostSen: c.expectedCostSen, costSpentSen,
      orderedNotBilledSen: c.projectId != null ? orderedNotBilled.get(c.projectId) ?? 0 : 0,
      remainingCostSen: Math.max(c.expectedCostSen - costSpentSen, 0),
      owedToSuppliersSen: c.projectId != null ? owed.get(c.projectId) ?? 0 : 0,
      overBudget: c.overBudget, lossExpected: c.lossExpected, goliveCostMissing: c.goliveCostMissing,
      expectedGpBp: bp(c.revisedContractSen - c.expectedCostSen, c.revisedContractSen),
      gpToDateBp: bp(c.invoicedSen - costSpentSen, c.invoicedSen),
      workAheadOfMoney: c.pctBp - (collectedBp ?? 0) >= WORK_AHEAD_BP,
    };
  });
}
