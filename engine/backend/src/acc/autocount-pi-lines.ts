// Conts only: what AutoCount's purchase invoices said, line by line, view only (chew, 18 + 24 Nov 2026; migration 0370).
// The ACJ journal of an AutoCount PI (acc/autocount-journals.ts) kept its accounts; AutoCount's Purchase journal listing
// also has each line's description and project, and the supplier's own invoice number (Ref 2). Those lines are kept
// here as AutoCount printed them and post nothing. An opening bill (purchase_invoices.opening_balance) is the open
// balance of one such PI: it is linked to it by its supplier and invoice number, so the bill's page can show the lines.
import { paginateAll } from '../scm/lib/paginate-all';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as everywhere in acc/ */
type Db = any;

export const AUTOCOUNT_PI_MAX = 200;

export interface AutocountPiLineIn {
  accountCode: string; accountDesc?: string | null; project?: string | null; description?: string | null;
  debitSen: number; creditSen: number;
}
export interface AutocountPiIn { piNo: string; date: string; supplierCode: string; supplierRef?: string | null; lines: AutocountPiLineIn[] }
export type AutocountPiResult = {
  stored: number; lines: number; errors: { piNo: string; error: string }[];
  linked: { docNo: string; piNo: string }[]; ambiguous: { docNo: string; piNos: string[] }[]; unlinked: number;
};

const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const isSen = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** The invoice number as compared: spaces and case do not count ("JY5030 PI" is "jy5030pi"). */
export const refKey = (v: string | null | undefined): string => String(v ?? '').replace(/\s+/g, '').toUpperCase();

/** The keys an opening bill is found under. A bill AutoCount gave no number of its own, or one its supplier repeats,
 *  was opened as "<ref> <supplier> <day>" ("1 400-P002 2026-10-31", "NO NO 400-C010 2026-04-17"): it is that ref on
 *  that day. Any other is its number alone. */
export function openingBillKey(invoiceNumber: string, supplierCode: string): string {
  const m = /^(.*\S)\s+(\S+)\s+(\d{4}-\d{2}-\d{2})$/.exec(invoiceNumber.trim());
  if (m && m[2].toUpperCase() === supplierCode.toUpperCase()) return `${supplierCode}|${refKey(m[1])}|${m[3]}`;
  return `${supplierCode}|${refKey(invoiceNumber)}`;
}

/** The keys an AutoCount PI answers to: its ref alone, and its ref on its day. */
export const piKeys = (supplierCode: string, supplierRef: string, date: string): string[] =>
  [`${supplierCode}|${refKey(supplierRef)}`, `${supplierCode}|${refKey(supplierRef)}|${date}`];

/** Pairs opening bills with PIs. A key two PIs answer to links nothing: which one it is, is for a person to say. */
export function matchOpeningBills(
  bills: { id: string; invoiceNumber: string; supplierCode: string }[],
  pis: { piNo: string; supplierCode: string; supplierRef: string | null; date: string }[],
): { links: { id: string; docNo: string; piNo: string }[]; ambiguous: { docNo: string; piNos: string[] }[]; unlinked: number } {
  const byKey = new Map<string, Set<string>>();
  for (const p of pis) {
    if (!refKey(p.supplierRef)) continue;
    for (const k of piKeys(p.supplierCode, p.supplierRef!, p.date)) {
      if (!byKey.has(k)) byKey.set(k, new Set());
      byKey.get(k)!.add(p.piNo);
    }
  }
  const links: { id: string; docNo: string; piNo: string }[] = [];
  const ambiguous: { docNo: string; piNos: string[] }[] = [];
  let unlinked = 0;
  for (const b of bills) {
    const hit = byKey.get(openingBillKey(b.invoiceNumber, b.supplierCode));
    if (!hit) { unlinked++; continue; }
    if (hit.size > 1) { ambiguous.push({ docNo: b.invoiceNumber, piNos: [...hit].sort() }); continue; }
    links.push({ id: b.id, docNo: b.invoiceNumber, piNo: [...hit][0] });
  }
  return { links, ambiguous, unlinked };
}

function checkPi(raw: AutocountPiIn): string | null {
  if (!text(raw.piNo)) return 'The PI number is missing.';
  if (!isDay(text(raw.date))) return 'The date must be YYYY-MM-DD.';
  if (!text(raw.supplierCode)) return 'The supplier is missing.';
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) return 'The PI has no lines.';
  for (const l of raw.lines) {
    if (!text(l.accountCode)) return 'A line has no account.';
    if (!isSen(l.debitSen) || !isSen(l.creditSen)) return 'Amounts are whole sen, not negative.';
  }
  return null;
}

