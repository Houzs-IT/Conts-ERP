// Conts only (not part of Houzs's code): the books kept in AutoCount after the ledger start, brought in as journals
// (chew, 17 Nov 2026: "先按笔导入分录"). One AutoCount document (its Doc No: OR-, HPV-, PI-, I-, JV-, CN-) is one
// journal, dated as AutoCount had it, source ACJ, its number the AutoCount number, so the same document is booked once
// however often it is sent. AutoCount names a customer or supplier by its own account (301-M144, 400-H006); here that is
// the party's control (its debtor's control, its supplier's control) with the party kept on the line, as every document
// of the ledger posts. A code the chart has is the chart's (405-0001 is an account, not a supplier). The lines arrive
// with their department, unit and project already worked out from AutoCount's project (the caller's mapping).
import { postJournal } from './engine';
import { apControlOf, isDepartment, resolveRoles } from './rules';
import type { RuleLine } from './rules';
import { paginateAll } from '../scm/lib/paginate-all';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as everywhere in acc/ */
type Db = any;

export const AUTOCOUNT_SOURCE = 'ACJ';
export const AUTOCOUNT_MAX_DOCS = 100;

export interface AutocountLine {
  accountCode: string; debitSen: number; creditSen: number; notes?: string | null;
  department?: string | null; unitId?: string | null; projectId?: number | null;
}
export interface AutocountJournal { docNo: string; date: string; kind?: string | null; narration?: string | null; lines: AutocountLine[] }
export type AutocountResult = { posted: number; already: number; errors: { docNo: string; error: string }[] };

const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const sen = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : -1);

/** Books AutoCount's documents as journals, each on its own: one refused does not stop the rest. */
export async function importAutocountJournals(sb: Db, companyId: number, docs: AutocountJournal[]): Promise<AutocountResult> {
  const out: AutocountResult = { posted: 0, already: 0, errors: [] };
  const [chart, debtors, suppliers, roles] = await Promise.all([
    paginateAll((from, to) => sb.from('accounts').select('account_code').eq('company_id', companyId).order('account_code').range(from, to)),
    paginateAll((from, to) => sb.from('debtors').select('code, name, control_account').eq('company_id', companyId).order('code').range(from, to)),
    paginateAll((from, to) => sb.from('suppliers').select('id, code, name, control_account').eq('company_id', companyId).order('id').range(from, to)),
    resolveRoles(sb, companyId),
  ]);
  const failed = chart.error ?? debtors.error ?? suppliers.error;
  if (failed) {
    const why = `The chart, customers or suppliers could not be read: ${(failed as { message?: string }).message ?? ''}`;
    return { ...out, errors: docs.map((d) => ({ docNo: text(d.docNo), error: why })) };
  }
  const accounts = new Set(((chart.data ?? []) as Array<{ account_code: string }>).map((a) => a.account_code));
  const debtorOf = new Map(((debtors.data ?? []) as Array<{ code: string; name: string; control_account: string }>).map((d) => [d.code.toUpperCase(), d]));
  const supplierOf = new Map(((suppliers.data ?? []) as Array<{ code: string; name: string; control_account: string | null }>).map((s) => [String(s.code).trim().toUpperCase(), s]));

  /** The ledger's line for AutoCount's account: the chart's own, else the party's control with the party on it. */
  const lineFor = (l: AutocountLine): RuleLine | string => {
    const code = text(l.accountCode).toUpperCase();
    const dr = sen(l.debitSen), cr = sen(l.creditSen);
    if (dr < 0 || cr < 0) return `${code}: the amounts must be whole sen, not below zero.`;
    const tags: Partial<RuleLine> = {
      notes: text(l.notes) || null,
      department: isDepartment(l.department) ? l.department : 'shared',
      unitId: text(l.unitId) || null,
      projectId: l.projectId != null && Number.isSafeInteger(Number(l.projectId)) ? Number(l.projectId) : null,
    };
    if (accounts.has(code)) return { accountCode: code, debitSen: dr, creditSen: cr, ...tags };
    const d = debtorOf.get(code);
    if (d) return { accountCode: d.control_account, debitSen: dr, creditSen: cr, partyType: 'CUSTOMER', partyCode: d.code, partyName: d.name, ...tags };
    const s = supplierOf.get(code);
    if (s) {
      return { accountCode: apControlOf(roles, { code: s.code, control_account: s.control_account }), debitSen: dr, creditSen: cr,
        partyType: 'SUPPLIER', partyCode: s.code, partyName: s.name, ...tags };
    }
    return `${code} is not an account, a customer or a supplier here.`;
  };

  for (const raw of docs.slice(0, AUTOCOUNT_MAX_DOCS)) {
    const docNo = text(raw.docNo);
    const date = text(raw.date);
    if (!docNo) { out.errors.push({ docNo: '(none)', error: 'The document number is empty.' }); continue; }
    if (!isDay(date)) { out.errors.push({ docNo, error: 'The date is not a date (YYYY-MM-DD).' }); continue; }
    const lines: RuleLine[] = [];
    let problem: string | null = null;
    for (const l of Array.isArray(raw.lines) ? raw.lines : []) {
      const r = lineFor(l);
      if (typeof r === 'string') { problem = r; break; }
      if (r.debitSen === 0 && r.creditSen === 0) continue;
      lines.push(r);
    }
    if (problem) { out.errors.push({ docNo, error: problem }); continue; }
    const narration = [text(raw.kind), text(raw.narration)].filter(Boolean).join(' · ') || `AutoCount ${docNo}`;
    const r = await postJournal(sb, { companyId, entryDate: date, sourceType: AUTOCOUNT_SOURCE, sourceDocNo: docNo, narration: `AutoCount ${docNo}: ${narration}`.slice(0, 500), lines });
    if (!r.ok) { out.errors.push({ docNo, error: `${r.status}${'reason' in r && r.reason ? `: ${r.reason}` : ''}` }); continue; }
    if (r.status === 'already_posted') out.already += 1; else out.posted += 1;
  }
  if (docs.length > AUTOCOUNT_MAX_DOCS) {
    for (const d of docs.slice(AUTOCOUNT_MAX_DOCS)) out.errors.push({ docNo: text(d.docNo), error: `At most ${AUTOCOUNT_MAX_DOCS} documents at a time.` });
  }
  return out;
}
