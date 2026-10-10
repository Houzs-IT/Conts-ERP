/* Progress billing of a renovation contract.

   billingView(db, soDocNo) is THE read of what each customer instalment has
   billed and received; phase 3's billing prompts and payment condition call it
   (or read scm.reno_instalment_bills + the SO's sales invoices with the same
   rule) and never store their own copy of an amount.

   billInstalment bills the lowest unbilled instalment:
     amount = cumulative % x revised contract sum - already billed
   positive -> a sales invoice from the SO (one RENO-PROGRESS line, item group
   RENOVATION) with revenue posted after commit; negative -> a credit note to the
   RENOVATION group's sales-return account, only once the caller confirms it;
   zero -> the instalment closes with no document. The caller sends the amount it
   showed; if a VO moved it meanwhile the bill is refused (409) with the new one. */

import { auditSo, mintDocNo, refuse, todayKl, yymmOf, type RenoDb, type UnsafeRunner, renoDbOf } from './renovation-db';
import { readInstalments } from './renovation-doc-lines';
import { readContractHead, revisedContractSen, RENO_LIVE_STATUSES } from './renovation-so';
import type { RenoActor } from './renovation-quotation';
import { instalmentPreview, nextInstalmentAmount } from '../shared/renovation-money';
import { fmtSen } from '../shared/format';

export interface BillRow {
  instalmentId: string; seq: number; kind: 'INVOICE' | 'CREDIT_NOTE' | 'ZERO'; amountSen: number; invoiceDate: string;
  invoiceNumber: string | null; salesInvoiceId: string | null; noteNumber: string | null; creditNoteId: string | null;
  paidSen: number; invoiceStatus: string | null; noteStatus: string | null;
}

export interface BillingInstalment {
  id: string; seq: number; label: string; pctBp: number; cumBp: number; description: string; stageCode: string | null;
  trigger: string; bill: BillRow | null; isNext: boolean;
  /** Amount if billed now (next instalment) or projected from today's contract sum (later ones). */
  amountSen: number;
}

export interface BillingView {
  soDocNo: string; status: string; originalContractSen: number; revisedContractSen: number; voTotalSen: number;
  billedSen: number; receivedSen: number; nextSeq: number | null; instalments: BillingInstalment[];
}

