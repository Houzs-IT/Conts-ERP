// Conts only (not part of Houzs's code): the opening balances (finance phase 1, spec 3.8). On the day before the books
// start in the engine the ledger takes over from AutoCount:
//   · one OPENING journal — every account's balance from AutoCount's trial balance, the debtors and creditors controls
//     included (the only journal besides a document's that may name them);
//   · the invoices customers still owe and the bills the company still owes, as opening documents (migration 0136):
//     they post nothing — their money is in the journal — but sit in the ageing and settle as usual. A minus on either
//     list (chew, 17 Nov 2026) is money already paid ahead: a customer's becomes a customer credit (customer_credits,
//     source OPENING) that pays their later invoices; a supplier's becomes an opening payment voucher (migration 0332,
//     posting nothing) holding a supplier advance that knocks off their later bills;
//   · a check that the two agree, and that the trial balance and each bank read as AutoCount's.
import { postJournal, reverseJournal } from './engine';
import { loadLedgerSettings } from './ledger-settings';
import { apControlOf, resolveRoles } from './rules';
import { paginateAll } from '../scm/lib/paginate-all';
import { loadSums } from '../scm/routes/accounting-reports';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as everywhere in acc/ */
type Db = any;

export interface OpeningLine { accountCode: string; debitSen: number; creditSen: number }
export interface OpeningArRow { docNo: string; debtorName: string; debtorCode?: string | null; invoiceDate: string; dueDate: string; outstandingSen: number }
export interface OpeningApRow { docNo: string; supplierCode: string; invoiceDate: string; dueDate: string; outstandingSen: number }
export type OpeningImportResult = { created: number; skipped: number; errors: { docNo: string; error: string }[] };

/** A customer's opening credit (paid ahead) is marked by its source; a supplier's opening voucher by its number. */
export const OPENING_CREDIT = 'OPENING';
export const openingPvNo = (docNo: string): string => `OB-${docNo}`;

/** The one source_doc_no every OPENING journal carries: there is one per company. */
const OPENING_DOC = 'OPENING';

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** A cell of the uploaded list as text. The rows arrive as JSON from the browser, so the types above are what they
    should be, not what they are. */
const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

/** The day before a YYYY-MM-DD day. */
export function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The opening day — the day before the books start — or why there is none. */
async function openingDayOf(sb: Db, companyId: number): Promise<{ ok: true; day: string } | { ok: false; error: string }> {
  const ls = await loadLedgerSettings(sb, companyId);
  if (!ls.ok) return { ok: false, error: 'The ledger settings could not be read.' };
  if (!ls.settings.ledgerStartDate) return { ok: false, error: 'Set the day the books start first: the opening balances are dated the day before it.' };
  return { ok: true, day: dayBefore(ls.settings.ledgerStartDate) };
}

/** The day the open documents stand at: the documents' cut-over when one is set (migration 0333: AutoCount kept the
    books after the start, so its open invoices and bills are taken as at the day it stopped), else the opening day. */
async function documentsDayOf(sb: Db, companyId: number): Promise<{ ok: true; day: string; openingDay: string; cutover: boolean } | { ok: false; error: string }> {
  const opening = await openingDayOf(sb, companyId);
  if (!opening.ok) return opening;
  const { data } = await sb.from('acc_company_settings').select('documents_cutover_date').eq('company_id', companyId).maybeSingle();
  const cut = String((data as { documents_cutover_date?: string | null } | null)?.documents_cutover_date ?? '').slice(0, 10);
  return isDay(cut) && cut > opening.day ? { ok: true, day: cut, openingDay: opening.day, cutover: true } : { ok: true, day: opening.day, openingDay: opening.day, cutover: false };
}

/** The OPENING journal that counts now (not reversed), if any. */
async function activeOpening(sb: Db, companyId: number): Promise<{ ok: true; je: { id: string; je_no: string; entry_date: string } | null } | { ok: false; error: string }> {
  const { data, error } = await sb.from('journal_entries').select('id, je_no, entry_date, reversed')
    .eq('company_id', companyId).eq('source_type', 'OPENING');
  if (error) return { ok: false, error: error.message };
  const je = ((data ?? []) as Array<{ id: string; je_no: string; entry_date: string; reversed: boolean | null }>).find((r) => !r.reversed);
  return { ok: true, je: je ?? null };
}