/** Keeps the PIs' lines (each PI's replaced whole), then links every opening bill it can to its PI. */
export async function importAutocountPiLines(sb: Db, companyId: number, pis: AutocountPiIn[], dryRun: boolean): Promise<AutocountPiResult | { ok: false; error: string }> {
  const out: AutocountPiResult = { stored: 0, lines: 0, errors: [], linked: [], ambiguous: [], unlinked: 0 };
  const good: AutocountPiIn[] = [];
  for (const p of pis) {
    const why = checkPi(p);
    if (why) out.errors.push({ piNo: text(p.piNo) || '?', error: why });
    else good.push(p);
  }
  if (!dryRun && good.length) {
    const nos = good.map((p) => text(p.piNo));
    const del = await sb.from('acc_autocount_pi_lines').delete().eq('company_id', companyId).in('pi_no', nos);
    if (del.error) return { ok: false, error: del.error.message };
    const rows = good.flatMap((p) => p.lines.map((l, i) => ({
      company_id: companyId, pi_no: text(p.piNo), line_no: i + 1, doc_date: text(p.date),
      supplier_code: text(p.supplierCode), supplier_ref: text(p.supplierRef) || null,
      account_code: text(l.accountCode), account_desc: text(l.accountDesc) || null, project: text(l.project) || null,
      description: text(l.description) || null, debit_sen: l.debitSen, credit_sen: l.creditSen,
    })));
    for (let i = 0; i < rows.length; i += 500) {
      const ins = await sb.from('acc_autocount_pi_lines').insert(rows.slice(i, i + 500));
      if (ins.error) return { ok: false, error: ins.error.message };
    }
    out.stored = good.length;
    out.lines = rows.length;
  }

  // Every PI kept so far (this call's too, on a dry run), against every opening bill.
  const kept = await paginateAll<{ pi_no: string; supplier_code: string; supplier_ref: string | null; doc_date: string }>((from, to) =>
    sb.from('acc_autocount_pi_lines').select('pi_no, supplier_code, supplier_ref, doc_date').eq('company_id', companyId).eq('line_no', 1)
      .order('pi_no').range(from, to));
  if (kept.error) return { ok: false, error: kept.error.message };
  const piList = new Map<string, { piNo: string; supplierCode: string; supplierRef: string | null; date: string }>();
  for (const r of kept.data ?? []) piList.set(r.pi_no, { piNo: r.pi_no, supplierCode: r.supplier_code, supplierRef: r.supplier_ref, date: String(r.doc_date).slice(0, 10) });
  if (dryRun) for (const p of good) piList.set(text(p.piNo), { piNo: text(p.piNo), supplierCode: text(p.supplierCode), supplierRef: text(p.supplierRef) || null, date: text(p.date) });

  const bills = await paginateAll<{ id: string; invoice_number: string; autocount_pi_no: string | null; supplier: { code: string | null } | { code: string | null }[] | null }>((from, to) =>
    sb.from('purchase_invoices').select('id, invoice_number, autocount_pi_no, supplier:suppliers(code)').eq('company_id', companyId)
      .eq('opening_balance', true).neq('status', 'CANCELLED').order('id').range(from, to));
  if (bills.error) return { ok: false, error: bills.error.message };
  const billRows = (bills.data ?? []).map((b) => {
    const s = Array.isArray(b.supplier) ? b.supplier[0] : b.supplier;
    return { id: b.id, invoiceNumber: b.invoice_number, supplierCode: s?.code ?? '', current: b.autocount_pi_no };
  }).filter((b) => b.supplierCode);
  const m = matchOpeningBills(billRows, [...piList.values()]);
  out.ambiguous = m.ambiguous;
  out.unlinked = m.unlinked;
  const current = new Map(billRows.map((b) => [b.id, b.current]));
  for (const l of m.links) {
    out.linked.push({ docNo: l.docNo, piNo: l.piNo });
    if (dryRun || current.get(l.id) === l.piNo) continue;
    const up = await sb.from('purchase_invoices').update({ autocount_pi_no: l.piNo }).eq('company_id', companyId).eq('id', l.id);
    if (up.error) return { ok: false, error: up.error.message };
  }
  return out;
}

export interface AutocountPiView {
  piNo: string; date: string; supplierRef: string | null;
  lines: { description: string | null; project: string | null; accountCode: string; accountDesc: string | null; amountSen: number }[];
  totalSen: number;
}

/** An AutoCount PI as its bill's page shows it: the lines off the supplier's account (what was bought, where it was
 *  charged), each debit less credit, and the total the supplier was credited. */
export function piView(rows: { pi_no: string; doc_date: string; supplier_code: string; supplier_ref: string | null; account_code: string; account_desc: string | null; project: string | null; description: string | null; debit_sen: number; credit_sen: number; line_no: number }[]): AutocountPiView | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => a.line_no - b.line_no);
  const head = sorted[0];
  const onSupplier = (r: typeof head) => r.account_code.toUpperCase() === head.supplier_code.toUpperCase();
  const lines = sorted.filter((r) => !onSupplier(r)).map((r) => ({
    description: r.description, project: r.project, accountCode: r.account_code, accountDesc: r.account_desc,
    amountSen: Number(r.debit_sen) - Number(r.credit_sen),
  }));
  const totalSen = sorted.filter(onSupplier).reduce((s, r) => s + Number(r.credit_sen) - Number(r.debit_sen), 0);
  return { piNo: head.pi_no, date: String(head.doc_date).slice(0, 10), supplierRef: head.supplier_ref, lines, totalSen };
}

/** The AutoCount PI behind an opening bill, or null. Fail-soft: a read that fails shows no lines rather than no bill. */
export async function autocountPiFor(sb: Db, companyId: number, piNo: string | null | undefined): Promise<AutocountPiView | null> {
  if (!piNo) return null;
  const { data, error } = await sb.from('acc_autocount_pi_lines')
    .select('pi_no, doc_date, supplier_code, supplier_ref, account_code, account_desc, project, description, debit_sen, credit_sen, line_no')
    .eq('company_id', companyId).eq('pi_no', piNo).order('line_no');
  if (error) return null;
  return piView(data ?? []);
}
