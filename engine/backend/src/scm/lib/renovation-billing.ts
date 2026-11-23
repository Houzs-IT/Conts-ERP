/* Progress billing of a renovation contract.

   billingView(db, soDocNo) is THE read of what each customer instalment has
   billed and received; phase 3's billing prompts and payment condition call it
   (or read scm.reno_instalment_bills + the SO's sales invoices with the same
   rule) and never store their own copy of an amount.

   billInstalment bills the lowest unbilled instalment:
     amount = cumulative % x revised contract sum - already billed
   positive -> a sales invoice from the SO (one RENO-PROGRESS line, item group
   RENOVATION) with revenue posted after commit; negative -> a credit note, only
   once the caller confirms it, posted after commit as a renovation credit (revenue
   given back by the waterfall into the advance, acc/reno-ledger); zero -> the
   instalment closes with no document. The caller sends the amount it showed; if a
   VO moved it meanwhile the bill is refused (409) with the new one.

   creditContract (finance, spec 7.1) raises a credit note that lowers the contract:
   a RENO-CREDIT row of minus its amount on the SO (later instalments are worked out
   on the lower total) and a scm.reno_contract_credits row; its journal posts after
   commit (Dr revenue / Cr the customer). It never credits more than is invoiced net.
   billedSen counts contract credits net.

   Received is money finance has CONFIRMED (chew, 21 Nov 2026; SOP 4.2): a payment counts once its official receipt
   is FORMAL (or it posted before confirmation existed, or it is not money arriving: moved between orders, imported,
   a credit applied; acc/receipts awaitsConfirmation). Money recorded but not confirmed yet is waitingSen: shown as
   waiting for finance, never as paid.

   Paid before go-live (chew, 23 Nov 2026): a contract AutoCount carried was invoiced, and partly or wholly paid, in
   AutoCount. What it was paid there is what it was invoiced less what its customer still owed at go-live on the
   opening invoices (acc/reno-paid-before-golive). It counts in receivedSen and fills the instalments that invoicing
   covers, oldest first, as "paid before go-live". Confirmed order payments dated before go-live are AutoCount's money
   too: inside that figure, never counted on top of it. Nothing posts: the opening balances carry it. */

import { auditSo, mintDocNo, refuse, todayKl, yymmOf, type RenoDb, type UnsafeRunner, renoDbOf } from './renovation-db';
import { readContractHead, recomputeSoHeader, RENO_LIVE_STATUSES } from './renovation-so';
import type { RenoActor } from './renovation-quotation';
import { instalmentPreview, nextInstalmentAmount } from '../shared/renovation-money';
import { fmtSen } from '../shared/format';
import { renderRenoDescription } from './reno-invoice-description';
import { MAX_DESCRIPTION } from '../../acc/einvoice-build';
import { allocatePaidBeforeGoLive } from '../../acc/reno-paid-before-golive';

export interface BillRow {
  instalmentId: string; seq: number; kind: 'INVOICE' | 'CREDIT_NOTE' | 'ZERO'; amountSen: number; invoiceDate: string;
  invoiceNumber: string | null; salesInvoiceId: string | null; noteNumber: string | null; creditNoteId: string | null;
  /** Confirmed money taken on the invoice itself. */
  paidSen: number;
  /** Money taken on the invoice itself that finance has not confirmed yet. */
  waitingSen: number;
  invoiceStatus: string | null; noteStatus: string | null;
}

export interface BillingInstalment {
  id: string; seq: number; label: string; pctBp: number; cumBp: number; description: string; stageCode: string | null;
  trigger: string; bill: BillRow | null; isNext: boolean;
  /** Covered by what AutoCount invoiced before go-live: shown as billed before go-live, never billed here. */
  billedBeforeGoLive: boolean;
  /** A covered instalment's share of what AutoCount invoiced (its cumulative target less the one before); 0 otherwise. */
  beforeGoLiveSen: number;
  /** What was paid on it in AutoCount before go-live, filled oldest first (at most beforeGoLiveSen); 0 otherwise. */
  paidBeforeGoLiveSen: number;
  /** Paid in full before go-live: shown as "Paid before go-live", never as to collect. */
  paidBeforeGoLive: boolean;
  /** Amount if billed now (next instalment) or projected from today's contract sum (later ones). */
  amountSen: number;
}

/** A credit note that lowered the contract (creditContract). */
export interface ContractCredit {
  creditNoteId: string | null; noteNumber: string | null; amountSen: number; noteDate: string | null; reason: string | null; noteStatus: string | null;
}