export async function billingView(runner: RenoDb | UnsafeRunner, soDocNo: string, companyId?: number): Promise<BillingView> {
  const db = renoDbOf(runner);
  const [so] = await db.q<{ status: string; company_id: number; original_contract_sen: number | null }>(
    `select o.status::text as status, o.company_id, c.original_contract_sen from scm.mfg_sales_orders o
       left join scm.reno_so_contracts c on c.so_doc_no = o.doc_no where o.doc_no = $1 and ($2::bigint is null or o.company_id = $2)`,
    [soDocNo, companyId ?? null],
  );
  if (!so) throw refuse(404, 'so_not_found', `Sales order ${soDocNo} does not exist.`);
  const instalments = await readInstalments(db, { kind: 'so', id: soDocNo });
  const bills = await db.q<{
    instalment_id: string; seq: number; kind: BillRow['kind']; amount_sen: number; invoice_date: string; invoice_number: string | null;
    sales_invoice_id: string | null; note_number: string | null; credit_note_id: string | null; paid_sen: number | null; si_status: string | null; cn_status: string | null;
  }>(
    `select b.instalment_id, b.seq, b.kind, b.amount_sen, b.invoice_date::text as invoice_date, b.invoice_number, b.sales_invoice_id,
            b.note_number, b.credit_note_id, si.paid_sen, si.status::text as si_status, cn.status as cn_status
       from scm.reno_instalment_bills b
       left join scm.sales_invoices si on si.id = b.sales_invoice_id
       left join scm.acc_credit_notes cn on cn.id = b.credit_note_id
      where b.so_doc_no = $1 order by b.seq`,
    [soDocNo],
  );
  const billByInst = new Map(bills.map((b) => [b.instalment_id, b]));
  const revised = await revisedContractSen(db, soDocNo);
  const billedMap = new Map<number, number>();
  for (const i of instalments) {
    const b = billByInst.get(i.id);
    if (b) billedMap.set(i.seq, Number(b.amount_sen));
  }
  const preview = instalmentPreview(instalments.map((i) => ({ seq: i.seq, pctBp: i.pctBp })), revised, billedMap);
  const nextSeq = instalments.find((i) => !billByInst.has(i.id))?.seq ?? null;
  let cum = 0;
  const rows: BillingInstalment[] = instalments.map((i) => {
    cum += i.pctBp;
    const b = billByInst.get(i.id);
    return {
      id: i.id, seq: i.seq, label: i.label, pctBp: i.pctBp, cumBp: cum, description: i.description, stageCode: i.stageCode, trigger: i.trigger,
      isNext: i.seq === nextSeq,
      amountSen: preview.find((p) => p.seq === i.seq)?.amountSen ?? 0,
      bill: b ? {
        instalmentId: i.id, seq: Number(b.seq), kind: b.kind, amountSen: Number(b.amount_sen), invoiceDate: b.invoice_date,
        invoiceNumber: b.invoice_number, salesInvoiceId: b.sales_invoice_id, noteNumber: b.note_number, creditNoteId: b.credit_note_id,
        paidSen: Number(b.paid_sen ?? 0), invoiceStatus: b.si_status, noteStatus: b.cn_status,
      } : null,
    };
  });
  const billedSen = bills.reduce((s, b) => s + Number(b.amount_sen), 0);
  const receivedSen = bills.reduce((s, b) => s + (b.kind === 'INVOICE' ? Number(b.paid_sen ?? 0) : 0), 0);
  const original = so.original_contract_sen === null ? revised : Number(so.original_contract_sen);
  return {
    soDocNo, status: so.status, originalContractSen: original, revisedContractSen: revised, voTotalSen: revised - original,
    billedSen, receivedSen, nextSeq, instalments: rows,
  };
}

