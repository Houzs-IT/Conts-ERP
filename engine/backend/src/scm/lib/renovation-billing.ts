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
   billedSen counts contract credits net. */

import { auditSo, mintDocNo, refuse, todayKl, yymmOf, type RenoDb, type UnsafeRunner, renoDbOf } from './renovation-db';
import { readContractHead, recomputeSoHeader, RENO_LIVE_STATUSES } from './renovation-so';
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

/** A credit note that lowered the contract (creditContract). */
export interface ContractCredit {
  creditNoteId: string | null; noteNumber: string | null; amountSen: number; noteDate: string | null; reason: string | null; noteStatus: string | null;
}

export interface BillingView {
  soDocNo: string; status: string; originalContractSen: number; revisedContractSen: number; voTotalSen: number;
  /** Net of contract credits. */
  billedSen: number; creditedSen: number; credits: ContractCredit[];
  receivedSen: number; nextSeq: number | null; instalments: BillingInstalment[];
}

export async function billingView(runner: RenoDb | UnsafeRunner, soDocNo: string, companyId?: number): Promise<BillingView> {
  const view = (await billingViews(runner, [soDocNo], companyId)).get(soDocNo);
  if (!view) throw refuse(404, 'so_not_found', `Sales order ${soDocNo} does not exist.`);
  return view;
}

/** billingView for many contracts in four queries (the project board reads every
    project's contract at once). SOs that do not exist are absent from the map. */
export async function billingViews(runner: RenoDb | UnsafeRunner, soDocNos: readonly string[], companyId?: number): Promise<Map<string, BillingView>> {
  const db = renoDbOf(runner);
  const out = new Map<string, BillingView>();
  const docs = [...new Set(soDocNos)];
  if (docs.length === 0) return out;
  const docsJson = JSON.stringify(docs);
  const sos = await db.q<{ doc_no: string; status: string; original_contract_sen: number | null; revised_sen: number }>(
    `select o.doc_no, o.status::text as status, c.original_contract_sen,
            (select coalesce(sum(i.total_sen), 0)::int from scm.mfg_sales_order_items i where i.doc_no = o.doc_no and not i.cancelled) as revised_sen
       from scm.mfg_sales_orders o
       left join scm.reno_so_contracts c on c.so_doc_no = o.doc_no
      where o.doc_no in (select jsonb_array_elements_text($1::text::jsonb)) and ($2::bigint is null or o.company_id = $2)`,
    [docsJson, companyId ?? null],
  );
  if (sos.length === 0) return out;
  const instRows = await db.q<{ id: string; so_doc_no: string; seq: number; label: string; pct_bp: number; description: string; stage_code: string | null; trigger: string }>(
    `select id, so_doc_no, seq, label, pct_bp, description, stage_code, trigger from scm.reno_doc_instalments
      where so_doc_no in (select jsonb_array_elements_text($1::text::jsonb)) order by so_doc_no, seq`,
    [docsJson],
  );
  const bills = await db.q<{
    so_doc_no: string; instalment_id: string; seq: number; kind: BillRow['kind']; amount_sen: number; invoice_date: string; invoice_number: string | null;
    sales_invoice_id: string | null; note_number: string | null; credit_note_id: string | null; paid_sen: number | null; si_status: string | null; cn_status: string | null;
  }>(
    `select b.so_doc_no, b.instalment_id, b.seq, b.kind, b.amount_sen, b.invoice_date::text as invoice_date, b.invoice_number, b.sales_invoice_id,
            b.note_number, b.credit_note_id, si.paid_sen, si.status::text as si_status, cn.status as cn_status
       from scm.reno_instalment_bills b
       left join scm.sales_invoices si on si.id = b.sales_invoice_id
       left join scm.acc_credit_notes cn on cn.id = b.credit_note_id
      where b.so_doc_no in (select jsonb_array_elements_text($1::text::jsonb)) order by b.so_doc_no, b.seq`,
    [docsJson],
  );
  const creditRows = await db.q<{ so_doc_no: string; credit_note_id: string | null; note_number: string | null; amount_sen: number; note_date: string | null; reason: string | null; cn_status: string | null }>(
    `select cc.so_doc_no, cc.credit_note_id, cc.note_number, cc.amount_sen, cn.note_date::text as note_date, cn.reason, cn.status as cn_status
       from scm.reno_contract_credits cc
       left join scm.acc_credit_notes cn on cn.id = cc.credit_note_id
      where cc.so_doc_no in (select jsonb_array_elements_text($1::text::jsonb)) and coalesce(cn.status, '') <> 'CANCELLED'
      order by cc.so_doc_no, cc.created_at`,
    [docsJson],
  );
  for (const so of sos) {
    const instalments = instRows
      .filter((r) => r.so_doc_no === so.doc_no)
      .map((r) => ({ id: r.id, seq: Number(r.seq), label: r.label, pctBp: Number(r.pct_bp), description: r.description, stageCode: r.stage_code, trigger: r.trigger }));
    const soBills = bills.filter((b) => b.so_doc_no === so.doc_no);
    const credits: ContractCredit[] = creditRows.filter((r) => r.so_doc_no === so.doc_no).map((r) => ({
      creditNoteId: r.credit_note_id, noteNumber: r.note_number, amountSen: Number(r.amount_sen), noteDate: r.note_date, reason: r.reason, noteStatus: r.cn_status,
    }));
    const creditedSen = credits.reduce((s, c) => s + c.amountSen, 0);
    out.set(so.doc_no, assembleView(so.doc_no, so.status, so.original_contract_sen, Number(so.revised_sen ?? 0), instalments, soBills, creditedSen, credits));
  }
  return out;
}