/** Post the OPENING journal, dated the day before the books start. One per company: reverse it to do it again. */
export async function importOpeningJournal(
  sb: Db, companyId: number, lines: OpeningLine[], actorName: string,
): Promise<{ ok: true; jeNo: string } | { ok: false; error: string }> {
  const day = await openingDayOf(sb, companyId);
  if (!day.ok) return day;
  const existing = await activeOpening(sb, companyId);
  if (!existing.ok) return { ok: false, error: `The journal could not be read: ${existing.error}` };
  if (existing.je) return { ok: false, error: `The opening journal ${existing.je.je_no} is already in the books — reverse it first to import again.` };
  const r = await postJournal(sb, {
    companyId,
    entryDate: day.day,
    sourceType: 'OPENING',
    sourceDocNo: OPENING_DOC,
    narration: `Opening balances from AutoCount, imported by ${actorName}`,
    lines: lines.map((l) => ({ accountCode: text(l.accountCode), debitSen: l.debitSen, creditSen: l.creditSen })),
  });
  if (!r.ok) return { ok: false, error: r.reason ? `${r.status}: ${r.reason}` : r.status };
  // Another import won the race: these lines were not posted, that one was.
  if (r.status !== 'posted') return { ok: false, error: `The opening journal ${r.jeNo} is already in the books — reverse it first to import again.` };
  return { ok: true, jeNo: r.jeNo };
}

/** Reverse the OPENING journal on its own day, so the opening day nets to nothing and it can be imported again. */
export async function reverseOpeningJournal(sb: Db, companyId: number): Promise<{ ok: true; jeNo: string } | { ok: false; error: string }> {
  const existing = await activeOpening(sb, companyId);
  if (!existing.ok) return { ok: false, error: `The journal could not be read: ${existing.error}` };
  if (!existing.je) return { ok: false, error: 'There is no opening journal to reverse.' };
  const { data: deps, error: dErr } = await sb.from('journal_entries').select('id, reversed').eq('company_id', companyId).eq('source_type', 'OPENING_DEPOSITS');
  if (dErr) return { ok: false, error: `The journal could not be read: ${dErr.message}` };
  if (((deps ?? []) as Array<{ reversed: boolean | null }>).some((d) => !d.reversed)) {
    return { ok: false, error: 'The opening deposits are tagged on these balances: reverse the opening deposits first.' };
  }
  const r = await reverseJournal(sb, {
    sourceType: 'OPENING',
    jeId: existing.je.id,
    /* The contra's own source number, one per cycle: contras are never reversed, so a shared 'OPENING' would trip the
       one-active-source index on the second reversal's post and leave it unposted. The original is found by id. */
    sourceDocNo: `OPENING-REV-${existing.je.je_no}`,
    companyId,
    entryDate: existing.je.entry_date,
    narration: (orig) => `Reversal of ${orig.je_no} — opening balances withdrawn`,
  });
  if (!r.ok) return { ok: false, error: r.reason ? `${r.status}: ${r.reason}` : r.status };
  if (r.status !== 'reversed') return { ok: false, error: `The opening journal was not reversed (${r.status}).` };
  return { ok: true, jeNo: r.jeNo };
}

/** What is wrong with one row, shared by both lists; null when it can be imported. */
function rowProblem(row: { docNo: string; invoiceDate: string; dueDate: string; outstandingSen: number }, openingDay: string): string | null {
  if (!row.docNo) return 'The document number is empty.';
  if (!isDay(row.invoiceDate)) return 'The document date is not a date (YYYY-MM-DD).';
  if (!isDay(row.dueDate)) return 'The due date is not a date (YYYY-MM-DD).';
  if (row.invoiceDate > openingDay) return `Dated after ${openingDay}, the day the open documents stand at: it belongs in the books, not the opening lists.`;
  if (!Number.isInteger(row.outstandingSen) || row.outstandingSen === 0) return 'The outstanding amount must not be zero.';
  return null;
}

/** Every invoice (or bill) of the company, paged past PostgREST's row ceiling. */
async function allDocs<T>(sb: Db, table: 'sales_invoices' | 'purchase_invoices' | 'ap_invoices', companyId: number, columns: string): Promise<{ ok: true; rows: T[] } | { ok: false; error: string }> {
  const { data, error } = await paginateAll((from, to) => sb.from(table).select(columns).eq('company_id', companyId).order('id').range(from, to));
  if (error) return { ok: false, error: (error as { message?: string }).message ?? String(error) };
  return { ok: true, rows: (data ?? []) as T[] };
}

/** What the company's documents already say about each number: imported as an opening document, or raised in the
    ERP (an invoice made before the books started is in the ageing already — importing it again would count it
    twice). */
async function docIndex(sb: Db, table: 'sales_invoices' | 'purchase_invoices', companyId: number): Promise<{ ok: true; opening: Set<string>; raised: Map<string, string> } | { ok: false; error: string }> {
  const r = await allDocs<{ invoice_number: string; linked_ac_docno: string | null; opening_balance: boolean | null; status: string | null }>(
    sb, table, companyId, 'invoice_number, linked_ac_docno, opening_balance, status');
  if (!r.ok) return r;
  const opening = new Set<string>();
  const raised = new Map<string, string>();
  for (const d of r.rows) {
    if (d.opening_balance === true) { opening.add(String(d.linked_ac_docno ?? '')); continue; }
    if (String(d.status ?? '').toUpperCase() === 'CANCELLED') continue;
    raised.set(d.invoice_number, d.invoice_number);
    if (d.linked_ac_docno) raised.set(d.linked_ac_docno, d.invoice_number);
  }
  return { ok: true, opening, raised };
}

