// Conts only (not part of Houzs's code): finance keeps the sub-department list (SOP 1.1; chew 4 Nov 2026). Mounted
// under /accounting, behind the Ledger guard.
//   GET  /accounting/sub-departments        the list, retired ones included
//   POST /accounting/sub-departments        { department, name, staffDepartmentId? } — needs the ledger post key
//   PUT  /accounting/sub-departments/:id    { name?, staffDepartmentId?, active?, sort? } — the same key
//   GET  /accounting/staff-departments      Property OS's staff departments a sub-department can map to
import { hasHouzsPerm } from '../scm/lib/houzs-perms';
import { requireActiveCompanyId } from '../scm/lib/companyScope';
import { isDepartment, type Department } from '../acc/rules';
import { loadSubDepartments, type SubDepartment } from './sub-departments';

/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
type Ctx = any;
const KEY = 'scm.payment_voucher.post';
const DEPT_LABEL: Record<Department, string> = { rental: 'Rental', supply: 'Renovation', shared: 'Company' };
const NO_KEY = { error: 'forbidden', message: "You don't have permission to change the departments." };
const clean = (v: unknown): string => String(v ?? '').trim().replace(/\s+/g, ' ');
const taken = (list: SubDepartment[], department: Department, name: string, except: string | null) =>
  list.find((s) => s.department === department && s.id !== except && s.name.toLowerCase() === name.toLowerCase());

export const listSubDepartmentsHandler = async (c: Ctx): Promise<Response> => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const r = await loadSubDepartments(c.get('supabase'), co.companyId);
  if (!r.ok) return c.json({ error: 'load_failed', reason: r.error }, 500);
  return c.json({ subDepartments: r.list });
};

export const createSubDepartmentHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, KEY)) return c.json(NO_KEY, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const department = body.department;
  const name = clean(body.name);
  if (!isDepartment(department)) return c.json({ error: 'department_invalid', message: 'Choose Rental, Renovation or Company.' }, 400);
  if (!name || name.length > 80) return c.json({ error: 'name_required', message: 'Give it a name (up to 80 characters).' }, 400);
  const sb = c.get('supabase');
  const cur = await loadSubDepartments(sb, co.companyId);
  if (!cur.ok) return c.json({ error: 'load_failed', reason: cur.error }, 500);
  const dup = taken(cur.list, department, name, null);
  if (dup) return c.json({ error: 'name_taken', message: `${DEPT_LABEL[department]} already has ${dup.name}.` }, 409);
  const sort = Math.max(0, ...cur.list.filter((s) => s.department === department).map((s) => s.sort)) + 10;
  const { data, error } = await sb.from('acc_sub_departments').insert({
    company_id: co.companyId, department, name, fixed_key: null, staff_department_id: clean(body.staffDepartmentId) || null, active: true, sort,
  }).select('*').single();
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  return c.json({ subDepartment: data }, 201);
};

export const updateSubDepartmentHandler = async (c: Ctx): Promise<Response> => {
  if (!hasHouzsPerm(c, KEY)) return c.json(NO_KEY, 403);
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  const sb = c.get('supabase');
  const cur = await loadSubDepartments(sb, co.companyId);
  if (!cur.ok) return c.json({ error: 'load_failed', reason: cur.error }, 500);
  const id = String(c.req.param('id'));
  const s = cur.list.find((x) => x.id === id);
  if (!s) return c.json({ error: 'not_found' }, 404);
  /* The department is never changed: lines already booked under it would move. */
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = clean(body.name);
    if (!name || name.length > 80) return c.json({ error: 'name_required', message: 'Give it a name (up to 80 characters).' }, 400);
    const dup = taken(cur.list, s.department, name, s.id);
    if (dup) return c.json({ error: 'name_taken', message: `${DEPT_LABEL[s.department]} already has ${dup.name}.` }, 409);
    patch.name = name;
  }
  if (body.staffDepartmentId !== undefined) patch.staff_department_id = clean(body.staffDepartmentId) || null;
  if (body.sort !== undefined) {
    const sort = Number(body.sort);
    if (!Number.isInteger(sort)) return c.json({ error: 'sort_invalid' }, 400);
    patch.sort = sort;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return c.json({ error: 'active_invalid' }, 400);
    if (!body.active && s.fixedKey) return c.json({ error: 'built_in', message: `${s.name} is built in: rename it, never retire it.` }, 409);
    patch.active = body.active;
  }
  if (Object.keys(patch).length === 0) return c.json({ subDepartment: s });
  const { data, error } = await sb.from('acc_sub_departments').update(patch).eq('company_id', co.companyId).eq('id', id).select('*').maybeSingle();
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  return c.json({ subDepartment: data });
};

/** Property OS's staff departments (public.conts_departments), for each sub-department's mapping. */
export const listStaffDepartmentsHandler = async (c: Ctx): Promise<Response> => {
  const { data, error } = await c.get('supabase').schema('public').from('conts_departments').select('id, name');
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const departments = ((data ?? []) as Array<{ id: unknown; name: unknown }>).map((d) => ({ id: String(d.id), name: String(d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return c.json({ departments });
};
