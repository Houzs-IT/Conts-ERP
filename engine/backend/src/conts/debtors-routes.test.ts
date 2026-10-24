/* Debtors — finance's list of customers, by control (Conts, finance phase 1.5; spec 2.1). Pinned:
     · the list comes grouped by control (each control's code and name ride along);
     · a new debtor with no code takes the next one under its control; a control must be a customer control (SDC);
     · a rename keeps the code; moving a debtor that already has postings asks first (409 debtor_in_use);
     · writing needs the post key. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import { createDebtorHandler, listDebtorsHandler, patchDebtorHandler } from './debtors-routes';

const CO = 1;
const world = (over: Record<string, Row[]> = {}) => fakeSb({
  accounts: [
    { company_id: CO, account_code: '301-0000', account_name: 'RENOVATION CUSTOMER', account_type: 'ASSET', special_type: 'SDC', is_active: true },
    { company_id: CO, account_code: '302-0000', account_name: 'INHOUSE RENOVATION CUSTOMER', account_type: 'ASSET', special_type: 'SDC', is_active: true },
    { company_id: CO, account_code: '400-0000', account_name: 'TRADE CREDITORS', account_type: 'LIABILITY', special_type: 'SCC', is_active: true },
  ],
  debtors: [
    { id: 'd1', company_id: CO, code: '301-M001', name: 'MS LEE', control_account: '301-0000', is_active: true },
    { id: 'd2', company_id: CO, code: '302-M005', name: 'MR TAN', control_account: '302-0000', is_active: true },
  ],
  v_gl_entries: [],
  ...over,
}, {}, [{ table: 'debtors', column: 'code' }]);

function app(sb: ReturnType<typeof world>, perms: string[] = ['scm.payment_voucher.post']) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('houzsUser' as never, { id: 9, name: 'Chew', permissions_set: new Set(perms) } as never);
    await next();
  });
  a.get('/debtors', listDebtorsHandler as never);
  a.post('/debtors', createDebtorHandler as never);
  a.patch('/debtors/:id', patchDebtorHandler as never);
  return a;
}
const send = (a: Hono, method: string, path: string, body?: unknown) => a.request(path, {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
});

describe('Debtors', () => {
  test('lists debtors grouped by control', async () => {
    const res = await send(app(world()), 'GET', '/debtors');
    const body = await res.json() as { controls: Array<{ code: string; name: string; debtors: Array<{ code: string }> }> };
    expect(body.controls.map((c) => [c.code, c.name, c.debtors.map((d) => d.code)])).toEqual([
      ['301-0000', 'RENOVATION CUSTOMER', ['301-M001']],
      ['302-0000', 'INHOUSE RENOVATION CUSTOMER', ['302-M005']],
    ]);
  });

  test('creating a debtor with no code gives it the next one under its control', async () => {
    const sb = world();
    const res = await send(app(sb), 'POST', '/debtors', { name: 'MS CHEW', controlAccount: '301-0000', phone: '012' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ debtor: { code: '301-M002', name: 'MS CHEW', control_account: '301-0000' } });
  });

  test('a control that is not a customer control is refused', async () => {
    const res = await send(app(world()), 'POST', '/debtors', { name: 'X', controlAccount: '400-0000' });
    expect(res.status).toBe(400);
  });

  test('renaming keeps the code', async () => {
    const sb = world();
    const res = await send(app(sb), 'PATCH', '/debtors/d1', { name: 'MS LEE MEI LING' });
    expect(res.status).toBe(200);
    expect(sb.tables.debtors[0]).toMatchObject({ code: '301-M001', name: 'MS LEE MEI LING' });
  });

  test('moving a debtor with postings asks first, then moves on confirm', async () => {
    const sb = world({ v_gl_entries: [{ line_id: 1, company_id: CO, account_code: '301-0000', party_code: '301-M001', debit_sen: 100, credit_sen: 0, posted: true, reversed: false }] });
    const a = app(sb);
    const first = await send(a, 'PATCH', '/debtors/d1', { controlAccount: '302-0000' });
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ error: 'debtor_in_use' });
    expect(sb.tables.debtors[0].control_account).toBe('301-0000');
    const again = await send(a, 'PATCH', '/debtors/d1', { controlAccount: '302-0000', confirm: true });
    expect(again.status).toBe(200);
    expect(sb.tables.debtors[0].control_account).toBe('302-0000');
  });

  test('refuses without the post key', async () => {
    const res = await send(app(world(), ['scm.sales_order.read']), 'POST', '/debtors', { name: 'X', controlAccount: '301-0000' });
    expect(res.status).toBe(403);
  });
});