const alreadyRaised = (docNo: string, erpNo: string, noun: string): string =>
  `Already in the system as ${noun} ${erpNo}, raised in the ERP — it is in the ageing already, so it is not imported again.`;

type Pending = { docNo: string; row: Record<string, unknown> };
/* Rows per insert: each call is one of the Worker's limited subrequests, so a long list goes in a few. */
const CHUNK = 200;

/** Insert the rows a chunk at a time; a chunk the database refuses is retried row by row, so one bad row is named
    and the rest still go in. (Numbers are checked against the documents first, so a refused chunk is rare.) */
async function insertInChunks(sb: Db, table: string, todo: Pending[], out: OpeningImportResult, noun: string): Promise<void> {
  const why = (e: { code?: string; message: string }, docNo: string): string =>
    e.code === '23505' ? `The number ${docNo} is already used by another ${noun}.` : e.message;
  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK);
    const { error } = await sb.from(table).insert(chunk.map((p) => p.row));
    if (!error) { out.created += chunk.length; continue; }
    for (const p of chunk) {
      const one = await sb.from(table).insert(p.row);
      if (one.error) out.errors.push({ docNo: p.docNo, error: why(one.error, p.docNo) });
      else out.created += 1;
    }
  }
}

/** Import the invoices customers still owe as opening sales invoices (sent, posting nothing). A number already
    imported is skipped, so the same list can be uploaded again. */
export async function importOpeningReceivables(sb: Db, companyId: number, rows: OpeningArRow[], createdBy: string): Promise<OpeningImportResult> {
  const out: OpeningImportResult = { created: 0, skipped: 0, errors: [] };
  const todo: Pending[] = [];
  const day = await documentsDayOf(sb, companyId);
  if (!day.ok) return { ...out, errors: rows.map((r) => ({ docNo: text(r.docNo), error: day.error })) };
  const docs = await docIndex(sb, 'sales_invoices', companyId);
  if (!docs.ok) return { ...out, errors: rows.map((r) => ({ docNo: text(r.docNo), error: `The invoices could not be read: ${docs.error}` })) };
  const had = await sb.from('customer_credits').select('source_doc_no').eq('company_id', companyId).eq('source_type', OPENING_CREDIT);
  if (had.error) return { ...out, errors: rows.map((r) => ({ docNo: text(r.docNo), error: `The customer credits could not be read: ${had.error.message}` })) };
  const credits = new Set(((had.data ?? []) as Array<{ source_doc_no: string | null }>).map((x) => String(x.source_doc_no ?? '')));
  const creditsTodo: Pending[] = [];
  for (const raw of rows) {
    const row = { ...raw, docNo: text(raw.docNo), debtorName: text(raw.debtorName), debtorCode: text(raw.debtorCode) };
    if (docs.opening.has(row.docNo) || credits.has(row.docNo)) { out.skipped += 1; continue; }
    const erpNo = row.outstandingSen > 0 ? docs.raised.get(row.docNo) : undefined;
    const problem = rowProblem(row, day.day)
      ?? (erpNo ? alreadyRaised(row.docNo, erpNo, 'invoice') : null)
      ?? (row.debtorName ? null : 'The customer is empty.')
      ?? (row.debtorCode ? null : 'The customer code is empty: payments name the customer by it.');
    if (problem) { out.errors.push({ docNo: row.docNo, error: problem }); continue; }
    if (row.outstandingSen < 0) {
      /* Paid ahead: a credit the customer spends on later invoices, dated as AutoCount had it. */
      credits.add(row.docNo);
      creditsTodo.push({ docNo: row.docNo, row: {
        company_id: companyId, debtor_code: row.debtorCode, debtor_name: row.debtorName, entry_date: row.invoiceDate,
        amount_sen: -row.outstandingSen, source_type: OPENING_CREDIT, source_doc_no: row.docNo,
        notes: 'Paid ahead before the books started (AutoCount opening balance).',
      } });
      continue;
    }
    docs.opening.add(row.docNo);
    todo.push({ docNo: row.docNo, row: {
      company_id: companyId, invoice_number: row.docNo, linked_ac_docno: row.docNo, opening_balance: true, status: 'SENT',
      debtor_name: row.debtorName, debtor_code: row.debtorCode,
      invoice_date: row.invoiceDate, due_date: row.dueDate,
      subtotal_sen: row.outstandingSen, total_sen: row.outstandingSen, local_total_sen: row.outstandingSen, paid_sen: 0,
      created_by: createdBy,
    } });
  }
  await insertInChunks(sb, 'sales_invoices', todo, out, 'invoice');
  await insertInChunks(sb, 'customer_credits', creditsTodo, out, 'credit');
  return out;
}

