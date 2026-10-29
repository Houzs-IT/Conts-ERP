/* A member of staff's own receipts and requests (Conts; design 2026-10-28 §4.3-4.7). Pinned:
     · a receipt goes to the department's float, or a person's override, else to finance; a field worker may only name
       their own open job, and a job's unit and Rental fill in by themselves;
     · nobody reads another person's receipt or file, and a keeper reads only their own float;
     · a proper receipt replaces a rejected one and keeps its float; the old one stops counting;
     · a request: a deposit names a supplier; over a project's limit it is refused; withdrawn only before a voucher;
       a field worker hands receipts in but does not ask finance to pay; a deposit's voucher is a supplier payment. */
import { Hono } from 'hono';
import { afterEach, describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly } from '../scm/lib/fake-postgrest';
import { myClaimsRouter } from './my-claims-routes';
import { requestVoucherHandler, closeRequestHandler } from './payment-request-routes';
import { claimsDeps, FULL_KEY } from './petty-cash-routes';
import { projectLimit } from './project-limit';
import type { Staff } from './staff-identity';
/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they test */

const CO = 1;
const TECH: Staff = { userId: 'u-tech', name: 'Ah Wai', email: 't@x', departmentId: 'maint', side: 'conts', role: 'technician', field: true };
const CLEAN: Staff = { userId: 'u-clean', name: 'Siti', email: 'c@x', departmentId: 'clean', side: 'conts', role: 'housekeeper', field: true };
const OPS: Staff = { userId: 'u-ops', name: 'Wei Wen', email: 'o@x', departmentId: 'ops', side: 'both', role: 'operations_staff', field: false };
const KEEPER: Staff = { userId: 'u-keeper', name: 'Ah Keong', email: 'k@x', departmentId: 'maint', side: 'conts', role: 'technician', field: true };
const PNG = { name: 'r.png', mime: 'image/png', dataBase64: btoa('png-bytes') };

const world = () => publicTablesOnly(fakeSb({
  petty_cash_floats: [{ id: 'F1', company_id: CO, department_id: 'maint', keeper_user_id: 'u-keeper', float_sen: 100000, warn_pct: 20, active: true, topup_requested_at: null }],
  petty_cash_overrides: [], petty_cash_events: [{ id: 'E1', float_id: 'F1', kind: 'PAID_IN', amount_sen: 100000, event_date: '2026-11-01' }],
  staff_receipts: [], staff_receipt_lines: [], staff_receipt_files: [],
  payment_requests: [], payment_request_lines: [], payment_request_files: [], payment_vouchers: [], payment_voucher_lines: [],
  conts_maintenance_jobs: [
    { id: 'M1', unit_id: 'UNIT-A01', title: 'Tap', assignee_user_id: 'u-tech', state: 'in_progress' },
    { id: 'M2', unit_id: 'UNIT-B02', title: 'Door', assignee_user_id: 'u-other', state: 'open' },
  ],
  conts_units: [{ id: 'UNIT-A01', building: 'Skyline', unit_number: 'A-01' }],
  conts_staff: [{ id: 'u-tech', full_name: 'Ah Wai' }, { id: 'u-keeper', full_name: 'Ah Keong' }],
  suppliers: [{ id: 'S1', company_id: CO, code: '400-A001', name: 'ACE HARDWARE', control_account: null }],
  purchase_orders: [{ id: 'PO1', company_id: CO, supplier_id: 'S1' }],
  projects: [{ id: 7, company_id: CO, name: 'SHOWROOM', funding: 'internal', limit_pct_bp: null, budget_sen: 10_000 }],
  project_limit_requests: [], acc_company_settings: [{ company_id: CO, project_limit_pct_bp: 7000 }],
  accounts: ['601-0001', '906-0000'].map(code => ({ company_id: CO, account_code: code, account_name: code, account_type: 'EXPENSE', is_active: true, acc_money: false, parent_code: null, special_type: null, everyday_expense: false })),
}), ['conts_maintenance_jobs', 'conts_units', 'conts_staff', 'projects']);

const bucket = () => { const m = new Map<string, ArrayBuffer>(); return { m, put: async (k: string, v: ArrayBuffer) => { m.set(k, v); }, get: async (k: string) => (m.has(k) ? { body: m.get(k) } : null) }; };
const appFor = (sb: ReturnType<typeof world>, staff: Staff, source: 'session' | 'forward' = 'forward') => {
  const a = new Hono<{ Variables: Record<string, unknown> }>();
  a.use('*', async (c, next) => { c.set('supabase', sb); c.set('companyId', CO); c.set('staff', staff); await next(); });
  a.route('/', myClaimsRouter(source));
  return a;
};
const env = { SLIPS: bucket() };
const post = (a: Hono<any>, path: string, body: unknown) => a.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }, env);
const get = (a: Hono<any>, path: string) => a.request(path, {}, env);
const handIn = (a: Hono<any>, over: Record<string, unknown> = {}) => post(a, '/receipts', { spendDate: '2026-10-03', amountSen: 4500, files: [PNG], ...over });

