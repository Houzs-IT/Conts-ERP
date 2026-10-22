// Conts only (not part of Houzs's code): the opening balances (finance phase 1, spec 3.8). On the day before the books
// start in the engine the ledger takes over from AutoCount:
//   · one OPENING journal — every account's balance from AutoCount's trial balance, the debtors and creditors controls
//     included (the only journal besides a document's that may name them);
//   · the invoices customers still owe and the bills the company still owes, as opening documents (migration 0136):
//     they post nothing — their money is in the journal — but sit in the ageing and settle as usual;
//   · a check that the two agree, and that the trial balance and each bank read as AutoCount's.
import { postJournal, reverseJournal } from './engine';
import { loadLedgerSettings } from './ledger-settings';
import { resolveRoles } from './rules';
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
    lines: lines.map((l) => ({ accountCode: String(l.accountCode ?? '').trim(), debitSen: l.debitSen, creditSen: l.creditSen })),
  });
  if (!r.ok) return { ok: false, error: r.reason ? `${r.status}: ${r.reason}` : r.status };
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

/** The AutoCount numbers already imported as opening documents of this company. */
async function importedDocNos(sb: Db, table: 'sales_invoices' | 'purchase_invoices', companyId: number): Promise<{ ok: true; set: Set<string> } | { ok: false; error: string }> {
  const { data, error } = await sb.from(table).select('linked_ac_docno, opening_balance')
    .eq('company_id', companyId).eq('opening_balance', true);
  if (error) return { ok: false, error: error.message };
  return { ok: true, set: new Set(((data ?? []) as Array<{ linked_ac_docno: string | null }>).map((r) => String(r.linked_ac_docno ?? ''))) };
}

type Pending = { docNo: string; row: Record<string, unknown> };
/* Rows per insert: each call is one of the Worker's limited subrequests, so a long list goes in a few. */
const CHUNK = 200;

