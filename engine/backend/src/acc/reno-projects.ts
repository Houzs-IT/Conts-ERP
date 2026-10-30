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
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { todayMyt } from '../scm/lib/my-time';
import { nextInstalmentAmount } from '../scm/shared/renovation-money';
import { confirmedPaymentIds } from './receipts';
import { contractCompletions, inChunks, type ContractCompletion } from './reno-completion';
import { countsInTheBooks } from './reversal-pairs';

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
  /* A contract cancelled by the date is no longer a project to follow. */
  const comps = (await contractCompletions(sb, companyId, asOf)).filter((c) => c.status !== 'CANCELLED');
  if (comps.length === 0) return [];
  const docs = comps.map((c) => c.soDocNo);
  const projectIds = [...new Set(comps.map((c) => c.projectId).filter((p): p is number => p != null))];

  const [contracts, orders, projects, instalments, bills, soPays, invoices, pos] = await Promise.all([
    inChunks(docs, (b, f, t) => sb.from('reno_so_contracts').select('so_doc_no, original_contract_sen, advance_account_code, customer_name')
      .eq('company_id', companyId).in('so_doc_no', b).order('so_doc_no').range(f, t), 'contracts'),
    inChunks(docs, (b, f, t) => sb.from('mfg_sales_orders').select('doc_no, debtor_code, debtor_name, agent').eq('company_id', companyId).in('doc_no', b).order('doc_no').range(f, t), 'orders'),
    inChunks(projectIds, (b, f, t) => sb.schema('public').from('projects').select('id, code, name, reno_stage, planned_handover_date, salesperson_name')
      .eq('company_id', companyId).in('id', b).order('id').range(f, t), 'projects'),
    inChunks(docs, (b, f, t) => sb.from('reno_doc_instalments').select('so_doc_no, seq, label, pct_bp, trigger').in('so_doc_no', b).order('so_doc_no').order('seq').range(f, t), 'instalments'),
    inChunks(docs, (b, f, t) => sb.from('reno_instalment_bills').select('so_doc_no, seq, kind, amount_sen, invoice_date').in('so_doc_no', b).order('so_doc_no').order('seq').range(f, t), 'bills'),
    inChunks(docs, (b, f, t) => sb.from('mfg_sales_order_payments').select('id, so_doc_no, paid_at, amount_sen').eq('company_id', companyId).in('so_doc_no', b).order('id').range(f, t), 'order payments'),
    inChunks(docs, (b, f, t) => sb.from('sales_invoices').select('id, so_doc_no, status').eq('company_id', companyId).in('so_doc_no', b).order('id').range(f, t), 'invoices'),
    inChunks(projectIds, (b, f, t) => sb.from('purchase_orders').select('id, project_id, status, total_sen, po_date').eq('company_id', companyId).in('project_id', b).order('id').range(f, t), 'purchase orders'),
  ]);

  const liveSi = invoices.filter((i) => !['DRAFT', 'CANCELLED', 'VOID'].includes(String(i.status).toUpperCase()));
  const siDoc = new Map(liveSi.map((i) => [String(i.id), String(i.so_doc_no)]));
  /* As at the date: a PO raised by then, not drafted or cancelled. */
  const livePos = pos.filter((p) => !['CANCELLED', 'DRAFT'].includes(String(p.status).toUpperCase()) && (!p.po_date || day(p.po_date) <= asOf));
  const poIds = livePos.map((p) => String(p.id));
  const advanceCodes = [...new Set(contracts.map((c) => String(c.advance_account_code ?? '').trim()).filter(Boolean))];
  const [siPays, pis, apLines, advLines] = await Promise.all([
    inChunks(liveSi.map((i) => String(i.id)), (b, f, t) => sb.from('sales_invoice_payments').select('id, sales_invoice_id, paid_at, amount_sen').eq('company_id', companyId)
      .in('sales_invoice_id', b).order('id').range(f, t), 'invoice payments'),
    inChunks(poIds, (b, f, t) => sb.from('purchase_invoices').select('id, purchase_order_id, status, total_sen, invoice_date').eq('company_id', companyId).in('purchase_order_id', b).order('id').range(f, t), 'purchase invoices'),
    inChunks(projectIds, (b, f, t) => sb.from('ap_invoice_lines').select('invoice_id, project_id, amount_sen').eq('company_id', companyId).in('project_id', b).order('invoice_id').range(f, t), 'AP invoice lines'),
    inChunks(advanceCodes, (b, f, t) => sb.from('journal_entry_lines').select('id, journal_entry_id, account_code, debit_sen, credit_sen').eq('company_id', companyId).in('account_code', b).order('id').range(f, t), 'advance lines'),
  ]);
  const apIds = [...new Set(apLines.map((l) => String(l.invoice_id)))];
  /* As at the date: bills dated by then and posted (a draft is not owed yet). */
  const livePis = pis.filter((x) => !['CANCELLED', 'DRAFT'].includes(String(x.status).toUpperCase()) && day(x.invoice_date) <= asOf);
  const [soOk, siOk, aps, advJes] = await Promise.all([
    confirmedPaymentIds(sb, companyId, 'SOPAY', soPays.map((p) => String(p.id))),
    confirmedPaymentIds(sb, companyId, 'SIPAY', siPays.map((p) => String(p.id))),
    inChunks(apIds, (b, f, t) => sb.from('ap_invoices').select('id, status, total_sen, invoice_date').eq('company_id', companyId).in('id', b).order('id').range(f, t), 'AP invoices'),
    inChunks([...new Set(advLines.map((l) => String(l.journal_entry_id)))], (b, f, t) => sb.from('journal_entries').select('id, entry_date, posted, reversed, reversed_by_je')
      .eq('company_id', companyId).in('id', b).order('id').range(f, t), 'advance entries'),
  ]);
  if (!soOk.ok) fail('receipts', { message: soOk.reason });
  if (!siOk.ok) fail('receipts', { message: siOk.reason });
  const liveAps = aps.filter((a) => !['CANCELLED', 'DRAFT'].includes(String(a.status).toUpperCase()) && day(a.invoice_date) <= asOf);

  /* What was paid on each bill by the date: posted vouchers dated by then (paid_sen is today's figure). */
  const [piAllocs, apAllocs] = await Promise.all([
    inChunks(livePis.map((p) => String(p.id)), (b, f, t) => sb.from('pv_allocations').select('pv_id, pi_id, ap_invoice_id, amount_sen, applied_sen').eq('company_id', companyId).in('pi_id', b).order('pv_id').range(f, t), 'PI payments'),
    inChunks(liveAps.map((a) => String(a.id)), (b, f, t) => sb.from('pv_allocations').select('pv_id, pi_id, ap_invoice_id, amount_sen, applied_sen').eq('company_id', companyId).in('ap_invoice_id', b).order('pv_id').range(f, t), 'AP payments'),
  ]);
  const pvs = await inChunks([...new Set([...piAllocs, ...apAllocs].map((a) => String(a.pv_id)))], (b, f, t) => sb.from('payment_vouchers').select('id, status, voucher_date')
    .eq('company_id', companyId).in('id', b).order('id').range(f, t), 'payment vouchers');
  const pvPaidBy = new Map(pvs.filter((v) => String(v.status).toUpperCase() === 'POSTED' && day(v.voucher_date) <= asOf).map((v) => [String(v.id), true]));
  const paidOn = (allocs: Row[], key: 'pi_id' | 'ap_invoice_id') => {
    const m = new Map<string, number>();
    for (const a of allocs) {
      if (!pvPaidBy.has(String(a.pv_id)) || !a[key]) continue;
      m.set(String(a[key]), (m.get(String(a[key])) ?? 0) + Number(a.applied_sen ?? a.amount_sen ?? 0));
    }
    return m;
  };
  const piPaid = paidOn(piAllocs, 'pi_id');
  const apPaid = paidOn(apAllocs, 'ap_invoice_id');

  /* The advance sub-account's balance as at the date (SOP 4.2.3 还没转): credit − debit, as the books count it. */
  const advJeOf = new Map(advJes.map((j) => [String(j.id), j]));
  const advanceLeft = new Map<string, number>();
  for (const l of advLines) {
    const je = advJeOf.get(String(l.journal_entry_id));
    if (!je || !countsInTheBooks(je) || day(je.entry_date) > asOf) continue;
    advanceLeft.set(String(l.account_code), (advanceLeft.get(String(l.account_code)) ?? 0) + Number(l.credit_sen ?? 0) - Number(l.debit_sen ?? 0));
  }

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

  /* Supplier side per project, as at the date. */
  const piByPo = new Map<string, Row[]>();
  for (const pi of livePis) {
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
    for (const pi of piByPo.get(String(po.id)) ?? []) add(owed, p, Math.max(Number(pi.total_sen ?? 0) - (piPaid.get(String(pi.id)) ?? 0), 0));
  }
  const apById = new Map(liveAps.map((a) => [String(a.id), a]));
  for (const l of apLines) {
    const ap = apById.get(String(l.invoice_id));
    if (!ap) continue;
    const total = Number(ap.total_sen ?? 0);
    const outstanding = Math.max(total - (apPaid.get(String(ap.id)) ?? 0), 0);
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
      invoicedSen: c.invoicedSen,
      advanceLeftSen: k.advance_account_code ? advanceLeft.get(String(k.advance_account_code).trim()) ?? 0 : 0,
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

/* ── GET /accounting/reno-projects?asOf=YYYY-MM-DD ─────────────────────────
   Mounted under /accounting, so the Ledger guard stands in front; reading only. */
export const renoProjectsHandler = async (c: any): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const raw = String(c.req.query('asOf') ?? '').trim();
  const asOf = raw || todayMyt();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
    return c.json({ error: 'bad_date', message: 'Enter a date like 2026-11-30.' }, 400);
  }
  try {
    return c.json({ asOf, rows: await renoProjectRows(c.get('supabase'), co.companyId, asOf) });
  } catch (e) {
    return c.json({ error: 'load_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
  }
};