describe('handing in a receipt', () => {
  test('to the department float, or to finance when there is none', async () => {
    const sb = world();
    expect(await (await handIn(appFor(sb, TECH))).json()).toMatchObject({ route: 'float' });
    expect(await (await handIn(appFor(sb, CLEAN))).json()).toMatchObject({ route: 'finance' });
    expect(sb.tables.staff_receipts.map(r => [r.submitter_user_id, r.float_id, r.source])).toEqual([['u-tech', 'F1', 'field_app'], ['u-clean', null, 'field_app']]);
    expect(sb.tables.staff_receipt_files).toHaveLength(2);
    expect([...env.SLIPS.m.keys()].every(k => k.startsWith('claims/1/'))).toBe(true);
  });
  test('a person pointed at another float uses that one', async () => {
    const sb = world();
    sb.tables.petty_cash_overrides.push({ company_id: CO, user_id: 'u-clean', float_id: 'F1' });
    expect(await (await handIn(appFor(sb, CLEAN))).json()).toMatchObject({ route: 'float' });
  });
  test('a job fills in its unit and Rental; a field worker may name only their own open job', async () => {
    const sb = world();
    expect((await handIn(appFor(sb, TECH), { lines: [{ maintenanceIssueId: 'M1', amountSen: 4500, department: 'supply' }] })).status).toBe(201);
    expect(sb.tables.staff_receipt_lines[0]).toMatchObject({ unit_id: 'UNIT-A01', department: 'rental', maintenance_issue_id: 'M1', account_code: null });
    expect((await handIn(appFor(sb, TECH), { lines: [{ maintenanceIssueId: 'M2', amountSen: 4500 }] })).status).toBe(422);
  });
  test('lines must add up; a photo is needed; no future date', async () => {
    const a = appFor(world(), OPS, 'session');
    expect((await handIn(a, { lines: [{ amountSen: 4000, department: 'shared' }] })).status).toBe(422);
    expect((await handIn(a, { files: [] })).status).toBe(422);
    expect((await handIn(a, { spendDate: '2999-01-01' })).status).toBe(422);
    expect((await handIn(a, { lines: [{ amountSen: 4500, department: 'shared', accountCode: '906-0000' }] })).status).toBe(201);
  });
});

describe('only your own', () => {
  test('another person\'s receipt or file is not found; the keeper sees the files on their float', async () => {
    const sb = world();
    const made = await (await handIn(appFor(sb, TECH))).json() as { id: string };
    const fileId = sb.tables.staff_receipt_files[0].id;
    expect((await get(appFor(sb, OPS), `/receipts/${made.id}/files/${fileId}`)).status).toBe(404);
    expect((await get(appFor(sb, TECH), `/receipts/${made.id}/files/${fileId}`)).status).toBe(200);
    expect((await get(appFor(sb, KEEPER), `/receipts/${made.id}/files/${fileId}`)).status).toBe(200);
    expect(((await (await get(appFor(sb, OPS), '/receipts')).json()) as any).receipts).toHaveLength(0);
  });
  test('only a keeper has a float; theirs shows its receipts and balance', async () => {
    const sb = world();
    await handIn(appFor(sb, TECH));
    expect((await get(appFor(sb, TECH), '/float')).status).toBe(404);
    const mine = await (await get(appFor(sb, KEEPER), '/float?month=2026-10')).json() as any;
    expect(mine.float).toMatchObject({ floatSen: 100000, balanceSen: 95500 });
    expect(mine.receipts).toHaveLength(1);
  });
  test('a field worker sees only their own open jobs', async () => {
    const jobs = await (await get(appFor(world(), TECH), '/jobs')).json() as any;
    expect(jobs.jobs.map((j: any) => j.id)).toEqual(['M1']);
  });
});

describe('replacing a rejected receipt', () => {
  test('keeps its float, and the old one stops counting', async () => {
    const sb = world();
    const first = await (await handIn(appFor(sb, TECH))).json() as { id: string };
    sb.tables.staff_receipts[0].status = 'REJECTED';
    expect((await handIn(appFor(sb, OPS), { replacesId: first.id })).status).toBe(404);
    expect((await handIn(appFor(sb, TECH), { replacesId: first.id, amountSen: 4500 })).status).toBe(201);
    expect(sb.tables.staff_receipts.map(r => [r.status, r.float_id])).toEqual([['REPLACED', 'F1'], ['HANDED_IN', 'F1']]);
    const mine = await (await get(appFor(sb, KEEPER), '/float?month=2026-10')).json() as any;
    expect(mine.float.balanceSen).toBe(95500);
  });
});