/** Import the bills the company still owes as opening purchase invoices (posted, posting nothing). The supplier is
    found by its code; a code not in the supplier list is that row's error. */
export async function importOpeningPayables(sb: Db, companyId: number, rows: OpeningApRow[], createdBy: string): Promise<OpeningImportResult> {
  const out: OpeningImportResult = { created: 0, skipped: 0, errors: [] };
  const todo: Pending[] = [];
  const day = await documentsDayOf(sb, companyId);
  if (!day.ok) return { ...out, errors: rows.map((r) => ({ docNo: text(r.docNo), error: day.error })) };
  const docs = await docIndex(sb, 'purchase_invoices', companyId);
  if (!docs.ok) return { ...out, errors: rows.map((r) => ({ docNo: text(r.docNo), error: `The bills could not be read: ${docs.error}` })) };
  const { data: sups, error: supErr } = await paginateAll((from, to) => sb.from('suppliers').select('id, code, name, control_account').eq('company_id', companyId).order('id').range(from, to));
  if (supErr) return { ...out, errors: rows.map((r) => ({ docNo: text(r.docNo), error: `The suppliers could not be read: ${(supErr as { message?: string }).message ?? ''}` })) };
  const supplierList = (sups ?? []) as Array<{ id: string; code: string; name: string | null; control_account: string | null }>;
  const supplierByCode = new Map(supplierList.map((s) => [String(s.code).trim().toUpperCase(), s.id]));
  const supplierById = new Map(supplierList.map((s) => [s.id, s]));
  const pvs = await sb.from('payment_vouchers').select('pv_number').eq('company_id', companyId).eq('opening_balance', true);
  if (pvs.error) return { ...out, errors: rows.map((r) => ({ docNo: text(r.docNo), error: `The payment vouchers could not be read: ${pvs.error.message}` })) };
  const advanced = new Set(((pvs.data ?? []) as Array<{ pv_number: string }>).map((x) => x.pv_number));
  const advances: Array<{ docNo: string; supplierId: string; date: string; sen: number }> = [];
  for (const raw of rows) {
    const row = { ...raw, docNo: text(raw.docNo), supplierCode: text(raw.supplierCode) };
    if (docs.opening.has(row.docNo) || advanced.has(openingPvNo(row.docNo))) { out.skipped += 1; continue; }
    const supplierId = supplierByCode.get(row.supplierCode.toUpperCase());
    const erpNo = row.outstandingSen > 0 ? docs.raised.get(row.docNo) : undefined;
    const problem = rowProblem(row, day.day)
      ?? (erpNo ? alreadyRaised(row.docNo, erpNo, 'bill') : null)
      ?? (supplierId ? null : `No supplier has the code ${row.supplierCode || '(empty)'}.`);
    if (problem) { out.errors.push({ docNo: row.docNo, error: problem }); continue; }
    if (row.outstandingSen < 0) {
      advanced.add(openingPvNo(row.docNo));
      advances.push({ docNo: row.docNo, supplierId: supplierId!, date: row.invoiceDate, sen: -row.outstandingSen });
      continue;
    }
    docs.opening.add(row.docNo);
    todo.push({ docNo: row.docNo, row: {
      company_id: companyId, invoice_number: row.docNo, linked_ac_docno: row.docNo, opening_balance: true, status: 'POSTED',
      supplier_id: supplierId, invoice_date: row.invoiceDate, due_date: row.dueDate, currency: 'MYR', exchange_rate: 1,
      subtotal_sen: row.outstandingSen, total_sen: row.outstandingSen, paid_sen: 0,
      created_by: createdBy,
    } });
  }
  await insertInChunks(sb, 'purchase_invoices', todo, out, 'bill');
  if (advances.length) await importOpeningAdvances(sb, companyId, advances, supplierById, out);
  return out;
}

/** A supplier's minus: an opening voucher (posting nothing) and the advance it holds, a pair at a time so a voucher is
    never left without its advance. The voucher "pays" from the supplier's own control: it never meets a bank. */
async function importOpeningAdvances(sb: Db, companyId: number, advances: Array<{ docNo: string; supplierId: string; date: string; sen: number }>,
  supplierById: Map<string, { id: string; code: string; name: string | null; control_account: string | null }>, out: OpeningImportResult): Promise<void> {
  const roles = await resolveRoles(sb, companyId);
  for (const a of advances) {
    const sup = supplierById.get(a.supplierId)!;
    const pvNo = openingPvNo(a.docNo);
    const { data: pv, error } = await sb.from('payment_vouchers').insert({
      company_id: companyId, pv_number: pvNo, voucher_date: a.date, payee_name: sup.name || sup.code, supplier_id: a.supplierId,
      credit_account_code: apControlOf(roles, { code: sup.code, control_account: sup.control_account }),
      purpose: 'SUPPLIER_PAYMENT', total_sen: a.sen, status: 'POSTED', opening_balance: true,
      notes: `Paid ahead before the books started: AutoCount ${a.docNo}, not yet knocked off.`,
    }).select('id').single();
    if (error) { out.errors.push({ docNo: a.docNo, error: error.code === '23505' ? `The number ${pvNo} is already used by another payment voucher.` : error.message }); continue; }
    const pvId = (pv as { id: string }).id;
    const adv = await sb.from('acc_supplier_advances').insert({ company_id: companyId, supplier_id: a.supplierId, pv_id: pvId, pv_number: pvNo, amount_sen: a.sen, applied_sen: 0 });
    if (adv.error) {
      await sb.from('payment_vouchers').delete().eq('id', pvId);
      out.errors.push({ docNo: a.docNo, error: adv.error.message });
      continue;
    }
    out.created += 1;
  }
}

