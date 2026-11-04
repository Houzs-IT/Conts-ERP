/* Finance keeps the sub-department list (SOP 1.1; chew 4 Nov 2026). Pinned:
     · anyone with the Ledger reads it; changing it needs the ledger post key;
     · a new one needs a name, unique in its department; its department never changes afterwards;
     · a built-in one is renamed, never retired; a retired one comes back;
     · the staff departments it can map to are Property OS's. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly } from '../scm/lib/fake-postgrest';
import { createSubDepartmentHandler, listStaffDepartmentsHandler, listSubDepartmentsHandler, updateSubDepartmentHandler } from './sub-department-routes';

const CO = 1;
const POST = 'scm.payment_voucher.post';
const world = () => publicTablesOnly(fakeSb({
  acc_sub_departments: [
    { id: 's-gen', company_id: CO, department: 'rental', name: 'Rental (general)', fixed_key: 'rental_general', staff_department_id: null, active: true, sort: 10 },
    { id: 's-cln', company_id: CO, department: 'rental', name: 'Cleaning', fixed_key: null, staff_department_id: null, active: true, sort: 30 },
    { id: 's-dc', company_id: CO, department: 'supply', name: 'Renovation (Dream Crafter)', fixed_key: 'dreamcrafter', staff_department_id: null, active: true, sort: 10 },
    { id: 's-co', company_id: CO, department: 'shared', name: 'Company', fixed_key: 'company', staff_department_id: null, active: true, sort: 10 },
  ],
  conts_departments: [{ id: 'dept-cln', name: 'Cleaning', kind: 'cleaning', side: 'conts' }],
}), ['conts_departments']);
const app = (sb: ReturnType<typeof world>, perms: string[]) => {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('houzsUser' as never, { name: 'Chew', permissions_set: new Set(perms) } as never);
    await next();
  });
  a.get('/sub-departments', listSubDepartmentsHandler as never);
  a.post('/sub-departments', createSubDepartmentHandler as never);
  a.put('/sub-departments/:id', updateSubDepartmentHandler as never);
  a.get('/staff-departments', listStaffDepartmentsHandler as never);
  return a;
};
const send = (a: Hono, method: string, path: string, body: unknown) =>
  a.request(path, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('the sub-department list', () => {
  test('anyone with the Ledger reads it', async () => {
    const r = await (await app(world(), []).request('/sub-departments')).json() as { subDepartments: Array<{ name: string }> };
    expect(r.subDepartments.map((s) => s.name)).toEqual(['Rental (general)', 'Cleaning', 'Renovation (Dream Crafter)', 'Company']);
  });

  test('without the post key nothing changes', async () => {
    const a = app(world(), []);
    expect((await send(a, 'POST', '/sub-departments', { department: 'rental', name: 'Laundry' })).status).toBe(403);
    expect((await send(a, 'PUT', '/sub-departments/s-cln', { name: 'Housekeeping' })).status).toBe(403);
  });

  test('a new one under Rental; the same name twice in a department is refused; an empty name too', async () => {
    const sb = world();
    const a = app(sb, [POST]);
    expect((await send(a, 'POST', '/sub-departments', { department: 'rental', name: 'Laundry', staffDepartmentId: 'dept-cln' })).status).toBe(201);
    expect(sb.tables.acc_sub_departments.find((s) => s.name === 'Laundry')).toMatchObject({ department: 'rental', fixed_key: null, staff_department_id: 'dept-cln', active: true });
    const dup = await send(a, 'POST', '/sub-departments', { department: 'rental', name: ' laundry ' });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { message: string }).message).toBe('Rental already has Laundry.');
    expect((await send(a, 'POST', '/sub-departments', { department: 'rental', name: '  ' })).status).toBe(400);
    expect((await send(a, 'POST', '/sub-departments', { department: 'warehouse', name: 'X' })).status).toBe(400);
  });

  test('a built-in one is renamed, never retired; its department never changes', async () => {
    const sb = world();
    const a = app(sb, [POST]);
    const r = await send(a, 'PUT', '/sub-departments/s-gen', { active: false });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { message: string }).message).toBe('Rental (general) is built in: rename it, never retire it.');
    expect((await send(a, 'PUT', '/sub-departments/s-gen', { name: 'Rental (other)', department: 'shared' })).status).toBe(200);
    expect(sb.tables.acc_sub_departments.find((s) => s.id === 's-gen')).toMatchObject({ name: 'Rental (other)', department: 'rental', active: true });
  });

  test('an ordinary one is retired, re-mapped, reordered and brought back', async () => {
    const sb = world();
    const a = app(sb, [POST]);
    expect((await send(a, 'PUT', '/sub-departments/s-cln', { active: false, staffDepartmentId: 'dept-cln', sort: 5 })).status).toBe(200);
    expect(sb.tables.acc_sub_departments.find((s) => s.id === 's-cln')).toMatchObject({ active: false, staff_department_id: 'dept-cln', sort: 5 });
    expect((await send(a, 'PUT', '/sub-departments/s-cln', { active: true })).status).toBe(200);
    expect(sb.tables.acc_sub_departments.find((s) => s.id === 's-cln')).toMatchObject({ active: true });
    expect((await send(a, 'PUT', '/sub-departments/s-cln', { name: 'Rental (general)' })).status).toBe(409);
    expect((await send(a, 'PUT', '/sub-departments/nope', { name: 'X' })).status).toBe(404);
  });

  test('the staff departments come from Property OS', async () => {
    expect(await (await app(world(), []).request('/staff-departments')).json()).toEqual({ departments: [{ id: 'dept-cln', name: 'Cleaning' }] });
  });
});