describe('payment requests', () => {
  const ask = (a: Hono<any>, over: Record<string, unknown> = {}) => post(a, '/requests', { type: 'PAYMENT', supplierId: 'S1', amountSen: 5000, files: [PNG], lines: [{ amountSen: 5000, department: 'rental', accountCode: '601-0001' }], ...over });
  const realCreate = claimsDeps.createVoucher;
  afterEach(() => { claimsDeps.createVoucher = realCreate; });

  test('a deposit names a supplier; a PO fills it; a field worker cannot ask', async () => {
    const sb = world();
    const a = appFor(sb, OPS, 'session');
    expect((await ask(a, { type: 'DEPOSIT', supplierId: undefined, payeeName: 'Someone' })).status).toBe(422);
    expect((await ask(a, { supplierId: undefined, purchaseOrderId: 'PO1' })).status).toBe(201);
    expect(sb.tables.payment_requests[0]).toMatchObject({ supplier_id: 'S1', payee_name: 'ACE HARDWARE', payee_to_check: false, status: 'SUBMITTED' });
    expect((await ask(appFor(sb, TECH))).status).toBe(403);
  });
  test('over a project\'s limit it is refused', async () => {
    const a = appFor(world(), OPS, 'session');
    expect((await ask(a, { amountSen: 20_000, lines: [{ amountSen: 20_000, department: 'rental', accountCode: '601-0001', projectId: 7 }] })).status).toBe(409);
    expect((await ask(a, { amountSen: 8_000, lines: [{ amountSen: 8_000, department: 'rental', accountCode: '601-0001', projectId: 7 }] })).status).toBe(201);
  });
  test('withdrawn only before a voucher; a deposit is paid as a supplier payment; close frees the rest', async () => {
    const sb = world();
    const a = appFor(sb, OPS, 'session');
    const made = await (await ask(a, { type: 'DEPOSIT', amountSen: 8_000, lines: [{ amountSen: 8_000, department: 'rental', accountCode: '601-0001', projectId: 7 }] })).json() as { id: string };
    expect(await projectLimit(sb, CO, 7)).toMatchObject({ reservedSen: 8_000 });
    let body: Record<string, unknown> = {};
    claimsDeps.createVoucher = async (_c, b) => { body = b; sb.tables.payment_vouchers.push({ id: 'PV1', company_id: CO, status: 'DRAFT' }); return { ok: true, id: 'PV1', pvNumber: 'HCDraft-2611-001' }; };
    const fin = new Hono<{ Variables: Record<string, unknown> }>();
    fin.use('*', async (c, next) => { c.set('supabase', sb); c.set('companyId', CO); c.set('houzsUser', { name: 'Chew', permissions_set: new Set([FULL_KEY]) }); await next(); });
    fin.post('/r/:id/voucher', requestVoucherHandler);
    fin.post('/r/:id/close', closeRequestHandler);
    expect((await post(fin, `/r/${made.id}/voucher`, { bankAccountCode: '310-0010' })).status).toBe(201);
    /* It pays the supplier: every line on the supplier's creditors control, so the deposit stands as an advance. */
    expect(body).toMatchObject({ purpose: 'SUPPLIER_PAYMENT', supplierId: 'S1' });
    expect((body.lines as Array<{ debitAccountCode: string; amountSen: number }>)).toEqual([expect.objectContaining({ debitAccountCode: '400-0000', amountSen: 8_000 })]);
    expect(sb.tables.payment_vouchers[0].payment_request_id).toBe(made.id);
    expect((await post(a, `/requests/${made.id}/withdraw`, {})).status).toBe(409);
    /* Part paid by a 3,000 voucher, then closed: the rest is freed. */
    sb.tables.payment_vouchers[0].status = 'POSTED';
    sb.tables.payment_voucher_lines.push({ pv_id: 'PV1', company_id: CO, project_id: 7, amount_sen: 3_000, debit_account_code: '601-0001' });
    sb.tables.payment_requests[0].status = 'PART_PAID';
    expect(await projectLimit(sb, CO, 7)).toMatchObject({ usedSen: 3_000, reservedSen: 5_000 });
    expect((await post(fin, `/r/${made.id}/close`, { reason: 'Supplier gave a discount' })).status).toBe(200);
    expect(await projectLimit(sb, CO, 7)).toMatchObject({ usedSen: 3_000, reservedSen: 0 });
  });
});