/** Exported for tests. `creditedSen` (contract credit notes) comes off what is billed. */
export function assembleView(
  soDocNo: string,
  status: string,
  originalContractSen: number | null,
  revised: number,
  instalments: Array<{ id: string; seq: number; label: string; pctBp: number; description: string; stageCode: string | null; trigger: string }>,
  bills: Array<{
    instalment_id: string; seq: number; kind: BillRow['kind']; amount_sen: number; invoice_date: string; invoice_number: string | null;
    sales_invoice_id: string | null; note_number: string | null; credit_note_id: string | null; paid_sen: number | null; si_status: string | null; cn_status: string | null;
  }>,
  creditedSen = 0,
  credits: ContractCredit[] = [],
): BillingView {
  const billByInst = new Map(bills.map((b) => [b.instalment_id, b]));
  const billedMap = new Map<number, number>();
  for (const i of instalments) {
    const b = billByInst.get(i.id);
    if (b) billedMap.set(i.seq, Number(b.amount_sen));
  }
  const preview = instalmentPreview(instalments.map((i) => ({ seq: i.seq, pctBp: i.pctBp })), revised, billedMap, creditedSen);
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
  const billedSen = bills.reduce((s, b) => s + Number(b.amount_sen), 0) - creditedSen;
  const receivedSen = bills.reduce((s, b) => s + (b.kind === 'INVOICE' ? Number(b.paid_sen ?? 0) : 0), 0);
  const original = originalContractSen === null ? revised : Number(originalContractSen);
  return {
    soDocNo, status, originalContractSen: original, revisedContractSen: revised, voTotalSen: revised - original,
    billedSen, creditedSen, credits, receivedSen, nextSeq, instalments: rows,
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
      /* Phone, email and the delivery address come from the SO as it holds them (owner, 14 Oct 2026); on a database with migration 0116
         its trigger also stamps the project, building and unit. */
      `insert into scm.sales_invoices (invoice_number, so_doc_no, debtor_code, debtor_name, invoice_date, subtotal_sen, total_sen, others_sen,
          local_total_sen, line_count, status, sent_at, confirmed_at, notes, branding, created_by, company_id, phone, email, address1, address2,
          city, postcode, state, customer_state, customer_country)
       select $1, $2, $3, $4, $5::date, $6, $6, $6, $6, 1, 'SENT', now(), now(), $7, $8, $9, $10, o.phone, o.email, o.address1, o.address2,
              o.city, o.postcode, o.customer_state, o.customer_state, o.customer_country
         from scm.mfg_sales_orders o where o.doc_no = $2
       returning id`,
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
    /* The note's line names the advance account for now; posting spreads it over revenue by the waterfall and
       rewrites the line to the accounts it went to (acc/reno-ledger postRenovationCredit). */
    const advance = await advanceAccountOf(db, soDocNo);
    const noteNumber = await mintDocNo(db, 'acc_credit_notes', 'note_number', `${actor.docPrefix}CN-${yymmOf(invoiceDate)}`);
    const [cn] = await db.q<{ id: string }>(
      `insert into scm.acc_credit_notes (company_id, note_number, kind, party_type, party_code, party_name, so_doc_no, source_doc_no, note_date,
          total_sen, reason, status, created_by)
       values ($1, $2, 'CN', 'CUSTOMER', $3, $4, $5, $5, $6::date, $7, $8, 'DRAFT', $9) returning id`,
      [actor.companyId, noteNumber, head.debtorCode, head.debtorName, soDocNo, invoiceDate, -n.amountSen, `Progress billing credit: ${label}`, actor.name],
    );
    await db.q(
      `insert into scm.acc_credit_note_lines (company_id, note_id, line_no, description, account_code, amount_sen) values ($1, $2, 1, $3, $4, $5)`,
      [actor.companyId, cn.id, `Progress billing credit: ${label}`, advance, -n.amountSen],
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
      + coalesce((select c.billed_before_golive_sen from scm.reno_so_contracts c where c.so_doc_no = $1), 0)
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
