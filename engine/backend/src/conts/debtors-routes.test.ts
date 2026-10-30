/* Debtors — finance's list of customers, by control (Conts, finance phase 1.5; spec 2.1). Pinned:
     · the list comes grouped by control (each control's code and name ride along);
     · a new debtor with no code takes the next one under its control; a control must be a customer control (SDC);
     · a rename keeps the code; a debtor still owing on its control is not moved (409 debtor_has_balance);
     · the Other Debtors control is not a customer control here; a typed code must sit under its control;
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
    { company_id: CO, account_code: '305-0000', account_name: 'OTHER DEBTORS', account_type: 'ASSET', special_type: 'SDC', is_active: true },
    { company_id: CO, account_code: '400-0000', account_name: 'TRADE CREDITORS', account_type: 'LIABILITY', special_type: 'SCC', is_active: true },
  ],
  debtors: [
    { id: 'd1', company_id: CO, code: '301-M001', name: 'MS LEE', control_account: '301-0000', is_active: true },
    { id: 'd2', company_id: CO, code: '302-M005', name: 'MR TAN', control_account: '302-0000', is_active: true },
  ],
  v_gl_entries: [],
  acc_account_roles: [],
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

  test('a debtor still owing on its control is not moved, confirm or not', async () => {
    const sb = world({ v_gl_entries: [{ line_id: 1, company_id: CO, account_code: '301-0000', party_code: '301-M001', debit_sen: 100, credit_sen: 0 }] });
    const a = app(sb);
    const first = await send(a, 'PATCH', '/debtors/d1', { controlAccount: '302-0000', confirm: true });
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ error: 'debtor_has_balance', balanceSen: 100 });
    expect(sb.tables.debtors[0].control_account).toBe('301-0000');
  });

  test('a debtor with nothing owing moves, history and all', async () => {
    const sb = world({ v_gl_entries: [
      { line_id: 1, company_id: CO, account_code: '301-0000', party_code: '301-M001', debit_sen: 100, credit_sen: 0 },
      { line_id: 2, company_id: CO, account_code: '301-0000', party_code: '301-M001', debit_sen: 0, credit_sen: 100 },
    ] });
    const res = await send(app(sb), 'PATCH', '/debtors/d1', { controlAccount: '302-0000' });
    expect(res.status).toBe(200);
    expect(sb.tables.debtors[0].control_account).toBe('302-0000');
  });

  test('the Other Debtors control is not offered nor taken', async () => {
    const list = await (await send(app(world()), 'GET', '/debtors')).json() as { controls: Array<{ code: string }> };
    expect(list.controls.map((c) => c.code)).not.toContain('305-0000');
    expect((await send(app(world()), 'POST', '/debtors', { name: 'X', controlAccount: '305-0000' })).status).toBe(400);
  });

  test('a typed code must sit under its control', async () => {
    const res = await send(app(world()), 'POST', '/debtors', { name: 'X', code: '302-X001', controlAccount: '301-0000' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'code_not_under_control' });
  });

  test('refuses without the post key', async () => {
    const res = await send(app(world(), ['scm.sales_order.read']), 'POST', '/debtors', { name: 'X', controlAccount: '301-0000' });
    expect(res.status).toBe(403);
  });
});

describe('Debtors: e-invoice tax identity', () => {
  test('patch stores tin, id type and number, sst no', async () => {
    const sb = world();
    const res = await send(app(sb), 'PATCH', '/debtors/d1', { tin: 'ig12345678901', idType: 'NRIC', idNumber: '900101-14-5678', sstNo: '' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ debtor: { tin: 'IG12345678901', id_type: 'NRIC', id_number: '900101145678', sst_no: null } });
  });

  test('NRIC must be 12 digits', async () => {
    const res = await send(app(world()), 'PATCH', '/debtors/d1', { idType: 'NRIC', idNumber: '12345' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_id_number' });
  });

  test('BRN accepts the 12-digit new format and the old one', async () => {
    expect((await send(app(world()), 'PATCH', '/debtors/d1', { idType: 'BRN', idNumber: '202001012345' })).status).toBe(200);
    expect((await send(app(world()), 'PATCH', '/debtors/d1', { idType: 'BRN', idNumber: '1234567-X' })).status).toBe(200);
  });

  test('unknown id type refused', async () => {
    const res = await send(app(world()), 'PATCH', '/debtors/d1', { idType: 'LICENCE', idNumber: 'A1' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_id_type' });
  });

  test('an ID number needs its type', async () => {
    const res = await send(app(world()), 'PATCH', '/debtors/d1', { idNumber: '900101145678' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_id_type' });
  });

  test('a TIN that does not look like one is refused', async () => {
    const res = await send(app(world()), 'PATCH', '/debtors/d1', { tin: '12345' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_tin' });
  });

  test('a new customer can carry its tax identity', async () => {
    const res = await send(app(world()), 'POST', '/debtors', { name: 'MS ONG', controlAccount: '301-0000', idType: 'PASSPORT', idNumber: 'a1234567' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ debtor: { id_type: 'PASSPORT', id_number: 'A1234567' } });
  });
});

describe('Debtors: real-world numbers (review)', () => {
  test('old and printed registration numbers are accepted', async () => {
    for (const n of ['001234567-K', 'JM0123456-X', 'LLP0012345-LGN']) {
      expect((await send(app(world()), 'PATCH', '/debtors/d1', { idType: 'BRN', idNumber: n })).status).toBe(200);
    }
    const res = await send(app(world()), 'PATCH', '/debtors/d1', { idType: 'BRN', idNumber: '201901000005 (1312525-A)' });
    expect(await res.json()).toMatchObject({ debtor: { id_number: '201901000005' } });
  });

  test('older and general TIN prefixes are accepted', async () => {
    for (const tin of ['SG10234567020', 'EI00000000010', 'TJ12345678']) {
      expect((await send(app(world()), 'PATCH', '/debtors/d1', { tin })).status).toBe(200);
    }
  });

  test('changing only the ID type re-checks the stored number', async () => {
    const sb = world({ debtors: [{ id: 'd1', company_id: CO, code: '301-M001', name: 'MS LEE', control_account: '301-0000', is_active: true, id_type: 'PASSPORT', id_number: 'A1234567' }] });
    const res = await send(app(sb), 'PATCH', '/debtors/d1', { idType: 'NRIC' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_id_number' });
  });
});
