// ----------------------------------------------------------------------------
// Rental costs by unit (finance, chew 2 Nov 2026: answer A — the unit is kept on
// the finance side, never charged to the owner; SOP 3.2; plan docs/superpowers/
// plans/2026-11-02-voucher-purpose-unit-project-pickers.md Task 4).
//
//   GET /accounting/rental-unit-costs?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// What the company paid for each unit over the range: the Rental department's
// EXPENSE lines, as the books count them (acc/reversal-pairs: posted, neither
// side of a reversal), by the unit a voucher line named and by account. Rental
// expense that names no unit is Rental's general cost, shown apart. Owner
// charges live on the owner statement (Property OS) and are not here.
// ----------------------------------------------------------------------------

import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { paginateAll } from '../scm/lib/paginate-all';
import { inChunks } from './reno-completion';
import { countsInTheBooks } from './reversal-pairs';
import { loadSubDepartments } from '../conts/sub-departments';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped throughout the acc layer */
type Ctx = any;
type Row = Record<string, any>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface RentalUnitCosts {
  from: string; to: string;
  rows: Array<{ unitId: string; building: string; unitNumber: string; byAccount: Record<string, number>; totalSen: number;
    /** The sub-departments that spent on it (SOP 1.1: Cleaning, Maintenance…); the money is counted once, here and there. */
    subDepartments: string[] }>;
  noUnitSen: number;
  noUnitByAccount: Record<string, number>;
  accounts: Array<{ code: string; name: string }>;
}

export async function rentalUnitCosts(sb: any, companyId: number, from: string, to: string): Promise<RentalUnitCosts> {
  const fail = (what: string, e: { message?: string } | null | undefined): never => { throw new Error(`rental unit costs: ${what}: ${e?.message ?? 'failed'}`); };
  const jes = await paginateAll((f: number, t: number) => sb.from('journal_entries').select('id, entry_date, posted, reversed, reversed_by_je')
    .eq('company_id', companyId).gte('entry_date', from).lte('entry_date', to).order('id').range(f, t));
  if (jes.error) fail('journal entries', jes.error as { message?: string });
  const counted = ((jes.data ?? []) as Row[]).filter(countsInTheBooks).map((j) => String(j.id));
  const [lines, accounts] = await Promise.all([
    inChunks(counted, (b, f, t) => sb.from('journal_entry_lines').select('id, journal_entry_id, account_code, debit_sen, credit_sen, unit_id, sub_department_id')
      .eq('company_id', companyId).eq('department', 'rental').in('journal_entry_id', b).order('id').range(f, t), 'lines'),
    paginateAll((f: number, t: number) => sb.from('accounts').select('account_code, account_name').eq('company_id', companyId).eq('account_type', 'EXPENSE')
      .order('account_code').range(f, t)),
  ]);
  if (accounts.error) fail('accounts', accounts.error as { message?: string });
  const nameOf = new Map(((accounts.data ?? []) as Row[]).map((a) => [String(a.account_code), String(a.account_name ?? '')]));

  const subs = await loadSubDepartments(sb, companyId);
  const subName = new Map((subs.ok ? subs.list : []).map((s) => [s.id, s.name]));
  const subsOfUnit = new Map<string, Set<string>>();
  const byUnit = new Map<string, Record<string, number>>();
  const noUnit: Record<string, number> = {};
  const used = new Set<string>();
  for (const l of lines) {
    const code = String(l.account_code);
    if (!nameOf.has(code)) continue;
    const sen = Number(l.debit_sen ?? 0) - Number(l.credit_sen ?? 0);
    const into = l.unit_id ? (byUnit.get(String(l.unit_id)) ?? {}) : noUnit;
    into[code] = (into[code] ?? 0) + sen;
    if (l.unit_id) {
      byUnit.set(String(l.unit_id), into);
      const name = l.sub_department_id ? subName.get(String(l.sub_department_id)) : undefined;
      if (name) subsOfUnit.set(String(l.unit_id), (subsOfUnit.get(String(l.unit_id)) ?? new Set()).add(name));
    }
    used.add(code);
  }
  const clean = (m: Record<string, number>) => { for (const [k, v] of Object.entries(m)) if (v === 0) delete m[k]; return m; };

  const unitIds = [...byUnit.keys()];
  const units = await inChunks(unitIds, (b, f, t) => sb.schema('public').from('conts_units').select('id, building, unit_number').in('id', b).order('id').range(f, t), 'units');
  const unitOf = new Map(units.map((u) => [String(u.id), u]));
  const rows = unitIds.map((id) => {
    const byAccount = clean(byUnit.get(id)!);
    const u = unitOf.get(id);
    return { unitId: id, building: String(u?.building ?? ''), unitNumber: String(u?.unit_number ?? id), byAccount, totalSen: Object.values(byAccount).reduce((s, v) => s + v, 0),
      subDepartments: [...(subsOfUnit.get(id) ?? [])].sort() };
  }).filter((r) => Object.keys(r.byAccount).length > 0)
    .sort((a, b) => a.building.localeCompare(b.building) || a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
  const noUnitByAccount = clean(noUnit);
  const shown = new Set([...rows.flatMap((r) => Object.keys(r.byAccount)), ...Object.keys(noUnitByAccount)]);
  return {
    from, to, rows,
    noUnitSen: Object.values(noUnitByAccount).reduce((s, v) => s + v, 0),
    noUnitByAccount,
    accounts: [...used].filter((c) => shown.has(c)).sort().map((code) => ({ code, name: nameOf.get(code) ?? '' })),
  };
}

export const rentalUnitCostsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const from = String(c.req.query('from') ?? '').trim();
  const to = String(c.req.query('to') ?? '').trim();
  if (!DATE.test(from) || !DATE.test(to) || from > to) return c.json({ error: 'bad_date', message: 'Enter a range like 2026-11-01 to 2026-11-30.' }, 400);
  try {
    return c.json(await rentalUnitCosts(c.get('supabase'), co.companyId, from, to));
  } catch (e) {
    return c.json({ error: 'load_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
  }
};
