// Conts only (not part of Houzs's code): sub-departments (SOP 1.1; chew 4 Nov 2026; spec
// docs/superpowers/specs/2026-11-04-sub-departments-design.md). Each ledger line names a sub-department under its
// department; `department` stays on every line, `sub_department_id` sits beside it. A line with none reads as its
// department's built-in row: Rental (general), Renovation (Dream Crafter), Company. Finance keeps the list
// (scm.acc_sub_departments, migration 0207) on Ledger setup.
import { DEPARTMENTS, isDepartment, type Department } from '../acc/rules';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as in the modules it sits beside */
type Db = any;

export type FixedKey = 'rental_general' | 'dreamcrafter' | 'theconts' | 'company';
export type SubDepartment = {
  id: string; department: Department; name: string; fixedKey: FixedKey | null; staffDepartmentId: string | null; active: boolean; sort: number;
};
export type RenoKind = 'RENOVATION' | 'INHOUSE_RENOVATION';

/** The built-in row each department's lines without a sub-department read as. */
const DEFAULT_KEY: Record<Department, FixedKey> = { rental: 'rental_general', supply: 'dreamcrafter', shared: 'company' };
/** The brand a renovation sub-department stands for (SOP 2.1: Dream Crafter is renovation, The Conts inhouse). */
export const RENO_KIND_OF: Partial<Record<FixedKey, RenoKind>> = { dreamcrafter: 'RENOVATION', theconts: 'INHOUSE_RENOVATION' };

/** The company's list, retired rows included: by department (Rental, Renovation, Company), then order, then name. */
export async function loadSubDepartments(sb: Db, companyId: number): Promise<{ ok: true; list: SubDepartment[] } | { ok: false; error: string }> {
  const { data, error } = await sb.from('acc_sub_departments').select('id, department, name, fixed_key, staff_department_id, active, sort').eq('company_id', companyId);
  if (error) return { ok: false, error: error.message };
  const list = ((data ?? []) as Array<Record<string, any>>).filter((r) => isDepartment(r.department)).map((r): SubDepartment => ({
    id: String(r.id), department: r.department as Department, name: String(r.name), fixedKey: (r.fixed_key ?? null) as FixedKey | null,
    staffDepartmentId: r.staff_department_id != null ? String(r.staff_department_id) : null, active: r.active !== false, sort: Number(r.sort ?? 0),
  }));
  const order = (d: Department) => DEPARTMENTS.indexOf(d);
  list.sort((a, b) => order(a.department) - order(b.department) || a.sort - b.sort || a.name.localeCompare(b.name));
  return { ok: true, list };
}

/** A department's built-in row. Seeded for every company (0207); its absence is a broken install, not a choice. */
export function defaultSubDepartment(list: readonly SubDepartment[], department: Department): SubDepartment {
  const s = list.find((x) => x.fixedKey === DEFAULT_KEY[department]);
  if (!s) throw new Error(`No built-in sub-department for ${department}: migration 0207 not applied?`);
  return s;
}

type LineSub = { ok: true; department: Department; subDepartmentId: string | null }
  | { ok: false; error: 'sub_department_invalid' | 'sub_department_mismatch'; message: string };

/** A line's department and sub-department as saved. The sub-department, when named, decides the department; none keeps
    the department sent (an older caller). `saved`: the line's own sub-department, kept even after it was retired. */
export function resolveLineSub(list: readonly SubDepartment[], line: { department?: unknown; subDepartmentId?: unknown }, opts: { saved?: string | null } = {}): LineSub {
  const id = line.subDepartmentId == null || line.subDepartmentId === '' ? null : String(line.subDepartmentId);
  if (id == null) {
    if (line.department != null && line.department !== '' && !isDepartment(line.department)) {
      return { ok: false, error: 'sub_department_invalid', message: 'The department must be rental, supply or shared.' };
    }
    return { ok: true, department: isDepartment(line.department) ? line.department : 'supply', subDepartmentId: null };
  }
  const s = list.find((x) => x.id === id);
  if (!s || (!s.active && opts.saved !== id)) return { ok: false, error: 'sub_department_invalid', message: 'Choose a department from the list.' };
  return { ok: true, department: s.department, subDepartmentId: s.id };
}