export interface BillingView {
  soDocNo: string; status: string; originalContractSen: number; revisedContractSen: number; voTotalSen: number;
  /** Net of contract credits, what AutoCount invoiced before go-live included. */
  billedSen: number; billedBeforeGoLiveSen: number; creditedSen: number; credits: ContractCredit[];
  /** Confirmed money: on the order and on its invoices, and what AutoCount was paid before go-live. */
  receivedSen: number;
  /** What the contract was paid in AutoCount before go-live (invoiced before go-live less what its customer still
      owed at go-live; acc/reno-paid-before-golive). Inside receivedSen. */
  paidBeforeGoLiveSen: number;
  /** The confirmed order payments dated before go-live on a contract AutoCount invoiced, up to paidBeforeGoLiveSen:
      AutoCount's money, so they are that figure, not money on top of it. */
  orderPaidBeforeGoLiveSen: number;
  /** The confirmed order money that fills the instalments after what each invoice holds and what was paid before
      go-live: orderPaidSen less orderPaidBeforeGoLiveSen. */
  orderPoolSen: number;
  /** Confirmed money recorded on the order itself (the part of receivedSen no invoice holds). */
  orderPaidSen: number;
  /** Money recorded but not confirmed by finance yet: on the order and on its invoices. */
  waitingSen: number;
  /** The part of waitingSen recorded on the order itself. */
  orderWaitingSen: number;
  nextSeq: number | null; instalments: BillingInstalment[];
}

/* Is the payment row `p` (of `source`) money finance has confirmed? acc/receipts confirmedPaymentIds and
   awaitsConfirmation, as one SQL condition. */
const confirmedSql = (p: string, source: 'SOPAY' | 'SIPAY'): string =>
  `(coalesce(${p}.method::text, '') in ('converted', 'imported', 'credit') or ${p}.amount_sen <= 0
     or exists (select 1 from scm.acc_official_receipts r where r.payment_source = '${source}' and r.payment_id = ${p}.id::text and r.status = 'FORMAL')
     or exists (select 1 from scm.journal_entries j where j.source_type = '${source}' and j.source_doc_no = ${p}.id::text and j.posted and not j.reversed))`;

export async function billingView(runner: RenoDb | UnsafeRunner, soDocNo: string, companyId?: number): Promise<BillingView> {
  const view = (await billingViews(runner, [soDocNo], companyId)).get(soDocNo);
  if (!view) throw refuse(404, 'so_not_found', `Sales order ${soDocNo} does not exist.`);
  return view;
}

/** billingView for many contracts in five queries sent together (the project board reads every
    project's contract at once). SOs that do not exist are absent from the map. */