/** One control account against the documents that should explain it on the opening day. */
export type ControlLine = {
  role: 'AR' | 'AP' | 'AP_OTHER';
  accountCode: string;
  controlSen: number;
  documentsSen: number;
  /** Of those documents, the ones raised in the ERP (counted at what is still owed). */
  erpDocuments: number;
  /** Renovation contracts the ERP posted whole to the customer at signing, less what has been invoiced on them: the
      part of the control no invoice explains yet (acc/reno-ledger.ts). Customer controls only; 0 elsewhere. */
  unbilledContractsSen: number;
};

export type OpeningCheck = {
  ok: true;
  openingDay: string;
  /** The day the controls and documents are compared on: the documents' cut-over when set, else the opening day. */
  documentsDay: string;
  /** The OPENING journal now in the books, if any, and the day it is dated (a moved start date shows here). */
  openingJeNo: string | null;
  openingJeDate: string | null;
  /** Every posted line up to the opening day: equal sides, to be compared with AutoCount's trial balance. */
  trialDebitSen: number;
  trialCreditSen: number;
  controls: ControlLine[];
  banks: { accountCode: string; name: string; balanceSen: number }[];
  /** The journal is in, dated the opening day, and every control equals its documents. */
  balanced: boolean;
};

type CheckDoc = {
  total_sen: number | null; paid_sen: number | null; status: string | null; invoice_date: string | null;
  opening_balance: boolean | null; migrated_no_stock: boolean | null; supplier_id?: string | null; debtor_code?: string | null;
  /** A sales invoice settled from its order's deposit (paid_sen stays 0 on it). */
  so_deposit_applied_sen?: number | null; so_doc_no?: string | null;
};
type ContractLine = { source_type: string; source_doc_no: string | null; account_code: string; debit_sen: number; credit_sen: number; reversed: boolean | null };
/** The contract journals of acc/reno-ledger.ts: signing, change, cancel. */
const CONTRACT_SOURCES = ['RCON', 'RVO', 'RCAN'];

/** The figures on the opening day, side by side with what explains them. The documents side is the ageing as it
    stands for that day: the opening documents at their imported amount, plus anything raised in the ERP and dated
    before the books started (not posted, so the opening journal carries it too). */
