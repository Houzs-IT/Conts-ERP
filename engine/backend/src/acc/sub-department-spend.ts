// ----------------------------------------------------------------------------
// Spending by sub-department (SOP 1.1; chew 4 Nov 2026; plan docs/superpowers/plans/2026-11-04-sub-departments.md
// Task 8).
//
//   GET /accounting/reports/sub-departments?from=YYYY-MM-DD&to=YYYY-MM-DD
//   GET /accounting/no-unit-costs?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// What each sub-department earned and spent over the range, as the books count them (acc/reversal-pairs: posted,
// neither side of a reversal): INCOME accounts credit, EXPENSE accounts debit. A line with no sub-department counts
// under its department's built-in row (Rental (general), Renovation (Dream Crafter), Company), so each department's
// rows add up to it. The previous period of the same length comes beside it. And the lines of a team's
// sub-department (a Rental one other than Rental (general): Maintenance, Cleaning…) that name no unit, for finance to
// check (SOP 1.1: units where possible).
// ----------------------------------------------------------------------------

import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { hasHouzsPerm } from '../scm/lib/houzs-perms';
import { paginateAll } from '../scm/lib/paginate-all';
import { inChunks } from './reno-completion';
import { countsInTheBooks } from './reversal-pairs';
import { DEPARTMENTS, isDepartment, type Department } from './rules';
import { defaultSubDepartment, loadSubDepartments, type SubDepartment } from '../conts/sub-departments';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped throughout the acc layer */
type Ctx = any;
type Row = Record<string, any>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEPT_LABEL: Record<Department, string> = { rental: 'Rental', supply: 'Renovation', shared: 'Company' };

export type SpendRow = { subDepartmentId: string; name: string; active: boolean; incomeSen: number; costSen: number; previousCostSen: number };
export type SubDepartmentSpend = {
  from: string; to: string; previous: { from: string; to: string };
  departments: Array<{ department: Department; label: string; incomeSen: number; costSen: number; previousCostSen: number; rows: SpendRow[] }>;
  totals: { incomeSen: number; costSen: number; previousCostSen: number };
};

const day = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The period of the same length just before [from, to]. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return { from: day(from, -days), to: day(from, -1) };
}

/** The lines the books count in [from, to], with their entry. */
async function countedLines(sb: any, companyId: number, from: string, to: string): Promise<Array<Row & { je: Row }>> {
  const jes = await paginateAll((f: number, t: number) => sb.from('journal_entries').select('id, je_no, entry_date, source_type, source_doc_no, posted, reversed, reversed_by_je')
    .eq('company_id', companyId).gte('entry_date', from).lte('entry_date', to).order('id').range(f, t));
  if (jes.error) throw new Error(`sub-department spend: journal entries: ${(jes.error as { message?: string }).message ?? 'failed'}`);
  const byId = new Map(((jes.data ?? []) as Row[]).filter(countsInTheBooks).map((j) => [String(j.id), j]));
  const lines = await inChunks([...byId.keys()], (b, f, t) => sb.from('journal_entry_lines')
    .select('id, journal_entry_id, account_code, debit_sen, credit_sen, department, sub_department_id, unit_id, notes')
    .eq('company_id', companyId).in('journal_entry_id', b).order('id').range(f, t), 'lines');
  return lines.map((l) => ({ ...l, je: byId.get(String(l.journal_entry_id))! }));
}

async function pnlTypes(sb: any, companyId: number): Promise<Map<string, { type: 'INCOME' | 'EXPENSE'; name: string }>> {
  const r = await paginateAll((f: number, t: number) => sb.from('accounts').select('account_code, account_name, account_type').eq('company_id', companyId)
    .in('account_type', ['INCOME', 'EXPENSE']).order('account_code').range(f, t));
  if (r.error) throw new Error(`sub-department spend: accounts: ${(r.error as { message?: string }).message ?? 'failed'}`);
  return new Map(((r.data ?? []) as Row[]).map((a) => [String(a.account_code), { type: a.account_type as 'INCOME' | 'EXPENSE', name: String(a.account_name ?? '') }]));
}

/** The sub-department a line counts under: its own, else its department's built-in row. */
const subOfLine = (list: readonly SubDepartment[], l: Row): SubDepartment | null => {
  const own = l.sub_department_id ? list.find((s) => s.id === String(l.sub_department_id)) : undefined;
  if (own) return own;
  const d = isDepartment(l.department) ? l.department : 'supply';
  try { return defaultSubDepartment(list, d); } catch { return null; }
};