export interface BillResult {
  kind: 'INVOICE' | 'CREDIT_NOTE' | 'ZERO';
  amountSen: number;
  invoiceNumber?: string;
  salesInvoiceId?: string;
  noteNumber?: string;
  creditNoteId?: string;
}

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
  const n = nextInstalmentAmount({
    instalments: view.instalments.map((i) => ({ seq: i.seq, pctBp: i.pctBp })),
    seq: inst.seq,
    revisedContractSen: view.revisedContractSen,
    billedSen: view.billedSen,
  });
  if (n.amountSen !== body.expectedAmountSen) {
    throw refuse(409, 'stale_amount', 'The amount changed since this screen was opened (a variation order moved the contract sum). Check the new amount and bill again.',
      { amountSen: n.amountSen });
  }
  const invoiceDate = body.invoiceDate || todayKl();
  const pct = `${(inst.pctBp / 100).toFixed(inst.pctBp % 100 ? 2 : 0)}%`;
  const label = `${inst.label || `Instalment ${inst.seq}`} (${pct}) of ${soDocNo}`;
  let result: BillResult;
  if (n.amountSen > 0) {
    const invoiceNumber = await mintDocNo(db, 'sales_invoices', 'invoice_number', `${actor.docPrefix}SI-${yymmOf(invoiceDate)}`);
    const [si] = await db.q<{ id: string }>(
      `insert into scm.sales_invoices (invoice_number, so_doc_no, debtor_code, debtor_name, invoice_date, subtotal_sen, total_sen, others_sen,
          local_total_sen, line_count, status, sent_at, confirmed_at, notes, branding, created_by, company_id)
       values ($1, $2, $3, $4, $5::date, $6, $6, $6, $6, 1, 'SENT', now(), now(), $7, $8, $9, $10) returning id`,
      [invoiceNumber, soDocNo, head.debtorCode, head.debtorName, invoiceDate, n.amountSen, `Progress billing: ${label}`, head.branding, actor.staffId, actor.companyId],
    );
    await db.q(
      `insert into scm.sales_invoice_items (sales_invoice_id, item_code, item_group, description, qty, unit_price_sen, line_total_sen, uom, line_no, company_id)
       values ($1, 'RENO-PROGRESS', 'RENOVATION', $2, 1, $3, $3, 'LOT', 1, $4)`,
      [si.id, `Progress billing: ${label}`, n.amountSen, actor.companyId],
    );
    result = { kind: 'INVOICE', amountSen: n.amountSen, invoiceNumber, salesInvoiceId: si.id };
  } else if (n.amountSen < 0) {
    if (!body.confirmCreditNote) {
      throw refuse(409, 'credit_note_needs_confirm', `This instalment comes to ${fmtSen(n.amountSen)}: the contract is over-billed. Confirm to raise a credit note.`,
        { amountSen: n.amountSen });
    }
    const [acct] = await db.q<{ sales_return_account: string }>(
      `select sales_return_account from scm.acc_item_group_accounts where company_id = $1 and group_code = 'RENOVATION'`,
      [actor.companyId],
    );
    if (!acct?.sales_return_account) {
      throw refuse(409, 'group_unbound', 'The RENOVATION item group has no sales-return account yet. Bind it on Accounting > Item Groups, then bill again.');
    }
    const noteNumber = await mintDocNo(db, 'acc_credit_notes', 'note_number', `${actor.docPrefix}CN-${yymmOf(invoiceDate)}`);
    const [cn] = await db.q<{ id: string }>(
      `insert into scm.acc_credit_notes (company_id, note_number, kind, party_type, party_code, party_name, so_doc_no, source_doc_no, note_date,
          total_sen, reason, status, created_by)
       values ($1, $2, 'CN', 'CUSTOMER', $3, $4, $5, $5, $6::date, $7, $8, 'DRAFT', $9) returning id`,
      [actor.companyId, noteNumber, head.debtorCode, head.debtorName, soDocNo, invoiceDate, -n.amountSen, `Progress billing credit: ${label}`, actor.name],
    );
    await db.q(
      `insert into scm.acc_credit_note_lines (company_id, note_id, line_no, description, account_code, amount_sen) values ($1, $2, 1, $3, $4, $5)`,
      [actor.companyId, cn.id, `Progress billing credit: ${label}`, acct.sales_return_account, -n.amountSen],
    );
    result = { kind: 'CREDIT_NOTE', amountSen: n.amountSen, noteNumber, creditNoteId: cn.id };
  } else {
    result = { kind: 'ZERO', amountSen: 0 };
  }
  await db.q(
    `insert into scm.reno_instalment_bills (company_id, so_doc_no, instalment_id, seq, kind, amount_sen, cum_bp, revised_contract_sen, billed_before_sen,
        invoice_date, sales_invoice_id, invoice_number, credit_note_id, note_number, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11, $12, $13, $14, $15)`,
    [actor.companyId, soDocNo, instalmentId, inst.seq, result.kind, result.amountSen, n.cumBp, view.revisedContractSen, view.billedSen, invoiceDate,
      result.salesInvoiceId ?? null, result.invoiceNumber ?? null, result.creditNoteId ?? null, result.noteNumber ?? null, actor.name],
  );
  await auditSo(db, {
    companyId: actor.companyId, docNo: soDocNo, action: 'BILL_INSTALMENT', actorName: actor.name,
    note: `Instalment ${inst.seq}: ${result.kind === 'INVOICE' ? result.invoiceNumber : result.kind === 'CREDIT_NOTE' ? result.noteNumber : 'nothing to bill'} ${fmtSen(result.amountSen)}`,
  });
  return result;
}