export async function billingViews(runner: RenoDb | UnsafeRunner, soDocNos: readonly string[], companyId?: number): Promise<Map<string, BillingView>> {
  const db = renoDbOf(runner);
  const out = new Map<string, BillingView>();
  const docs = [...new Set(soDocNos)];
  if (docs.length === 0) return out;
  const docsJson = JSON.stringify(docs);
  /* The five reads are independent: sent together, one round trip instead of five. */
  const [sos, instRows, bills, creditRows, orderPaid, preGoLive] = await Promise.all([
    db.q<{ doc_no: string; status: string; original_contract_sen: number | null; revised_sen: number; billed_before_golive_sen: number | string | null }>(
      `select o.doc_no, o.status::text as status, c.original_contract_sen, greatest(coalesce(c.billed_before_golive_sen, 0), coalesce(c.golive_contract_sen, 0)) as billed_before_golive_sen,
              (select coalesce(sum(i.total_sen), 0)::int from scm.mfg_sales_order_items i where i.doc_no = o.doc_no and not i.cancelled) as revised_sen
         from scm.mfg_sales_orders o
         left join scm.reno_so_contracts c on c.so_doc_no = o.doc_no
        where o.doc_no in (select jsonb_array_elements_text($1::text::jsonb)) and ($2::bigint is null or o.company_id = $2)`,
      [docsJson, companyId ?? null],
    ),
    db.q<{ id: string; so_doc_no: string; seq: number; label: string; pct_bp: number; description: string; stage_code: string | null; trigger: string }>(
      `select id, so_doc_no, seq, label, pct_bp, description, stage_code, trigger from scm.reno_doc_instalments
        where so_doc_no in (select jsonb_array_elements_text($1::text::jsonb)) order by so_doc_no, seq`,
      [docsJson],
    ),
    db.q<{
      so_doc_no: string; instalment_id: string; seq: number; kind: BillRow['kind']; amount_sen: number; invoice_date: string; invoice_number: string | null;
      sales_invoice_id: string | null; note_number: string | null; credit_note_id: string | null; paid_sen: number | null; waiting_sen: number | string | null;
      si_status: string | null; cn_status: string | null;
    }>(
      /* paid_sen is every payment taken on the invoice; what finance has not confirmed comes off it into waiting_sen. */
      `select b.so_doc_no, b.instalment_id, b.seq, b.kind, b.amount_sen, b.invoice_date::text as invoice_date, b.invoice_number, b.sales_invoice_id,
              b.note_number, b.credit_note_id, si.paid_sen, si.status::text as si_status, cn.status as cn_status,
              (select coalesce(sum(sp.amount_sen), 0) from scm.sales_invoice_payments sp
                where si.id is not null and sp.sales_invoice_id = si.id and not ${confirmedSql('sp', 'SIPAY')})::bigint as waiting_sen
         from scm.reno_instalment_bills b
         left join scm.sales_invoices si on si.id = b.sales_invoice_id
         left join scm.acc_credit_notes cn on cn.id = b.credit_note_id
        where b.so_doc_no in (select jsonb_array_elements_text($1::text::jsonb)) order by b.so_doc_no, b.seq`,
      [docsJson],
    ),
    db.q<{ so_doc_no: string; credit_note_id: string | null; note_number: string | null; amount_sen: number; note_date: string | null; reason: string | null; cn_status: string | null }>(
      `select cc.so_doc_no, cc.credit_note_id, cc.note_number, cc.amount_sen, cn.note_date::text as note_date, cn.reason, cn.status as cn_status
         from scm.reno_contract_credits cc
         left join scm.acc_credit_notes cn on cn.id = cc.credit_note_id
        where cc.so_doc_no in (select jsonb_array_elements_text($1::text::jsonb)) and coalesce(cn.status, '') <> 'CANCELLED'
        order by cc.so_doc_no, cc.created_at`,
      [docsJson],
    ),
    db.q<{ so_doc_no: string; paid_sen: number | string; waiting_sen: number | string; before_golive_sen?: number | string | null }>(
      /* before_golive_sen: confirmed and dated before go-live (acc/go-live goLiveOf: the day after the documents'
         cut-over when later than the ledger start) on a contract AutoCount invoiced. */
      `select p.so_doc_no,
              coalesce(sum(p.amount_sen) filter (where c.confirmed), 0)::bigint as paid_sen,
              coalesce(sum(p.amount_sen) filter (where not c.confirmed), 0)::bigint as waiting_sen,
              coalesce(sum(p.amount_sen) filter (where c.confirmed and g.go_live is not null and p.paid_at < g.go_live
                and exists (select 1 from scm.reno_so_contracts k where k.so_doc_no = p.so_doc_no and greatest(coalesce(k.billed_before_golive_sen, 0), coalesce(k.golive_contract_sen, 0)) > 0)), 0)::bigint as before_golive_sen
         from scm.mfg_sales_order_payments p
         cross join lateral (select ${confirmedSql('p', 'SOPAY')} as confirmed) c
         left join lateral (select greatest(s.ledger_start_date, s.documents_cutover_date + 1) as go_live
                              from scm.acc_company_settings s where s.company_id = p.company_id) g on true
        where p.so_doc_no in (select jsonb_array_elements_text($1::text::jsonb)) group by p.so_doc_no`,
      [docsJson],
    ),
    db.q<PreGoLiveRow>(
      /* Paid before go-live (acc/reno-paid-before-golive): these orders' customers, every contract AutoCount invoiced of
         those customers (C), and what each customer still owed at go-live, opening invoices less opening credits (O). */
      `with mine as (
         select distinct o.company_id, o.debtor_code from scm.mfg_sales_orders o
          where o.doc_no in (select jsonb_array_elements_text($1::text::jsonb)) and ($2::bigint is null or o.company_id = $2)
            and nullif(trim(o.debtor_code), '') is not null)
       select 'C' as kind, o.company_id, o.debtor_code, o.doc_no, o.so_date::text as so_date, greatest(coalesce(k.billed_before_golive_sen, 0), coalesce(k.golive_contract_sen, 0))::bigint as sen
         from scm.mfg_sales_orders o
         join mine m on m.company_id = o.company_id and m.debtor_code = o.debtor_code
         join scm.reno_so_contracts k on k.so_doc_no = o.doc_no
        where greatest(coalesce(k.billed_before_golive_sen, 0), coalesce(k.golive_contract_sen, 0)) > 0 and o.status::text <> 'CANCELLED'
       union all
       select 'O' as kind, m.company_id, m.debtor_code, null as doc_no, null as so_date,
              (coalesce((select sum(si.total_sen) from scm.sales_invoices si
                          where si.company_id = m.company_id and si.debtor_code = m.debtor_code and si.opening_balance
                            and upper(coalesce(si.status::text, '')) not in ('DRAFT', 'CANCELLED', 'VOID')), 0)
             - coalesce((select sum(cc.amount_sen) from scm.customer_credits cc
                          where cc.company_id = m.company_id and cc.debtor_code = m.debtor_code and cc.source_type = 'OPENING'), 0))::bigint as sen
         from mine m`,
      [docsJson, companyId ?? null],
    ),
  ]);
  if (sos.length === 0) return out;
  const orderPaidOf = new Map(orderPaid.map((r) => [r.so_doc_no, { paidSen: Number(r.paid_sen), waitingSen: Number(r.waiting_sen), beforeSen: Number(r.before_golive_sen ?? 0) }]));
  const paidBeforeOf = paidBeforeGoLiveOfRows(preGoLive);
  for (const so of sos) {
    const instalments = instRows
      .filter((r) => r.so_doc_no === so.doc_no)
      .map((r) => ({ id: r.id, seq: Number(r.seq), label: r.label, pctBp: Number(r.pct_bp), description: r.description, stageCode: r.stage_code, trigger: r.trigger }));
    const soBills = bills.filter((b) => b.so_doc_no === so.doc_no);
    const credits: ContractCredit[] = creditRows.filter((r) => r.so_doc_no === so.doc_no).map((r) => ({
      creditNoteId: r.credit_note_id, noteNumber: r.note_number, amountSen: Number(r.amount_sen), noteDate: r.note_date, reason: r.reason, noteStatus: r.cn_status,
    }));
    const creditedSen = credits.reduce((s, c) => s + c.amountSen, 0);
    const paid = orderPaidOf.get(so.doc_no);
    out.set(so.doc_no, assembleView(so.doc_no, so.status, so.original_contract_sen, Number(so.revised_sen ?? 0), instalments, soBills, creditedSen, credits,
      Number(so.billed_before_golive_sen ?? 0), paid?.paidSen ?? 0, paid?.waitingSen ?? 0, paidBeforeOf.get(so.doc_no) ?? 0, paid?.beforeSen ?? 0));
  }
  return out;
}