/** Insert the rows a chunk at a time; a chunk the database refuses is retried row by row, so one bad row is named
    and the rest still go in. */
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
  if (!day.ok) return { ...out, errors: rows.map((r) => ({ docNo: String(r.docNo ?? ''), error: day.error })) };
  const seen = await importedDocNos(sb, 'sales_invoices', companyId);
  if (!seen.ok) return { ...out, errors: rows.map((r) => ({ docNo: String(r.docNo ?? ''), error: `The invoices could not be read: ${seen.error}` })) };
  for (const raw of rows) {
    const row = { ...raw, docNo: String(raw.docNo ?? '').trim(), debtorName: String(raw.debtorName ?? '').trim() };
    if (seen.set.has(row.docNo)) { out.skipped += 1; continue; }
    const problem = rowProblem(row, day.day) ?? (row.debtorName ? null : 'The customer is empty.');
    if (problem) { out.errors.push({ docNo: row.docNo, error: problem }); continue; }
    seen.set.add(row.docNo);
    todo.push({ docNo: row.docNo, row: {
      company_id: companyId, invoice_number: row.docNo, linked_ac_docno: row.docNo, opening_balance: true, status: 'SENT',
      debtor_name: row.debtorName, debtor_code: raw.debtorCode ? String(raw.debtorCode).trim() : null,
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
  if (!day.ok) return { ...out, errors: rows.map((r) => ({ docNo: String(r.docNo ?? ''), error: day.error })) };
  const seen = await importedDocNos(sb, 'purchase_invoices', companyId);
  if (!seen.ok) return { ...out, errors: rows.map((r) => ({ docNo: String(r.docNo ?? ''), error: `The bills could not be read: ${seen.error}` })) };
  const { data: sups, error: supErr } = await sb.from('suppliers').select('id, code').eq('company_id', companyId);
  if (supErr) return { ...out, errors: rows.map((r) => ({ docNo: String(r.docNo ?? ''), error: `The suppliers could not be read: ${supErr.message}` })) };
  const supplierByCode = new Map(((sups ?? []) as Array<{ id: string; code: string }>).map((s) => [String(s.code).trim().toUpperCase(), s.id]));
  for (const raw of rows) {
    const row = { ...raw, docNo: String(raw.docNo ?? '').trim(), supplierCode: String(raw.supplierCode ?? '').trim() };
    if (seen.set.has(row.docNo)) { out.skipped += 1; continue; }
    const supplierId = supplierByCode.get(row.supplierCode.toUpperCase());
    const problem = rowProblem(row, day.day) ?? (supplierId ? null : `No supplier has the code ${row.supplierCode || '(empty)'}.`);
    if (problem) { out.errors.push({ docNo: row.docNo, error: problem }); continue; }
    seen.set.add(row.docNo);
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

export type OpeningCheck = {
  ok: true;
  openingDay: string;
  /** The OPENING journal now in the books, if any. */
  openingJeNo: string | null;
  /** Every posted line up to the opening day: equal sides, to be compared with AutoCount's trial balance. */
  trialDebitSen: number;
  trialCreditSen: number;
  arControlSen: number;
  arDocumentsSen: number;
  apControlSen: number;
  apDocumentsSen: number;
  banks: { accountCode: string; name: string; balanceSen: number }[];
  /** The journal is in, and the debtors and creditors controls equal their opening documents. */
  balanced: boolean;
};

/** The figures on the opening day, side by side with what explains them. */
export async function openingCheck(sb: Db, companyId: number): Promise<OpeningCheck | { ok: false; error: string }> {
  const day = await openingDayOf(sb, companyId);
  if (!day.ok) return day;
  const [sums, roles, opening, chart, sis, pis] = await Promise.all([
    loadSums(sb, companyId, null, day.day),
    resolveRoles(sb, companyId),
    activeOpening(sb, companyId),
    sb.from('accounts').select('account_code, account_name, acc_money').eq('company_id', companyId),
    sb.from('sales_invoices').select('total_sen, status, opening_balance').eq('company_id', companyId).eq('opening_balance', true),
    sb.from('purchase_invoices').select('total_sen, status, opening_balance').eq('company_id', companyId).eq('opening_balance', true),
  ]);
  if (!sums.ok) return { ok: false, error: `The ledger could not be read: ${sums.reason}` };
  if (!opening.ok) return { ok: false, error: `The journal could not be read: ${opening.error}` };
  for (const r of [chart, sis, pis]) if (r.error) return { ok: false, error: r.error.message };

  const net = (code: string): number => {
    const s = sums.sums.find((x) => x.code === code);
    return s ? s.drSen - s.crSen : 0;
  };
  const docsTotal = (rows: unknown): number => ((rows ?? []) as Array<{ total_sen: number | null; status: string | null }>)
    .filter((r) => String(r.status ?? '').toUpperCase() !== 'CANCELLED')
    .reduce((t, r) => t + Number(r.total_sen ?? 0), 0);

  const arControlSen = net(roles.AR);
  const apControlSen = -net(roles.AP);
  const arDocumentsSen = docsTotal(sis.data);
  const apDocumentsSen = docsTotal(pis.data);
  const banks = ((chart.data ?? []) as Array<{ account_code: string; account_name: string | null; acc_money: boolean | null }>)
    .filter((a) => a.acc_money === true)
    .sort((a, b) => a.account_code.localeCompare(b.account_code))
    .map((a) => ({ accountCode: a.account_code, name: a.account_name ?? a.account_code, balanceSen: net(a.account_code) }));
  return {
    ok: true,
    openingDay: day.day,
    openingJeNo: opening.je?.je_no ?? null,
    trialDebitSen: sums.sums.reduce((t, s) => t + s.drSen, 0),
    trialCreditSen: sums.sums.reduce((t, s) => t + s.crSen, 0),
    arControlSen, arDocumentsSen, apControlSen, apDocumentsSen, banks,
    balanced: opening.je != null && arControlSen === arDocumentsSen && apControlSen === apDocumentsSen,
  };
}