const knownKind = (k: unknown): RenoKind | null => (k === 'RENOVATION' || k === 'INHOUSE_RENOVATION' ? k : null);

/** The company's brands' kinds, by brand name (public.project_brands; SOP 2.1). */
export async function loadBrandKinds(sb: Db, companyId: number): Promise<Map<string, RenoKind | null>> {
  const { data } = await sb.schema('public').from('project_brands').select('name, finance_kind').eq('company_id', companyId);
  return new Map(((data ?? []) as Array<{ name: string; finance_kind: string | null }>).map((b) => [b.name, knownKind(b.finance_kind)]));
}

/** A project's brand (SOP 2.1): its own kind, else its brand's, else renovation (Dream Crafter). */
export const renoKindOf = (p: { finance_kind?: string | null; brand?: string | null }, brandKinds: ReadonlyMap<string, RenoKind | null>): RenoKind =>
  knownKind(p.finance_kind) ?? (p.brand ? brandKinds.get(p.brand) ?? null : null) ?? 'RENOVATION';

/** Each project's brand, for the projects named. */
export async function projectRenoKind(sb: Db, companyId: number, projectIds: number[]): Promise<Map<number, RenoKind>> {
  const out = new Map<number, RenoKind>();
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return out;
  const { data } = await sb.schema('public').from('projects').select('id, finance_kind, brand').eq('company_id', companyId).in('id', ids);
  const brandKinds = await loadBrandKinds(sb, companyId);
  for (const p of (data ?? []) as Array<{ id: number; finance_kind: string | null; brand: string | null }>) out.set(Number(p.id), renoKindOf(p, brandKinds));
  return out;
}

/** The sub-department a person's (or a float's) staff department defaults to; none mapped → `fallback`'s built-in row. */
export function subForStaffDepartment(list: readonly SubDepartment[], staffDepartmentId: string | null, fallback: Department): SubDepartment {
  const mapped = staffDepartmentId ? list.find((s) => s.active && s.staffDepartmentId === staffDepartmentId) : undefined;
  return mapped ?? defaultSubDepartment(list, fallback);
}

type LinesSub = { ok: true; lines: Array<{ department: Department; subDepartmentId: string } | null> }
  | { ok: false; status: 400 | 500; error: string; message: string };

/** The sub-departments a document's lines name (SOP 1.1): each named one gives its line's department; a line naming
    none keeps the department sent (null here). `saved[i]`: line i's own, kept even after it was retired. */
export async function resolveLinesSub(sb: Db, companyId: number, raws: ReadonlyArray<{ subDepartmentId?: unknown } | undefined>, saved: ReadonlyArray<string | null> = []): Promise<LinesSub> {
  const named = (r: { subDepartmentId?: unknown } | undefined) => r?.subDepartmentId != null && String(r.subDepartmentId).trim() !== '';
  if (!raws.some(named)) return { ok: true, lines: raws.map(() => null) };
  const loaded = await loadSubDepartments(sb, companyId);
  if (!loaded.ok) return { ok: false, status: 500, error: 'load_failed', message: loaded.error };
  const lines: Array<{ department: Department; subDepartmentId: string } | null> = [];
  for (const [i, r] of raws.entries()) {
    if (!named(r)) { lines.push(null); continue; }
    const s = resolveLineSub(loaded.list, { subDepartmentId: String(r!.subDepartmentId).trim() }, { saved: saved[i] ?? null });
    if (!s.ok) return { ok: false, status: 400, error: s.error, message: `Line ${i + 1}: ${s.message}` };
    lines.push({ department: s.department, subDepartmentId: s.subDepartmentId! });
  }
  return { ok: true, lines };
}
