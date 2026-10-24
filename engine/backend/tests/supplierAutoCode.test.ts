/* A new supplier with no code typed gets the next one under its control, coded like AutoCount (Conts, finance phase
   1.5; SOP 2.1: suppliers as customers). Its control defaults to the code's own rule (400- trade creditors, 405- other
   creditors) and must be a supplier control (SCC) of the chart. Choosing a control needs the ledger's post key, and a
   supplier that still owes on its control is not moved off it. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { createSupplierHandler, patchSupplierHandler } from '../src/scm/routes/suppliers';

const CO = 1;
const world = (suppliers: Row[] = [], gl: Row[] = []) => fakeSb({
  accounts: [
    { company_id: CO, account_code: '400-0000', account_type: 'LIABILITY', special_type: 'SCC', is_active: true },
    { company_id: CO, account_code: '405-0000', account_type: 'LIABILITY', special_type: 'SCC', is_active: true },
    { company_id: CO, account_code: '900-A001', account_type: 'EXPENSE', special_type: null, is_active: true },
  ],
  acc_account_roles: [],
  suppliers,
  v_gl_entries: gl,
}, {}, [{ table: 'suppliers', column: 'code' }]);

function send(sb: ReturnType<typeof world>, method: 'POST' | 'PATCH', body: Row, perms: string[] = ['*']) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('houzsUser' as never, { id: 9, name: 'T', permissions_set: new Set(perms) } as never);
    await next();
  });
  app.post('/suppliers', createSupplierHandler as never);
  app.patch('/suppliers/:id', patchSupplierHandler as never);
  return app.request(method === 'POST' ? '/suppliers' : '/suppliers/s1', { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}
const post = (sb: ReturnType<typeof world>, body: Row, perms?: string[]) => send(sb, 'POST', body, perms);

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

  test('a typed 405- code with no control named books to other creditors, as its code says', async () => {
    const sb = world();
    const res = await post(sb, { name: 'TNB', code: '405-T003' });
    expect(res.status).toBe(201);
    expect(sb.tables.suppliers[0]).toMatchObject({ code: '405-T003', control_account: '405-0000' });
  });

  test('a control that is not a supplier control is refused', async () => {
    const res = await post(world(), { name: 'X', controlAccount: '900-A001' });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('not_a_supplier_control');
  });

  test('naming a control needs the post key', async () => {
    const res = await post(world(), { name: 'X', controlAccount: '405-0000' }, ['scm.supplier.write']);
    expect(res.status).toBe(403);
  });
});

describe('moving a supplier to another control', () => {
  const S1 = { id: 's1', company_id: CO, code: '400-H010', name: 'HOYEN SPACE', control_account: '400-0000' };

  test('needs the post key', async () => {
    const res = await send(world([{ ...S1 }]), 'PATCH', { controlAccount: '405-0000' }, ['scm.supplier.write']);
    expect(res.status).toBe(403);
  });

  test('a supplier that still owes on its control is not moved', async () => {
    const sb = world([{ ...S1 }], [{ line_id: 1, company_id: CO, account_code: '400-0000', party_code: '400-H010', debit_sen: 0, credit_sen: 5000 }]);
    const res = await send(sb, 'PATCH', { controlAccount: '405-0000' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'supplier_has_balance' });
    expect(sb.tables.suppliers[0].control_account).toBe('400-0000');
  });

  test('a supplier with nothing owing moves', async () => {
    const sb = world([{ ...S1 }], [
      { line_id: 1, company_id: CO, account_code: '400-0000', party_code: '400-H010', debit_sen: 0, credit_sen: 5000 },
      { line_id: 2, company_id: CO, account_code: '400-0000', party_code: '400-H010', debit_sen: 5000, credit_sen: 0 },
    ]);
    const res = await send(sb, 'PATCH', { controlAccount: '405-0000' });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(sb.tables.suppliers[0].control_account).toBe('405-0000');
  });
});