/** One row of billingViews' pre-go-live read: a contract AutoCount invoiced (C) or what a customer still owed at go-live (O). */
export interface PreGoLiveRow { kind: 'C' | 'O'; company_id: number | string; debtor_code: string; doc_no: string | null; so_date: string | null; sen: number | string | null }

/** That read as paid before go-live per contract (acc/reno-paid-before-golive allocatePaidBeforeGoLive). A customer is
    its company and its code, so two companies' same code never mix. Exported for tests. */
export function paidBeforeGoLiveOfRows(rows: readonly PreGoLiveRow[]): Map<string, number> {
  const key = (r: PreGoLiveRow): string => `${String(r.company_id)}|${String(r.debtor_code).trim()}`;
  const owed = new Map(rows.filter((r) => r.kind === 'O').map((r) => [key(r), Number(r.sen ?? 0)]));
  return allocatePaidBeforeGoLive(rows.filter((r) => r.kind === 'C' && r.doc_no).map((r) => ({
    soDocNo: String(r.doc_no), debtorCode: key(r), soDate: r.so_date ? String(r.so_date).slice(0, 10) : null, billedBeforeGoLiveSen: Number(r.sen ?? 0),
  })), owed);
}

/** Exported for tests. `creditedSen` (contract credit notes) comes off what is billed; `billedBeforeGoLiveSen` (what
    AutoCount invoiced before the ledger start) counts as billed, and the instalments it covers are skipped. */