describe('nothing paid twice, nothing half-saved', () => {
  const ask = (a: Hono<any>, over: Record<string, unknown> = {}) => post(a, '/requests', { type: 'PAYMENT', supplierId: 'S1', amountSen: 5000, files: [PNG], lines: [{ amountSen: 3000, department: 'rental', accountCode: '601-0001' }, { amountSen: 2000, department: 'shared', accountCode: '906-0000' }], ...over });
  const realCreate = claimsDeps.createVoucher;
  afterEach(() => { claimsDeps.createVoucher = realCreate; });
  const finance = (sb: ReturnType<typeof world>) => {
    const fin = new Hono<{ Variables: Record<string, unknown> }>();
    fin.use('*', async (c, next) => { c.set('supabase', sb); c.set('companyId', CO); c.set('houzsUser', { name: 'Chew', permissions_set: new Set([FULL_KEY]) }); await next(); });
    fin.post('/r/:id/voucher', requestVoucherHandler);
    return fin;
  };

  test('one draft at a time; a second voucher pays only what is still owed', async () => {
    const sb = world();
    const made = await (await ask(appFor(sb, OPS, 'session'))).json() as { id: string };
    const bodies: Array<Record<string, unknown>> = [];
    claimsDeps.createVoucher = async (_c, b) => { bodies.push(b); const id = `PV${bodies.length}`; sb.tables.payment_vouchers.push({ id, company_id: CO, status: 'DRAFT' }); return { ok: true, id, pvNumber: id }; };
    expect((await post(finance(sb), `/r/${made.id}/voucher`, { bankAccountCode: '310-0010' })).status).toBe(201);
    expect((await post(finance(sb), `/r/${made.id}/voucher`, { bankAccountCode: '310-0010' })).status).toBe(409);
    /* The first voucher posts 3,500 of the 5,000: the first line is paid, and 1,500 of the second is still owed. */
    sb.tables.payment_vouchers[0].status = 'POSTED';
    sb.tables.payment_voucher_lines.push({ pv_id: 'PV1', company_id: CO, amount_sen: 3_500, project_id: null, debit_account_code: '400-0000' });
    sb.tables.payment_requests[0].status = 'PART_PAID';
    expect((await post(finance(sb), `/r/${made.id}/voucher`, { bankAccountCode: '310-0010' })).status).toBe(201);
    expect((bodies[1].lines as Array<{ amountSen: number }>).map(l => l.amountSen)).toEqual([1_500]);
  });

  test('a request withdrawn while its voucher is made: the draft is dropped', async () => {
    const sb = world();
    const made = await (await ask(appFor(sb, OPS, 'session'))).json() as { id: string };
    claimsDeps.createVoucher = async () => { sb.tables.payment_vouchers.push({ id: 'PV1', company_id: CO, status: 'DRAFT' }); sb.tables.payment_requests[0].status = 'WITHDRAWN'; return { ok: true, id: 'PV1', pvNumber: 'PV1' }; };
    expect((await post(finance(sb), `/r/${made.id}/voucher`, { bankAccountCode: '310-0010' })).status).toBe(409);
    expect(sb.tables.payment_vouchers[0].status).toBe('CANCELLED');
  });

  test('a failed upload leaves no receipt, and a replaced receipt goes back to rejected', async () => {
    const sb = world();
    const first = await (await handIn(appFor(sb, TECH))).json() as { id: string };
    sb.tables.staff_receipts[0].status = 'REJECTED';
    const broken = { SLIPS: { put: async () => { throw new Error('R2 down'); }, get: async () => null, delete: async () => undefined } };
    const res = await appFor(sb, TECH).request('/receipts', { method: 'POST', body: JSON.stringify({ spendDate: '2026-10-03', amountSen: 4500, files: [PNG], replacesId: first.id }), headers: { 'content-type': 'application/json' } }, broken);
    expect(res.status).toBe(502);
    expect(sb.tables.staff_receipts).toHaveLength(1);
    expect(sb.tables.staff_receipts[0].status).toBe('REJECTED');
  });

  test('a cost on a money or control account, or a project that is not the company\'s, is refused', async () => {
    const sb = world();
    sb.tables.accounts.push({ company_id: CO, account_code: '310-0010', account_name: 'Bank', account_type: 'ASSET', is_active: true, acc_money: true, parent_code: null, special_type: null });
    const a = appFor(sb, OPS, 'session');
    expect((await handIn(a, { lines: [{ amountSen: 4500, department: 'shared', accountCode: '310-0010' }] })).status).toBe(422);
    expect((await handIn(a, { lines: [{ amountSen: 4500, department: 'shared', projectId: 999 }] })).status).toBe(422);
  });
});

describe('a receipt sent again', () => {
  test('with the same id comes back as the same receipt, not a second one', async () => {
    const sb = world();
    const id = '0f7c2a1e-5b3d-4c8e-9a1f-2b3c4d5e6f70';
    const first = await handIn(appFor(sb, TECH), { id });
    expect(first.status).toBe(201);
    const again = await handIn(appFor(sb, TECH), { id });
    expect(again.status).toBe(200);
    expect(sb.tables.staff_receipts).toHaveLength(1);
    expect((await handIn(appFor(sb, CLEAN), { id })).status).toBe(409);
  });
});