export async function subDepartmentSpend(sb: any, companyId: number, from: string, to: string): Promise<SubDepartmentSpend> {
  const loaded = await loadSubDepartments(sb, companyId);
  if (!loaded.ok) throw new Error(`sub-department spend: ${loaded.error}`);
  const list = loaded.list;
  const prev = previousPeriod(from, to);
  const [types, now, before] = await Promise.all([pnlTypes(sb, companyId), countedLines(sb, companyId, from, to), countedLines(sb, companyId, prev.from, prev.to)]);
  const acc = new Map<string, { incomeSen: number; costSen: number; previousCostSen: number }>();
  const add = (rows: Row[], into: 'now' | 'before') => {
    for (const l of rows) {
      const t = types.get(String(l.account_code));
      if (!t) continue;
      const s = subOfLine(list, l);
      if (!s) continue;
      const cur = acc.get(s.id) ?? { incomeSen: 0, costSen: 0, previousCostSen: 0 };
      const dr = Number(l.debit_sen ?? 0), cr = Number(l.credit_sen ?? 0);
      if (into === 'before') { if (t.type === 'EXPENSE') cur.previousCostSen += dr - cr; }
      else if (t.type === 'INCOME') cur.incomeSen += cr - dr;
      else cur.costSen += dr - cr;
      acc.set(s.id, cur);
    }
  };
  add(now, 'now');
  add(before, 'before');
  const departments = DEPARTMENTS.map((department) => {
    const rows = list.filter((s) => s.department === department && (s.active || acc.has(s.id))).map((s): SpendRow => ({
      subDepartmentId: s.id, name: s.name, active: s.active, ...(acc.get(s.id) ?? { incomeSen: 0, costSen: 0, previousCostSen: 0 }),
    }));
    const sum = (k: 'incomeSen' | 'costSen' | 'previousCostSen') => rows.reduce((n, r) => n + r[k], 0);
    return { department, label: DEPT_LABEL[department], incomeSen: sum('incomeSen'), costSen: sum('costSen'), previousCostSen: sum('previousCostSen'), rows };
  });
  const total = (k: 'incomeSen' | 'costSen' | 'previousCostSen') => departments.reduce((n, d) => n + d[k], 0);
  return { from, to, previous: prev, departments, totals: { incomeSen: total('incomeSen'), costSen: total('costSen'), previousCostSen: total('previousCostSen') } };
}

export type NoUnitCosts = {
  from: string; to: string;
  rows: Array<{ jeNo: string; date: string; source: string; subDepartment: string; accountCode: string; accountName: string; amountSen: number; notes: string | null }>;
};

/** A team's (Maintenance, Cleaning…) cost lines that name no unit. */
export async function noUnitCosts(sb: any, companyId: number, from: string, to: string): Promise<NoUnitCosts> {
  const loaded = await loadSubDepartments(sb, companyId);
  if (!loaded.ok) throw new Error(`no-unit costs: ${loaded.error}`);
  const teams = new Map(loaded.list.filter((s) => s.department === 'rental' && !s.fixedKey).map((s) => [s.id, s]));
  const [types, lines] = await Promise.all([pnlTypes(sb, companyId), countedLines(sb, companyId, from, to)]);
  const rows = lines
    .filter((l) => l.sub_department_id && teams.has(String(l.sub_department_id)) && !l.unit_id && types.get(String(l.account_code))?.type === 'EXPENSE')
    .map((l) => ({
      jeNo: String(l.je.je_no ?? ''), date: String(l.je.entry_date ?? '').slice(0, 10), source: `${l.je.source_type ?? ''} ${l.je.source_doc_no ?? ''}`.trim(),
      subDepartment: teams.get(String(l.sub_department_id))!.name, accountCode: String(l.account_code), accountName: types.get(String(l.account_code))!.name,
      amountSen: Number(l.debit_sen ?? 0) - Number(l.credit_sen ?? 0), notes: l.notes ?? null,
    }))
    .filter((r) => r.amountSen !== 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.jeNo.localeCompare(b.jeNo));
  return { from, to, rows };
}

const range = (c: Ctx): { from: string; to: string } | null => {
  const from = String(c.req.query('from') ?? ''), to = String(c.req.query('to') ?? '');
  return DATE.test(from) && DATE.test(to) && from <= to ? { from, to } : null;
};

export const subDepartmentSpendHandler = async (c: Ctx): Promise<Response> => {
  /* What each part of the business earned and spent is statement data: the statements' own key. */
  if (!hasHouzsPerm(c, 'scm.payment_voucher.post')) return c.json({ error: "You don't have permission to read the financial statements." }, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const r = range(c);
  if (!r) return c.json({ error: 'bad_range', message: 'from and to must be YYYY-MM-DD, from on or before to.' }, 400);
  try { return c.json(await subDepartmentSpend(c.get('supabase'), co.companyId, r.from, r.to)); }
  catch (e) { return c.json({ error: 'load_failed', reason: (e as Error).message }, 500); }
};

export const noUnitCostsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const r = range(c);
  if (!r) return c.json({ error: 'bad_range', message: 'from and to must be YYYY-MM-DD, from on or before to.' }, 400);
  try { return c.json(await noUnitCosts(c.get('supabase'), co.companyId, r.from, r.to)); }
  catch (e) { return c.json({ error: 'load_failed', reason: (e as Error).message }, 500); }
};