export async function openingCheck(sb: Db, companyId: number): Promise<OpeningCheck | { ok: false; error: string }> {
  /* The controls and the documents are compared on the day the documents stand at (the cut-over when one is set). */
  const day = await documentsDayOf(sb, companyId);
  if (!day.ok) return day;
  const DOC_COLS = 'total_sen, paid_sen, status, invoice_date, opening_balance, migrated_no_stock';
  const [sums, roles, opening, chart, sis, pis, sups, debtors, credits, advances, apis, contracts] = await Promise.all([
    loadSums(sb, companyId, null, day.day),
    resolveRoles(sb, companyId),
    activeOpening(sb, companyId),
    paginateAll((from, to) => sb.from('accounts').select('account_code, account_name, acc_money, special_type').eq('company_id', companyId).order('account_code').range(from, to)),
    allDocs<CheckDoc>(sb, 'sales_invoices', companyId, `${DOC_COLS}, debtor_code, so_deposit_applied_sen, so_doc_no`),
    allDocs<CheckDoc>(sb, 'purchase_invoices', companyId, `${DOC_COLS}, supplier_id`),
    paginateAll((from, to) => sb.from('suppliers').select('id, code, control_account').eq('company_id', companyId).order('id').range(from, to)),
    paginateAll((from, to) => sb.from('debtors').select('code, control_account').eq('company_id', companyId).order('code').range(from, to)),
    /* What was paid ahead before the books started: it nets each control down (chew, 17 Nov 2026). */
    paginateAll((from, to) => sb.from('customer_credits').select('debtor_code, amount_sen').eq('company_id', companyId).eq('source_type', OPENING_CREDIT).order('id').range(from, to)),
    paginateAll((from, to) => sb.from('payment_vouchers').select('id, supplier_id, total_sen, status').eq('company_id', companyId).eq('opening_balance', true).order('id').range(from, to)),
    /* The ERP's own supplier bills (the AP invoices page), beside the procurement ones. */
    allDocs<CheckDoc>(sb, 'ap_invoices', companyId, 'total_sen, paid_sen, status, invoice_date, supplier_id'),
    paginateAll((from, to) => sb.from('v_gl_entries').select('source_type, source_doc_no, account_code, debit_sen, credit_sen, reversed')
      .eq('company_id', companyId).in('source_type', CONTRACT_SOURCES).lte('entry_date', day.day).order('line_id').range(from, to)),
  ]);
  if (!sums.ok) return { ok: false, error: `The ledger could not be read: ${sums.reason}` };
  if (!opening.ok) return { ok: false, error: `The journal could not be read: ${opening.error}` };
  if (chart.error) return { ok: false, error: `The chart could not be read: ${(chart.error as { message?: string }).message ?? ''}` };
  if (!sis.ok) return { ok: false, error: `The invoices could not be read: ${sis.error}` };
  if (!pis.ok) return { ok: false, error: `The bills could not be read: ${pis.error}` };
  if (sups.error) return { ok: false, error: `The suppliers could not be read: ${(sups.error as { message?: string }).message ?? ''}` };
  if (debtors.error) return { ok: false, error: `The customers could not be read: ${(debtors.error as { message?: string }).message ?? ''}` };
  if (credits.error) return { ok: false, error: `The customer credits could not be read: ${(credits.error as { message?: string }).message ?? ''}` };
  if (advances.error) return { ok: false, error: `The payment vouchers could not be read: ${(advances.error as { message?: string }).message ?? ''}` };
  if (!apis.ok) return { ok: false, error: `The AP invoices could not be read: ${apis.error}` };
  if (contracts.error) return { ok: false, error: `The renovation contracts could not be read: ${(contracts.error as { message?: string }).message ?? ''}` };
  const supplierOf = new Map(((sups.data ?? []) as Array<{ id: string; code: string; control_account: string | null }>).map((x) => [x.id, x]));
  const debtorControlOf = new Map(((debtors.data ?? []) as Array<{ code: string; control_account: string }>).map((x) => [x.code, x.control_account]));

  const net = (code: string): number => {
    const s = sums.sums.find((x) => x.code === code);
    return s ? s.drSen - s.crSen : 0;
  };
  /* What a document adds to the ageing on the opening day, or null when it is not there: cancelled and draft
     paper owes nothing, AutoCount's mirrored paper is AutoCount's, and anything dated after the day comes later. */
  const owed = (d: CheckDoc): { sen: number; erp: boolean } | null => {
    const st = String(d.status ?? '').toUpperCase();
    if (st === 'CANCELLED' || st === 'DRAFT' || d.migrated_no_stock === true) return null;
    if (d.opening_balance === true) return { sen: Number(d.total_sen ?? 0), erp: false };
    if (!d.invoice_date || d.invoice_date > day.day) return null;
    return { sen: Number(d.total_sen ?? 0) - Number(d.paid_sen ?? 0) - Number(d.so_deposit_applied_sen ?? 0), erp: true };
  };
  /* Each contract's net on its customer's control (a change or cancel is numbered <SO>-n), less what the ERP has
     invoiced on that order by the day: what the customer is down for that no invoice shows yet. */
  const contractOf = new Map<string, { account: string; sen: number }>();
  const contractLines = ((contracts.data ?? []) as ContractLine[]).filter((l) => l.reversed !== true && l.source_doc_no);
  const signed = new Set(contractLines.filter((l) => l.source_type === 'RCON').map((l) => String(l.source_doc_no)));
  const controlCodes = new Set([...debtorControlOf.values(), roles.AR]);
  for (const l of contractLines) {
    if (!controlCodes.has(l.account_code)) continue;
    const doc = String(l.source_doc_no);
    const so = signed.has(doc) ? doc : doc.replace(/-\d+$/, '');
    const c = contractOf.get(so) ?? { account: l.account_code, sen: 0 };
    c.sen += Number(l.debit_sen) - Number(l.credit_sen);
    contractOf.set(so, c);
  }
  const billedOn = new Map<string, number>();
  for (const d of sis.rows) {
    const so = d.so_doc_no ? String(d.so_doc_no) : '';
    if (!so || !contractOf.has(so) || d.opening_balance === true) continue;
    const st = String(d.status ?? '').toUpperCase();
    if (st === 'CANCELLED' || st === 'DRAFT' || !d.invoice_date || d.invoice_date > day.day) continue;
    billedOn.set(so, (billedOn.get(so) ?? 0) + Number(d.total_sen ?? 0));
  }
  const unbilledOn = new Map<string, number>();
  for (const [so, c] of contractOf) unbilledOn.set(c.account, (unbilledOn.get(c.account) ?? 0) + Math.max(0, c.sen - (billedOn.get(so) ?? 0)));
  const line = (role: ControlLine['role'], accountCode: string, sign: 1 | -1, docs: CheckDoc[]): ControlLine => {
    let documentsSen = 0;
    let erpDocuments = 0;
    for (const d of docs) {
      const o = owed(d);
      if (!o) continue;
      documentsSen += o.sen;
      if (o.erp) erpDocuments += 1;
    }
    return { role, accountCode, controlSen: sign * net(accountCode) || 0 /* never -0 */, documentsSen, erpDocuments, unbilledContractsSen: role === 'AR' ? unbilledOn.get(accountCode) ?? 0 : 0 };
  };
  /* Conts (finance phase 1.5): each invoice on its customer's control (scm.debtors), each bill on its supplier's
     (its control_account, else the 405- rule) — where every posting puts them. Every customer and supplier control
     of the chart gets a line, with documents or not (an opening balance there has to be explained too); the other
     debtors control (AR_OTHER) belongs to the Other Debtors bills, not to invoices, and stays out. */
  const arOf = (d: CheckDoc) => debtorControlOf.get(String(d.debtor_code ?? '')) ?? roles.AR;
  const apOf = (d: CheckDoc) => {
    const sup = supplierOf.get(String(d.supplier_id));
    return apControlOf(roles, { code: sup?.code ?? null, control_account: sup?.control_account ?? null });
  };
  const chartRows = (chart.data ?? []) as Array<{ account_code: string; account_name: string | null; acc_money: boolean | null; special_type?: string | null }>;
  const ordered = (first: string[], rest: Iterable<string>) => [...first, ...[...new Set(rest)].filter((x) => !first.includes(x)).sort()];
  /* Paid ahead, as minus documents: a customer's credit on their control, a supplier's opening voucher on theirs. */
  const aheadAr = ((credits.data ?? []) as Array<{ debtor_code: string; amount_sen: number }>)
    .map((x): CheckDoc => ({ total_sen: -Number(x.amount_sen), paid_sen: 0, status: 'SENT', invoice_date: null, opening_balance: true, migrated_no_stock: false, debtor_code: x.debtor_code }));
  const aheadAp = ((advances.data ?? []) as Array<{ supplier_id: string; total_sen: number; status: string }>)
    .map((x): CheckDoc => ({ total_sen: -Number(x.total_sen), paid_sen: 0, status: x.status, invoice_date: null, opening_balance: true, migrated_no_stock: false, supplier_id: x.supplier_id }));
  const arDocs = [...sis.rows, ...aheadAr];
  const apDocs = [...pis.rows, ...aheadAp, ...apis.rows.map((d): CheckDoc => ({ ...d, opening_balance: false, migrated_no_stock: false }))];
  const arCodes = ordered([roles.AR], [...arDocs.map(arOf), ...chartRows.filter((a) => a.special_type === 'SDC' && a.account_code !== roles.AR_OTHER).map((a) => a.account_code)]);
  const apCodes = ordered([roles.AP, roles.AP_OTHER], [...apDocs.map(apOf), ...chartRows.filter((a) => a.special_type === 'SCC').map((a) => a.account_code)]);
  const controls = [
    ...arCodes.map((code) => line('AR', code, 1, arDocs.filter((d) => arOf(d) === code))),
    ...apCodes.map((code) => line(code === roles.AP_OTHER ? 'AP_OTHER' : 'AP', code, -1, apDocs.filter((d) => apOf(d) === code))),
  ];

  const banks = chartRows
    .filter((a) => a.acc_money === true)
    .map((a) => ({ accountCode: a.account_code, name: a.account_name ?? a.account_code, balanceSen: net(a.account_code) }));
  return {
    ok: true,
    openingDay: day.openingDay,
    documentsDay: day.day,
    openingJeNo: opening.je?.je_no ?? null,
    openingJeDate: opening.je?.entry_date ?? null,
    trialDebitSen: sums.sums.reduce((t, s) => t + s.drSen, 0),
    trialCreditSen: sums.sums.reduce((t, s) => t + s.crSen, 0),
    controls, banks,
    balanced: opening.je != null && opening.je.entry_date === day.openingDay && controls.every((c) => c.controlSen === c.documentsSen + c.unbilledContractsSen),
  };
}

