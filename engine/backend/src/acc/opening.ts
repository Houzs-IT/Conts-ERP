// Conts only (not part of Houzs's code): the opening balances (finance phase 1, spec 3.8). On the day before the books
// start in the engine the ledger takes over from AutoCount:
//   · one OPENING journal — every account's balance from AutoCount's trial balance, the debtors and creditors controls
//     included (the only journal besides a document's that may name them);
//   · the invoices customers still owe and the bills the company still owes, as opening documents (migration 0136):
//     they post nothing — their money is in the journal — but sit in the ageing and settle as usual;
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
  if (row.invoiceDate > openingDay) return `Dated after the opening day ${openingDay}: it belongs in the books, not the opening balances.`;
  if (!Number.isInteger(row.outstandingSen) || row.outstandingSen <= 0) return 'The outstanding amount must be more than zero.';
  return null;
}

/** Every invoice (or bill) of the company, paged past PostgREST's row ceiling. */
async function allDocs<T>(sb: Db, table: 'sales_invoices' | 'purchase_invoices', companyId: number, columns: string): Promise<{ ok: true; rows: T[] } | { ok: false; error: string }> {
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
  const day = await openingDayOf(sb, companyId);
  if (!day.ok) return { ...out, errors: rows.map((r) => ({ docNo: text(r.docNo), error: day.error })) };
  const docs = await docIndex(sb, 'sales_invoices', companyId);
  if (!docs.ok) return { ...out, errors: rows.map((r) => ({ docNo: text(r.docNo), error: `The invoices could not be read: ${docs.error}` })) };
  for (const raw of rows) {
    const row = { ...raw, docNo: text(raw.docNo), debtorName: text(raw.debtorName), debtorCode: text(raw.debtorCode) };
    if (docs.opening.has(row.docNo)) { out.skipped += 1; continue; }
    const erpNo = docs.raised.get(row.docNo);
    const problem = rowProblem(row, day.day)
      ?? (erpNo ? alreadyRaised(row.docNo, erpNo, 'invoice') : null)
      ?? (row.debtorName ? null : 'The customer is empty.')
      ?? (row.debtorCode ? null : 'The customer code is empty: payments name the customer by it.');
    if (problem) { out.errors.push({ docNo: row.docNo, error: problem }); continue; }
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
  return out;
}

/** Import the bills the company still owes as opening purchase invoices (posted, posting nothing). The supplier is
    found by its code; a code not in the supplier list is that row's error. */
export async function importOpeningPayables(sb: Db, companyId: number, rows: OpeningApRow[], createdBy: string): Promise<OpeningImportResult> {
  const out: OpeningImportResult = { created: 0, skipped: 0, errors: [] };
  const todo: Pending[] = [];
  const day = await openingDayOf(sb, companyId);
  if (!day.ok) return { ...out, errors: rows.map((r) => ({ docNo: text(r.docNo), error: day.error })) };
  const docs = await docIndex(sb, 'purchase_invoices', companyId);
  if (!docs.ok) return { ...out, errors: rows.map((r) => ({ docNo: text(r.docNo), error: `The bills could not be read: ${docs.error}` })) };
  const { data: sups, error: supErr } = await paginateAll((from, to) => sb.from('suppliers').select('id, code').eq('company_id', companyId).order('id').range(from, to));
  if (supErr) return { ...out, errors: rows.map((r) => ({ docNo: text(r.docNo), error: `The suppliers could not be read: ${(supErr as { message?: string }).message ?? ''}` })) };
  const supplierByCode = new Map(((sups ?? []) as Array<{ id: string; code: string }>).map((s) => [String(s.code).trim().toUpperCase(), s.id]));
  for (const raw of rows) {
    const row = { ...raw, docNo: text(raw.docNo), supplierCode: text(raw.supplierCode) };
    if (docs.opening.has(row.docNo)) { out.skipped += 1; continue; }
    const supplierId = supplierByCode.get(row.supplierCode.toUpperCase());
    const erpNo = docs.raised.get(row.docNo);
    const problem = rowProblem(row, day.day)
      ?? (erpNo ? alreadyRaised(row.docNo, erpNo, 'bill') : null)
      ?? (supplierId ? null : `No supplier has the code ${row.supplierCode || '(empty)'}.`);
    if (problem) { out.errors.push({ docNo: row.docNo, error: problem }); continue; }
    docs.opening.add(row.docNo);
    todo.push({ docNo: row.docNo, row: {
      company_id: companyId, invoice_number: row.docNo, linked_ac_docno: row.docNo, opening_balance: true, status: 'POSTED',
      supplier_id: supplierId, invoice_date: row.invoiceDate, due_date: row.dueDate, currency: 'MYR', exchange_rate: 1,
      subtotal_sen: row.outstandingSen, total_sen: row.outstandingSen, paid_sen: 0,
      created_by: createdBy,
    } });
  }
  await insertInChunks(sb, 'purchase_invoices', todo, out, 'bill');
  return out;
}

/** One control account against the documents that should explain it on the opening day. */
export type ControlLine = {
  role: 'AR' | 'AP' | 'AP_OTHER';
  accountCode: string;
  controlSen: number;
  documentsSen: number;
  /** Of those documents, the ones raised in the ERP before the books started (counted at what is still owed). */
  erpDocuments: number;
};

export type OpeningCheck = {
  ok: true;
  openingDay: string;
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
};

/** The figures on the opening day, side by side with what explains them. The documents side is the ageing as it
    stands for that day: the opening documents at their imported amount, plus anything raised in the ERP and dated
    before the books started (not posted, so the opening journal carries it too). */
export async function openingCheck(sb: Db, companyId: number): Promise<OpeningCheck | { ok: false; error: string }> {
  const day = await openingDayOf(sb, companyId);
  if (!day.ok) return day;
  const DOC_COLS = 'total_sen, paid_sen, status, invoice_date, opening_balance, migrated_no_stock';
  const [sums, roles, opening, chart, sis, pis, sups, debtors] = await Promise.all([
    loadSums(sb, companyId, null, day.day),
    resolveRoles(sb, companyId),
    activeOpening(sb, companyId),
    paginateAll((from, to) => sb.from('accounts').select('account_code, account_name, acc_money, special_type').eq('company_id', companyId).order('account_code').range(from, to)),
    allDocs<CheckDoc>(sb, 'sales_invoices', companyId, `${DOC_COLS}, debtor_code`),
    allDocs<CheckDoc>(sb, 'purchase_invoices', companyId, `${DOC_COLS}, supplier_id`),
    paginateAll((from, to) => sb.from('suppliers').select('id, code, control_account').eq('company_id', companyId).order('id').range(from, to)),
    paginateAll((from, to) => sb.from('debtors').select('code, control_account').eq('company_id', companyId).order('code').range(from, to)),
  ]);
  if (!sums.ok) return { ok: false, error: `The ledger could not be read: ${sums.reason}` };
  if (!opening.ok) return { ok: false, error: `The journal could not be read: ${opening.error}` };
  if (chart.error) return { ok: false, error: `The chart could not be read: ${(chart.error as { message?: string }).message ?? ''}` };
  if (!sis.ok) return { ok: false, error: `The invoices could not be read: ${sis.error}` };
  if (!pis.ok) return { ok: false, error: `The bills could not be read: ${pis.error}` };
  if (sups.error) return { ok: false, error: `The suppliers could not be read: ${(sups.error as { message?: string }).message ?? ''}` };
  if (debtors.error) return { ok: false, error: `The customers could not be read: ${(debtors.error as { message?: string }).message ?? ''}` };
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
    return { sen: Number(d.total_sen ?? 0) - Number(d.paid_sen ?? 0), erp: true };
  };
  const line = (role: ControlLine['role'], accountCode: string, sign: 1 | -1, docs: CheckDoc[]): ControlLine => {
    let documentsSen = 0;
    let erpDocuments = 0;
    for (const d of docs) {
      const o = owed(d);
      if (!o) continue;
      documentsSen += o.sen;
      if (o.erp) erpDocuments += 1;
    }
    return { role, accountCode, controlSen: sign * net(accountCode) || 0 /* never -0 */, documentsSen, erpDocuments };
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
  const arCodes = ordered([roles.AR], [...sis.rows.map(arOf), ...chartRows.filter((a) => a.special_type === 'SDC' && a.account_code !== roles.AR_OTHER).map((a) => a.account_code)]);
  const apCodes = ordered([roles.AP, roles.AP_OTHER], [...pis.rows.map(apOf), ...chartRows.filter((a) => a.special_type === 'SCC').map((a) => a.account_code)]);
  const controls = [
    ...arCodes.map((code) => line('AR', code, 1, sis.rows.filter((d) => arOf(d) === code))),
    ...apCodes.map((code) => line(code === roles.AP_OTHER ? 'AP_OTHER' : 'AP', code, -1, pis.rows.filter((d) => apOf(d) === code))),
  ];

  const banks = chartRows
    .filter((a) => a.acc_money === true)
    .map((a) => ({ accountCode: a.account_code, name: a.account_name ?? a.account_code, balanceSen: net(a.account_code) }));
  return {
    ok: true,
    openingDay: day.day,
    openingJeNo: opening.je?.je_no ?? null,
    openingJeDate: opening.je?.entry_date ?? null,
    trialDebitSen: sums.sums.reduce((t, s) => t + s.drSen, 0),
    trialCreditSen: sums.sums.reduce((t, s) => t + s.crSen, 0),
    controls, banks,
    balanced: opening.je != null && opening.je.entry_date === day.day && controls.every((c) => c.controlSen === c.documentsSen),
  };
}