export function assembleView(
  soDocNo: string,
  status: string,
  originalContractSen: number | null,
  revised: number,
  instalments: Array<{ id: string; seq: number; label: string; pctBp: number; description: string; stageCode: string | null; trigger: string }>,
  bills: Array<{
    instalment_id: string; seq: number; kind: BillRow['kind']; amount_sen: number; invoice_date: string; invoice_number: string | null;
    sales_invoice_id: string | null; note_number: string | null; credit_note_id: string | null; paid_sen: number | null; si_status: string | null; cn_status: string | null;
    /** The part of paid_sen finance has not confirmed yet. */
    waiting_sen?: number | string | null;
  }>,
  creditedSen = 0,
  credits: ContractCredit[] = [],
  billedBeforeGoLiveSen = 0,
  /** Confirmed money recorded on the order. */
  orderPaidSen = 0,
  /** Unconfirmed money recorded on the order. */
  orderWaitingSen = 0,
  /** What the contract was paid in AutoCount before go-live (acc/reno-paid-before-golive); held to [0, billedBeforeGoLiveSen]. */
  paidBeforeGoLiveSen = 0,
  /** The confirmed order payments dated before go-live (inside orderPaidSen). */
  orderPaidBeforeGoLiveSen = 0,
): BillingView {
  const waitingOf = (b: { waiting_sen?: number | string | null }) => Math.max(0, Number(b.waiting_sen ?? 0));
  const paidOf = (b: { paid_sen: number | null; waiting_sen?: number | string | null }) => Math.max(0, Number(b.paid_sen ?? 0) - waitingOf(b));
  /* A cancelled invoice or credit note billed nothing: its instalment is due again and its amount does not count. */
  const live = bills.filter((b) => b.si_status !== 'CANCELLED' && b.cn_status !== 'CANCELLED');
  const billByInst = new Map(live.map((b) => [b.instalment_id, b]));
  const billedMap = new Map<number, number>();
  for (const i of instalments) {
    const b = billByInst.get(i.id);
    if (b) billedMap.set(i.seq, Number(b.amount_sen));
  }
  const preview = instalmentPreview(instalments.map((i) => ({ seq: i.seq, pctBp: i.pctBp })), revised, billedMap, creditedSen, billedBeforeGoLiveSen);
  const covered = new Set(preview.filter((p) => p.beforeGoLive).map((p) => p.seq));
  const nextSeq = [...instalments].sort((a, b) => a.seq - b.seq).find((i) => !billByInst.has(i.id) && !covered.has(i.seq))?.seq ?? null;
  /* A covered instalment's share of what AutoCount invoiced: its cumulative target (the one instalmentPreview tested
     against it) less the previous instalment's; what was paid before go-live fills those shares oldest first. */
  const paidBefore = Math.min(Math.max(0, Math.trunc(Number(paidBeforeGoLiveSen) || 0)), Math.max(0, billedBeforeGoLiveSen));
  const shareOf = new Map<number, number>();
  const paidOfSeq = new Map<number, number>();
  if (covered.size > 0) {
    const sched = [...instalments].sort((a, b) => a.seq - b.seq).map((i) => ({ seq: i.seq, pctBp: i.pctBp }));
    let prevTarget = 0;
    let left = paidBefore;
    for (const r of sched) {
      const target = nextInstalmentAmount({ instalments: sched, seq: r.seq, revisedContractSen: revised, billedSen: 0 }).targetSen;
      if (covered.has(r.seq)) {
        const share = Math.max(0, target - prevTarget);
        const take = Math.min(left, share);
        left -= take;
        shareOf.set(r.seq, share);
        paidOfSeq.set(r.seq, take);
      }
      prevTarget = target;
    }
  }
  let cum = 0;
  const rows: BillingInstalment[] = instalments.map((i) => {
    cum += i.pctBp;
    const b = billByInst.get(i.id);
    const before = !b && covered.has(i.seq);
    const share = before ? shareOf.get(i.seq) ?? 0 : 0;
    const paidHere = before ? paidOfSeq.get(i.seq) ?? 0 : 0;
    return {
      id: i.id, seq: i.seq, label: i.label, pctBp: i.pctBp, cumBp: cum, description: i.description, stageCode: i.stageCode, trigger: i.trigger,
      isNext: i.seq === nextSeq,
      billedBeforeGoLive: before,
      beforeGoLiveSen: share,
      paidBeforeGoLiveSen: paidHere,
      paidBeforeGoLive: before && share > 0 && paidHere >= share,
      amountSen: preview.find((p) => p.seq === i.seq)?.amountSen ?? 0,
      bill: b ? {
        instalmentId: i.id, seq: Number(b.seq), kind: b.kind, amountSen: Number(b.amount_sen), invoiceDate: b.invoice_date,
        invoiceNumber: b.invoice_number, salesInvoiceId: b.sales_invoice_id, noteNumber: b.note_number, creditNoteId: b.credit_note_id,
        paidSen: paidOf(b), waitingSen: Math.min(waitingOf(b), Number(b.paid_sen ?? 0)), invoiceStatus: b.si_status, noteStatus: b.cn_status,
      } : null,
    };
  });
  const billedSen = live.reduce((s, b) => s + Number(b.amount_sen), 0) - creditedSen + billedBeforeGoLiveSen;
  /* Paid on the invoices, and paid on the order itself: a deposit is taken on the SO. Confirmed money only. What
     AutoCount was paid before go-live counts too, less the order payments before go-live it already holds. */
  const onOrderBefore = Math.min(Math.max(0, Number(orderPaidBeforeGoLiveSen) || 0), paidBefore, Math.max(0, orderPaidSen));
  const receivedSen = orderPaidSen + (paidBefore - onOrderBefore) + live.reduce((s, b) => s + (b.kind === 'INVOICE' ? paidOf(b) : 0), 0);
  const waitingSen = orderWaitingSen + live.reduce((s, b) => s + (b.kind === 'INVOICE' ? Math.min(waitingOf(b), Number(b.paid_sen ?? 0)) : 0), 0);
  const original = originalContractSen === null ? revised : Number(originalContractSen);
  return {
    soDocNo, status, originalContractSen: original, revisedContractSen: revised, voTotalSen: revised - original,
    billedSen, billedBeforeGoLiveSen, creditedSen, credits, receivedSen, paidBeforeGoLiveSen: paidBefore, orderPaidBeforeGoLiveSen: onOrderBefore,
    orderPaidSen, orderPoolSen: Math.max(0, orderPaidSen - onOrderBefore), waitingSen, orderWaitingSen, nextSeq, instalments: rows,
  };
}

/** An instalment invoice's due date: the invoice date plus the days the order's term names ("30 Days", "Net 14",
    "C30"); a term naming none (C.O.D., cash, blank) is due on the invoice date, a progress claim being payable on
    issue. A normal sales invoice takes its due date as keyed and has no default term to follow. */