/* ── The documents' cut-over (chew, 17 Nov 2026) ─────────────────────────────────────────────────────────────────── */
export type CutoverPlan = {
  asOf: string;
  remove: { invoices: number; credits: number; bills: number; advances: number };
  /** Opening documents the ERP has already settled against (a payment, a credit spent, an allocation): kept as they are. */
  kept: { docNo: string; why: string }[];
  incoming: { receivables: number; payables: number };
};
export type CutoverResult = CutoverPlan & { done: boolean; receivables?: OpeningImportResult; payables?: OpeningImportResult };

/** The open documents brought to AutoCount's as at `asOf` (the day it stopped keeping the books): the opening ones the
    ERP has not touched are taken out (they post nothing: their money is in the OPENING journal, and AutoCount's ledger
    after it came in as journals), the cut-over is set, and AutoCount's open documents on that day go in as the opening
    lists do. The ledger does not move. `dryRun` says what would happen and changes nothing. */
export async function cutoverDocuments(sb: Db, companyId: number, asOf: string, ar: OpeningArRow[], ap: OpeningApRow[], createdBy: string, dryRun: boolean): Promise<CutoverResult | { ok: false; error: string }> {
  const opening = await openingDayOf(sb, companyId);
  if (!opening.ok) return opening;
  if (!isDay(asOf) || asOf <= opening.day) return { ok: false, error: `The cut-over must be a day after ${opening.day}.` };
  const read = async (q: any) => { const { data, error } = await q; if (error) throw new Error(error.message); return (data ?? []) as any[]; };
  try {
    const sis = await read(sb.from('sales_invoices').select('id, invoice_number, paid_sen').eq('company_id', companyId).eq('opening_balance', true));
    const siPaid = sis.length ? await read(sb.from('sales_invoice_payments').select('sales_invoice_id').in('sales_invoice_id', sis.map((x) => x.id))) : [];
    const credits = await read(sb.from('customer_credits').select('id, debtor_code, source_doc_no').eq('company_id', companyId).eq('source_type', OPENING_CREDIT));
    const spent = credits.length ? await read(sb.from('customer_credits').select('debtor_code').eq('company_id', companyId).in('debtor_code', [...new Set(credits.map((c) => c.debtor_code))]).neq('source_type', OPENING_CREDIT)) : [];
    const pis = await read(sb.from('purchase_invoices').select('id, invoice_number, paid_sen').eq('company_id', companyId).eq('opening_balance', true));
    const piPaid = pis.length ? await read(sb.from('pv_allocations').select('pi_id').in('pi_id', pis.map((x) => x.id))) : [];
    const pvs = await read(sb.from('payment_vouchers').select('id, pv_number').eq('company_id', companyId).eq('opening_balance', true));
    const advs = pvs.length ? await read(sb.from('acc_supplier_advances').select('pv_id, applied_sen').in('pv_id', pvs.map((x) => x.id))) : [];

    const kept: { docNo: string; why: string }[] = [];
    const paidSi = new Set(siPaid.map((p) => p.sales_invoice_id));
    const siGo = sis.filter((x) => { const k = Number(x.paid_sen) > 0 || paidSi.has(x.id); if (k) kept.push({ docNo: x.invoice_number, why: 'a payment in the ERP' }); return !k; });
    const spentBy = new Set(spent.map((c) => c.debtor_code));
    const crGo = credits.filter((x) => { const k = spentBy.has(x.debtor_code); if (k) kept.push({ docNo: x.source_doc_no, why: 'the customer has spent or added credit in the ERP' }); return !k; });
    const paidPi = new Set(piPaid.map((p) => p.pi_id));
    const piGo = pis.filter((x) => { const k = Number(x.paid_sen) > 0 || paidPi.has(x.id); if (k) kept.push({ docNo: x.invoice_number, why: 'a payment in the ERP' }); return !k; });
    const used = new Set(advs.filter((a) => Number(a.applied_sen) > 0).map((a) => a.pv_id));
    const pvGo = pvs.filter((x) => { const k = used.has(x.id); if (k) kept.push({ docNo: x.pv_number, why: 'its advance is knocked off in the ERP' }); return !k; });

    const plan: CutoverPlan = { asOf, remove: { invoices: siGo.length, credits: crGo.length, bills: piGo.length, advances: pvGo.length }, kept, incoming: { receivables: ar.length, payables: ap.length } };
    if (dryRun) return { ...plan, done: false };

    const del = async (table: string, ids: string[]) => {
      for (let i = 0; i < ids.length; i += 200) { const { error } = await sb.from(table).delete().in('id', ids.slice(i, i + 200)); if (error) throw new Error(`${table}: ${error.message}`); }
    };
    await del('customer_credits', crGo.map((x) => x.id));
    await del('sales_invoices', siGo.map((x) => x.id));
    await del('purchase_invoices', piGo.map((x) => x.id));
    for (let i = 0; i < pvGo.length; i += 200) {
      const ids = pvGo.slice(i, i + 200).map((x) => x.id);
      const a = await sb.from('acc_supplier_advances').delete().in('pv_id', ids); if (a.error) throw new Error(`acc_supplier_advances: ${a.error.message}`);
    }
    await del('payment_vouchers', pvGo.map((x) => x.id));
    const set = await sb.from('acc_company_settings').update({ documents_cutover_date: asOf }).eq('company_id', companyId);
    if (set.error) throw new Error(`settings: ${set.error.message}`);
    const receivables = ar.length ? await importOpeningReceivables(sb, companyId, ar, createdBy) : undefined;
    const payables = ap.length ? await importOpeningPayables(sb, companyId, ap, createdBy) : undefined;
    return { ...plan, done: true, receivables, payables };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
