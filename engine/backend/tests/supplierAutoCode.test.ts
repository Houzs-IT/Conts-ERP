/* A new supplier with no code typed gets the next one under its control, coded like AutoCount (Conts, finance phase
   1.5; SOP 2.1: suppliers as customers). Its control defaults to the trade creditors control and must be a supplier
   control (SCC) of the chart. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { createSupplierHandler } from '../src/scm/routes/suppliers';

const CO = 1;
const world = (suppliers: Row[] = []) => fakeSb({
  accounts: [
    { company_id: CO, account_code: '400-0000', account_type: 'LIABILITY', special_type: 'SCC', is_active: true },
    { company_id: CO, account_code: '405-0000', account_type: 'LIABILITY', special_type: 'SCC', is_active: true },
    { company_id: CO, account_code: '900-A001', account_type: 'EXPENSE', special_type: null, is_active: true },
  ],
  acc_account_roles: [],
  suppliers,
}, {}, [{ table: 'suppliers', column: 'code' }]);

function post(sb: ReturnType<typeof world>, body: Row) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('houzsUser' as never, { id: 9, name: 'T', permissions_set: new Set(['*']) } as never);
    await next();
  });
  app.post('/suppliers', createSupplierHandler as never);
  return app.request('/suppliers', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

describe('a new supplier and its code', () => {
  test('no code typed: the next one under the trade creditors control', async () => {
    const sb = world([{ id: 's1', company_id: CO, code: '400-H010', name: 'HOYEN SPACE', control_account: '400-0000' }]);
    const res = await post(sb, { name: 'HAPPY HOME TRADING' });
    expect(res.status, await res.clone().text()).toBe(201);
    expect(sb.tables.suppliers.find((s) => s.name === 'HAPPY HOME TRADING')).toMatchObject({ code: '400-H011', control_account: '400-0000' });
  });

  test('under another supplier control when one is named', async () => {
    const sb = world();
    const res = await post(sb, { name: 'OC - ABNB WATER', controlAccount: '405-0000' });
    expect(res.status).toBe(201);
    expect(sb.tables.suppliers[0]).toMatchObject({ code: '405-O001', control_account: '405-0000' });
  });

  test('a typed code is kept', async () => {
    const sb = world();
    await post(sb, { name: 'HOOKKA', code: 'HOOKKA' });
    expect(sb.tables.suppliers[0]).toMatchObject({ code: 'HOOKKA', control_account: '400-0000' });
  });

  test('a control that is not a supplier control is refused', async () => {
    const res = await post(world(), { name: 'X', controlAccount: '900-A001' });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('not_a_supplier_control');
  });
});