export function dueDateOf(invoiceDate: string, term: string | null): string {
  const m = /(\d{1,3})/.exec(String(term ?? ''));
  const days = m ? Number(m[1]) : 0;
  const d = new Date(`${invoiceDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return invoiceDate;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface BillResult {
  kind: 'INVOICE' | 'CREDIT_NOTE' | 'ZERO';
  amountSen: number;
  invoiceNumber?: string;
  salesInvoiceId?: string;
  noteNumber?: string;
  creditNoteId?: string;
}

/** Billed ahead of this instalment. A later bill is its own share of the contract, so an earlier instalment billed again
    after its invoice was cancelled comes to what the screen previews (instalmentPreview), not a credit. */
export const billedBeforeInstalment = (view: Pick<BillingView, 'billedSen' | 'instalments'>, seq: number): number =>
  view.billedSen - view.instalments.reduce((s, i) => s + (i.seq > seq && i.bill ? i.bill.amountSen : 0), 0);

export async function billInstalment(
  db: RenoDb,
  actor: RenoActor,
  soDocNo: string,
  instalmentId: string,
  body: { invoiceDate?: string | null; expectedAmountSen: number; confirmCreditNote?: boolean },
): Promise<BillResult> {
  const head = await readContractHead(db, soDocNo, actor.companyId, true);
  if (!(RENO_LIVE_STATUSES as readonly string[]).includes(head.status)) throw refuse(409, 'contract_not_live', `A ${head.status} contract cannot be billed.`);
  const view = await billingView(db, soDocNo, actor.companyId);
  const inst = view.instalments.find((i) => i.id === instalmentId);
  if (!inst) throw refuse(404, 'instalment_not_found', 'That instalment is not on this contract.');
  if (inst.bill) throw refuse(409, 'already_billed', `Instalment ${inst.seq} is already billed.`);
  if (!inst.isNext) throw refuse(409, 'not_next', `Bill instalment ${view.nextSeq} first: instalments are billed in order.`, { nextSeq: view.nextSeq });
  const billedBefore = billedBeforeInstalment(view, inst.seq);
  const n = nextInstalmentAmount({
    instalments: view.instalments.map((i) => ({ seq: i.seq, pctBp: i.pctBp })),
    seq: inst.seq,
    revisedContractSen: view.revisedContractSen,
    billedSen: billedBefore,
  });
  if (n.amountSen !== body.expectedAmountSen) {
    throw refuse(409, 'stale_amount', 'The amount changed since this screen was opened (a variation order moved the contract sum). Check the new amount and bill again.',
      { amountSen: n.amountSen });
  }
  const invoiceDate = body.invoiceDate || todayKl();
  /* The one line the invoice (and its e-invoice) carries, from finance's template (acc/einvoice-settings.ts). */
  const [tpl] = await db.q<{ reno_invoice_description: string | null }>(
    'select reno_invoice_description from scm.acc_company_settings where company_id = $1', [actor.companyId]);
  const label = renderRenoDescription(tpl?.reno_invoice_description ?? null, { seq: inst.seq, pctBp: inst.pctBp, label: inst.label, soDocNo });
  const creditLabel = `Credit: ${label}`.length > MAX_DESCRIPTION ? `Credit: ${label}`.slice(0, MAX_DESCRIPTION - 1) + '…' : `Credit: ${label}`;
  let result: BillResult;
  if (n.amountSen > 0) {
    const invoiceNumber = await mintDocNo(db, 'sales_invoices', 'invoice_number', `${actor.docPrefix}SI-${yymmOf(invoiceDate)}`);
    const term = (await db.q<{ display_term: string | null }>('select display_term from scm.mfg_sales_orders where doc_no = $1', [soDocNo]))[0] as { display_term: string | null } | undefined;
    const [si] = await db.q<{ id: string }>(
      /* The customer header a sales invoice prints (Code, Tel, Email, address, Due; chew, 21 Nov 2026), as the DO -> SI path
         stamps it (lib/si-from-do.ts): phone, email and the address from the SO as it holds them (owner, 14 Oct 2026), the
         customer's debtor account where the SO names none, and the due date from the order's term (dueDateOf). On a
         database with migration 0116 its trigger also stamps the project, building and unit. The order's salesperson too,
         so they can open and print their own customer's invoice (the invoice reads are scoped to salesperson_id). */
      `insert into scm.sales_invoices (invoice_number, so_doc_no, debtor_code, debtor_name, invoice_date, subtotal_sen, total_sen, others_sen,
          local_total_sen, line_count, status, sent_at, confirmed_at, notes, branding, created_by, company_id, phone, email, address1, address2,
          city, postcode, state, customer_state, customer_country, salesperson_id, due_date)
       select $1, $2, coalesce($3, d.code), $4, $5::date, $6, $6, $6, $6, 1, 'SENT', now(), now(), $7, $8, $9, $10,
              coalesce(nullif(o.phone, ''), d.phone), coalesce(nullif(o.email, ''), d.email), o.address1, o.address2,
              o.city, o.postcode, o.customer_state, o.customer_state, o.customer_country, o.salesperson_id, $11::date
         from scm.mfg_sales_orders o
         left join lateral (select x.code, x.phone, x.email from scm.debtors x
                             where x.company_id = o.company_id and (x.code = $3 or ($3::text is null and x.customer_id::text = o.customer_id::text))
                             order by (x.code = $3) desc nulls last, x.is_active desc, x.created_at limit 1) d on true
        where o.doc_no = $2
       returning id`,
      [invoiceNumber, soDocNo, head.debtorCode, head.debtorName, invoiceDate, n.amountSen, label, head.branding, actor.staffId, actor.companyId,
        dueDateOf(invoiceDate, term?.display_term ?? null)],
    );
    await db.q(
      `insert into scm.sales_invoice_items (sales_invoice_id, item_code, item_group, description, qty, unit_price_sen, line_total_sen, uom, line_no, company_id)
       values ($1, 'RENO-PROGRESS', 'RENOVATION', $2, 1, $3, $3, 'LOT', 1, $4)`,
      [si.id, label, n.amountSen, actor.companyId],
    );
    result = { kind: 'INVOICE', amountSen: n.amountSen, invoiceNumber, salesInvoiceId: si.id };
  } else if (n.amountSen < 0) {
    if (!body.confirmCreditNote) {
      throw refuse(409, 'credit_note_needs_confirm', `This instalment comes to ${fmtSen(n.amountSen)}: the contract is over-billed. Confirm to raise a credit note.`,
        { amountSen: n.amountSen });
    }
    /* The note's line names the advance account for now; posting spreads it over revenue by the waterfall and
       rewrites the line to the accounts it went to (acc/reno-ledger postRenovationCredit). */
    const advance = await advanceAccountOf(db, soDocNo);
    const noteNumber = await mintDocNo(db, 'acc_credit_notes', 'note_number', `${actor.docPrefix}CN-${yymmOf(invoiceDate)}`);
    const [cn] = await db.q<{ id: string }>(
      `insert into scm.acc_credit_notes (company_id, note_number, kind, party_type, party_code, party_name, so_doc_no, source_doc_no, note_date,
          total_sen, reason, status, created_by)
       values ($1, $2, 'CN', 'CUSTOMER', $3, $4, $5, $5, $6::date, $7, $8, 'DRAFT', $9) returning id`,
      [actor.companyId, noteNumber, head.debtorCode, head.debtorName, soDocNo, invoiceDate, -n.amountSen, creditLabel, actor.name],
    );
    await db.q(
      `insert into scm.acc_credit_note_lines (company_id, note_id, line_no, description, account_code, amount_sen) values ($1, $2, 1, $3, $4, $5)`,
      [actor.companyId, cn.id, creditLabel, advance, -n.amountSen],
    );
    result = { kind: 'CREDIT_NOTE', amountSen: n.amountSen, noteNumber, creditNoteId: cn.id };
  } else {
    result = { kind: 'ZERO', amountSen: 0 };
  }
  /* One bill per instalment: a cancelled one is replaced. Its document keeps its own record. */
  await db.q(`delete from scm.reno_instalment_bills where instalment_id = $1`, [instalmentId]);
  await db.q(
    `insert into scm.reno_instalment_bills (company_id, so_doc_no, instalment_id, seq, kind, amount_sen, cum_bp, revised_contract_sen, billed_before_sen,
        invoice_date, sales_invoice_id, invoice_number, credit_note_id, note_number, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11, $12, $13, $14, $15)`,
    [actor.companyId, soDocNo, instalmentId, inst.seq, result.kind, result.amountSen, n.cumBp, view.revisedContractSen, billedBefore, invoiceDate,
      result.salesInvoiceId ?? null, result.invoiceNumber ?? null, result.creditNoteId ?? null, result.noteNumber ?? null, actor.name],
  );
  await auditSo(db, {
    companyId: actor.companyId, docNo: soDocNo, action: 'BILL_INSTALMENT', actorName: actor.name,
    note: `Instalment ${inst.seq}: ${result.kind === 'INVOICE' ? result.invoiceNumber : result.kind === 'CREDIT_NOTE' ? result.noteNumber : 'nothing to bill'} ${fmtSen(result.amountSen)}`,
  });
  return result;
}

async function advanceAccountOf(db: RenoDb, soDocNo: string): Promise<string> {
  const [c] = await db.q<{ advance_account_code: string | null }>(`select advance_account_code from scm.reno_so_contracts where so_doc_no = $1`, [soDocNo]);
  const code = String(c?.advance_account_code ?? '').trim();
  if (!code) throw refuse(409, 'no_advance_account', `Contract ${soDocNo} has no advance account yet. Finance sets it first, then try again.`);
  return code;
}

/** What the contract has invoiced, net: issued invoices + what AutoCount invoiced before go-live − contract credits −
    negative instalments (cancelled documents left out). */
export async function netBilledSql(db: RenoDb, soDocNo: string): Promise<number> {
  const [r] = await db.q<{ net_billed_sen: number | string | null }>(
    `select (
        coalesce((select sum(si.total_sen) from scm.sales_invoices si
                   where si.so_doc_no = $1 and si.status::text not in ('DRAFT', 'CANCELLED')), 0)
      + coalesce((select greatest(coalesce(c.billed_before_golive_sen, 0), coalesce(c.golive_contract_sen, 0)) from scm.reno_so_contracts c where c.so_doc_no = $1), 0)
      - coalesce((select sum(cc.amount_sen) from scm.reno_contract_credits cc
                    left join scm.acc_credit_notes cn on cn.id = cc.credit_note_id
                   where cc.so_doc_no = $1 and coalesce(cn.status, '') <> 'CANCELLED'), 0)
      - coalesce((select sum(-b.amount_sen) from scm.reno_instalment_bills b
                    left join scm.acc_credit_notes cn on cn.id = b.credit_note_id
                   where b.so_doc_no = $1 and b.kind = 'CREDIT_NOTE' and coalesce(cn.status, '') <> 'CANCELLED'), 0)
      )::bigint as net_billed_sen`,
    [soDocNo],
  );
  return Number(r?.net_billed_sen ?? 0);
}

export interface CreditResult { noteNumber: string; creditNoteId: string; amountSen: number }

/** A credit note that lowers the contract (see the header): a special discount, less work, a refund. */
export async function creditContract(
  db: RenoDb,
  actor: RenoActor,
  soDocNo: string,
  body: { amountSen: number; reason: string; noteDate?: string | null },
): Promise<CreditResult> {
  const amountSen = Number(body.amountSen);
  if (!Number.isSafeInteger(amountSen) || amountSen <= 0) throw refuse(400, 'invalid_amount', 'The credit must be an amount above zero.');
  const reason = String(body.reason ?? '').trim();
  if (!reason) throw refuse(400, 'reason_required', 'Say why the contract is credited (for example a special discount or a refund).');
  const head = await readContractHead(db, soDocNo, actor.companyId, true);
  if (!(RENO_LIVE_STATUSES as readonly string[]).includes(head.status)) throw refuse(409, 'contract_not_live', `A ${head.status} contract cannot be credited.`);
  const net = await netBilledSql(db, soDocNo);
  if (amountSen > net) {
    throw refuse(409, 'credit_exceeds_billed',
      `A credit note of ${fmtSen(amountSen)} is more than ${soDocNo} has invoiced so far (${fmtSen(net)}, net of earlier credits). Invoice first, or credit less.`,
      { netBilledSen: net });
  }
  if (!head.debtorCode) throw refuse(409, 'no_customer_account', `Contract ${soDocNo} names no customer account. Set it, then try again.`);
  const advance = await advanceAccountOf(db, soDocNo);
  const noteDate = body.noteDate || todayKl();
  const noteNumber = await mintDocNo(db, 'acc_credit_notes', 'note_number', `${actor.docPrefix}CN-${yymmOf(noteDate)}`);
  const [cn] = await db.q<{ id: string }>(
    `insert into scm.acc_credit_notes (company_id, note_number, kind, party_type, party_code, party_name, so_doc_no, source_doc_no, note_date,
        total_sen, reason, status, created_by)
     values ($1, $2, 'CN', 'CUSTOMER', $3, $4, $5, $5, $6::date, $7, $8, 'DRAFT', $9) returning id`,
    [actor.companyId, noteNumber, head.debtorCode, head.debtorName, soDocNo, noteDate, amountSen, reason, actor.name],
  );
  await db.q(
    `insert into scm.acc_credit_note_lines (company_id, note_id, line_no, description, account_code, amount_sen) values ($1, $2, 1, $3, $4, $5)`,
    [actor.companyId, cn.id, reason, advance, amountSen],
  );
  /* The contract comes down by the credit: one RENO-CREDIT row of minus its amount, sharing its id with the credit
     record so a cancelled note can find and cancel it. */
  const creditId = crypto.randomUUID();
  const [max] = await db.q<{ n: number | null }>(`select max(line_no) as n from scm.mfg_sales_order_items where doc_no = $1`, [soDocNo]);
  await db.q(
    `insert into scm.mfg_sales_order_items (id, doc_no, line_date, debtor_name, item_group, item_code, description, uom, location,
        qty, unit_price_sen, discount_sen, total_sen, total_inc_sen, balance_sen, unit_cost_sen, line_cost_sen, line_margin_sen, line_no, company_id)
     values ($1, $2, $3::date, $4, 'RENOVATION', 'RENO-CREDIT', $5, 'LOT', '', 1, $6, 0, $6, $6, $6, 0, 0, $6, $7, $8)`,
    [creditId, soDocNo, noteDate, head.debtorName, `Credit note ${noteNumber}: ${reason}`, -amountSen, Number(max?.n ?? 0) + 1, actor.companyId],
  );
  await db.q(
    `insert into scm.reno_contract_credits (id, company_id, so_doc_no, credit_note_id, note_number, amount_sen, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [creditId, actor.companyId, soDocNo, cn.id, noteNumber, amountSen, actor.name],
  );
  await recomputeSoHeader(db, soDocNo);
  await auditSo(db, { companyId: actor.companyId, docNo: soDocNo, action: 'CREDIT_CONTRACT', actorName: actor.name, note: `${noteNumber} ${fmtSen(amountSen)}: ${reason}` });
  return { noteNumber, creditNoteId: cn.id, amountSen };
}
