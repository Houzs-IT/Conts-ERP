/* Finance's petty cash (Conts; SOP 6; design 2026-10-28 §4.5). Pinned:
     · the overview balance follows the float's events and receipts; a department or keeper has one active float;
     · checking a float receipt posts one CLM journal; a receipt finance pays back posts none at check;
     · a rejection needs a reason; a write-off needs full access; a repayment adds the cash back once;
     · a top-up drafts a voucher of float − balance on the float; paying a person back needs their bank details. */
import { Hono } from 'hono';
import { afterEach, describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly } from '../scm/lib/fake-postgrest';
import {
/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */
  checkReceiptsHandler, claimsDeps, createFloatHandler, listFloatsHandler, receiptVoucherHandler, rejectReceiptHandler,
  repaidReceiptHandler, topUpHandler, writeOffReceiptHandler, EDIT_KEY, FULL_KEY,
} from './petty-cash-routes';

const CO = 1;
const CHART = ['320-0100', '905-0000', '305-0100', '310-0010'].map(code => ({ account_code: code, account_name: code, account_type: 'ASSET', parent_code: null, is_active: true, company_id: CO }));
const receipt = (over: Record<string, unknown>) => ({
  company_id: CO, receipt_no: 'CLM-2611-001', submitter_user_id: 'u-tech', float_id: 'F1', spend_date: '2026-11-03', amount_sen: 4500,
  vendor_name: null, note: null, status: 'HANDED_IN', reject_reason: null, checked_at: null, checked_by: null, topup_pv_id: null,
  payback_pv_id: null, replaces_id: null, source: 'field_app', created_at: '2026-11-03T00:00:00Z', ...over,
});
const world = () => publicTablesOnly(fakeSb({
  petty_cash_floats: [{ id: 'F1', company_id: CO, department_id: 'maint', keeper_user_id: 'u-keeper', float_sen: 100000, warn_pct: 20, active: true, topup_requested_at: null }],
  petty_cash_events: [{ id: 'E1', float_id: 'F1', kind: 'PAID_IN', amount_sen: 100000, event_date: '2026-11-01' }],
  staff_receipts: [receipt({ id: 'R1' }), receipt({ id: 'R2', receipt_no: 'CLM-2611-002', float_id: null, submitter_user_id: 'u-ops', amount_sen: 3000 })],
  staff_receipt_lines: [
    { id: 'L1', receipt_id: 'R1', department: 'rental', unit_id: null, maintenance_issue_id: 'M1', project_id: null, account_code: '905-0000', amount_sen: 4500, description: 'Tap', sort: 0 },
    { id: 'L2', receipt_id: 'R2', department: 'shared', unit_id: null, maintenance_issue_id: null, project_id: null, account_code: '905-0000', amount_sen: 3000, description: 'Paper', sort: 0 },
  ],
  staff_receipt_files: [], staff_bank_details: [], payment_vouchers: [],
  accounts: CHART, journal_entries: [], journal_entry_lines: [],
  acc_account_roles: [{ company_id: CO, role: 'PETTY_CASH', account_code: '320-0100' }],
  acc_company_settings: [{ company_id: CO, ledger_start_date: null, fiscal_year_end_month: 8 }],
  conts_staff: [{ id: 'u-keeper', full_name: 'Ah Keong' }, { id: 'u-tech', full_name: 'Ah Wai' }, { id: 'u-ops', full_name: 'Wei Wen' }],
  conts_departments: [{ id: 'maint', name: 'Maintenance' }],
  conts_employee_bank: [],
}), ['conts_staff', 'conts_departments', 'conts_employee_bank', 'projects']);

const app = (sb: ReturnType<typeof world>, perms: string[]) => {
  const a = new Hono<{ Variables: Record<string, unknown> }>();
  a.use('*', async (c, next) => {
    c.set('supabase', sb);
    c.set('companyId', CO);
    c.set('houzsUser', { name: 'Chew', permissions_set: new Set(perms) });
    await next();
  });
  a.get('/floats', listFloatsHandler);
  a.post('/floats', createFloatHandler);
  a.post('/floats/:id/top-up', topUpHandler);
  a.post('/receipts/check', checkReceiptsHandler);
  a.post('/receipts/:id/reject', rejectReceiptHandler);
  a.post('/receipts/:id/repaid', repaidReceiptHandler);
  a.post('/receipts/:id/write-off', writeOffReceiptHandler);
  a.post('/receipts/:id/voucher', receiptVoucherHandler);
  return a;
};
const post = (a: Hono<{ Variables: Record<string, unknown> }>, path: string, body: unknown = {}) => a.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const made: Array<Record<string, unknown>> = [];
const realCreate = claimsDeps.createVoucher;
const fakeVoucher = (sb: ReturnType<typeof world>) => {
  claimsDeps.createVoucher = async (_c, body) => {
    made.push(body);
    sb.tables.payment_vouchers.push({ id: `PV${made.length}`, company_id: CO, pv_number: `HCDraft-2611-00${made.length}`, status: 'DRAFT' });
    return { ok: true, id: `PV${made.length}`, pvNumber: `HCDraft-2611-00${made.length}` };
  };
};
afterEach(() => { claimsDeps.createVoucher = realCreate; made.length = 0; });

describe('the overview', () => {
  test('balance is money paid in less receipts handed in on the float', async () => {
    const res = await (await app(world(), []).request('/floats')).json() as any;
    expect(res.floats[0]).toMatchObject({ keeperName: 'Ah Keong', departmentName: 'Maintenance', floatSen: 100000, balanceSen: 95500, waitingCheckSen: 4500, waitingCheckCount: 1, low: false });
    expect(res.totals).toMatchObject({ floatSen: 100000, balanceSen: 95500 });
  });
  test('a department or a keeper has one active float', async () => {
    const a = app(world(), [FULL_KEY]);
    expect((await post(a, '/floats', { departmentId: 'maint', keeperUserId: 'u-x', floatSen: 50000 })).status).toBe(409);
    expect((await post(a, '/floats', { departmentId: 'clean', keeperUserId: 'u-keeper', floatSen: 50000 })).status).toBe(409);
    expect((await post(a, '/floats', { departmentId: 'clean', keeperUserId: 'u-x', floatSen: 50000 })).status).toBe(201);
    expect((await post(app(world(), [EDIT_KEY]), '/floats', { departmentId: 'clean', keeperUserId: 'u-x', floatSen: 1 })).status).toBe(403);
  });
});

describe('checking', () => {
  test('a float receipt posts one CLM journal; a receipt finance pays back posts none', async () => {
    const sb = world();
    const res = await post(app(sb, [EDIT_KEY]), '/receipts/check', { items: [{ id: 'R1' }, { id: 'R2' }] });
    expect(res.status).toBe(200);
    expect(sb.tables.journal_entries.map(j => j.source_doc_no)).toEqual(['CLM-2611-001']);
    expect(sb.tables.staff_receipts.map(r => r.status)).toEqual(['CHECKED', 'CHECKED']);
  });
  test('a corrected amount moves the single line and the balance', async () => {
    const sb = world();
    await post(app(sb, [EDIT_KEY]), '/receipts/check', { items: [{ id: 'R1', amountSen: 5400 }] });
    expect(sb.tables.staff_receipts[0].amount_sen).toBe(5400);
    expect(sb.tables.staff_receipt_lines.filter(l => l.receipt_id === 'R1').map(l => l.amount_sen)).toEqual([5400]);
    const res = await (await app(sb, []).request('/floats')).json() as any;
    expect(res.floats[0].balanceSen).toBe(94600);
  });
  test('a line without an account is not checked', async () => {
    const sb = world();
    sb.tables.staff_receipt_lines[0].account_code = null;
    const res = await (await post(app(sb, [EDIT_KEY]), '/receipts/check', { items: [{ id: 'R1' }] })).json() as any;
    expect(res.results[0]).toMatchObject({ ok: false, error: 'account_missing' });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });
});

describe('rejecting, repaying, writing off', () => {
  test('a rejection needs a reason; a repayment adds the cash back once', async () => {
    const sb = world();
    const a = app(sb, [EDIT_KEY]);
    expect((await post(a, '/receipts/R1/reject', { reason: '' })).status).toBe(422);
    expect((await post(a, '/receipts/R1/reject', { reason: 'Not a receipt' })).status).toBe(200);
    expect((await (await a.request('/floats')).json() as any).floats[0].balanceSen).toBe(95500);
    expect((await post(a, '/receipts/R1/repaid')).status).toBe(200);
    expect((await post(a, '/receipts/R1/repaid')).status).toBe(409);
    expect((await (await a.request('/floats')).json() as any).floats[0].balanceSen).toBe(100000);
  });
  test('a write-off needs full access and posts Dr the chosen account, Cr petty cash', async () => {
    const sb = world();
    await post(app(sb, [EDIT_KEY]), '/receipts/R1/reject', { reason: 'Lost' });
    expect((await post(app(sb, [EDIT_KEY]), '/receipts/R1/write-off', { accountCode: '305-0100' })).status).toBe(403);
    expect((await post(app(sb, [FULL_KEY]), '/receipts/R1/write-off', { accountCode: '305-0100' })).status).toBe(200);
    expect(sb.tables.journal_entries[0]).toMatchObject({ source_type: 'CLW' });
    expect(sb.tables.staff_receipts[0].status).toBe('WRITTEN_OFF');
  });
});

describe('money out', () => {
  test('a top-up drafts float − balance on the petty cash account, linked to the float', async () => {
    const sb = world();
    fakeVoucher(sb);
    const res = await post(app(sb, [FULL_KEY]), '/floats/F1/top-up', { bankAccountCode: '310-0010' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ amountSen: 4500 });
    expect(made[0]).toMatchObject({ creditAccountCode: '310-0010', purpose: 'OTHER', payeeName: 'Ah Keong' });
    expect((made[0].lines as any[])[0]).toMatchObject({ debitAccountCode: '320-0100', amountSen: 4500 });
    expect(sb.tables.payment_vouchers[0].petty_cash_float_id).toBe('F1');
    expect((await post(app(sb, [FULL_KEY]), '/floats/F1/top-up', { bankAccountCode: '310-0010' })).status).toBe(409);
  });
  test('paying a person back needs a checked receipt and bank details', async () => {
    const sb = world();
    fakeVoucher(sb);
    const a = app(sb, [FULL_KEY, EDIT_KEY]);
    expect((await post(a, '/receipts/R2/voucher', { bankAccountCode: '310-0010' })).status).toBe(409);
    await post(a, '/receipts/check', { items: [{ id: 'R2' }] });
    expect(await (await post(a, '/receipts/R2/voucher', { bankAccountCode: '310-0010' })).json()).toMatchObject({ error: 'bank_details_missing' });
    sb.tables.staff_bank_details.push({ company_id: CO, user_id: 'u-ops', bank_name: 'Maybank', account_no: '1234567890', account_name: 'Wei Wen' });
    expect((await post(a, '/receipts/R2/voucher', { bankAccountCode: '310-0010' })).status).toBe(201);
    expect(made[0]).toMatchObject({ payeeName: 'Wei Wen' });
    expect(sb.tables.staff_receipts[1].payback_pv_id).toBe('PV1');
    expect(sb.tables.payment_vouchers[0].staff_receipt_id).toBe('R2');
    expect((await post(a, '/receipts/R1/voucher', { bankAccountCode: '310-0010' })).status).toBe(409);
  });
});

describe('what a receipt may book to', () => {
  test('never a bank, petty cash or a control account; the write-off the same', async () => {
    const sb = world();
    sb.tables.accounts.push({ account_code: '400-0000', account_name: 'AP', account_type: 'LIABILITY', parent_code: null, is_active: true, company_id: CO });
    const res = await (await post(app(sb, [EDIT_KEY]), '/receipts/check', { items: [{ id: 'R1', lines: [{ department: 'rental', accountCode: '400-0000', amountSen: 4500 }] }] })).json() as any;
    expect(res.results[0]).toMatchObject({ ok: false, error: 'account_not_allowed' });
    const toPetty = await (await post(app(sb, [EDIT_KEY]), '/receipts/check', { items: [{ id: 'R1', lines: [{ department: 'rental', accountCode: '320-0100', amountSen: 4500 }] }] })).json() as any;
    expect(toPetty.results[0]).toMatchObject({ ok: false, error: 'account_not_allowed' });
    expect(sb.tables.staff_receipts[0].status).toBe('HANDED_IN');
    expect(sb.tables.journal_entries).toHaveLength(0);
    await post(app(sb, [EDIT_KEY]), '/receipts/R1/reject', { reason: 'Lost' });
    expect((await post(app(sb, [FULL_KEY]), '/receipts/R1/write-off', { accountCode: '310-0010' })).status).toBe(422);
  });
  test('a failed journal leaves the receipt waiting, not checked', async () => {
    const sb = world();
    sb.tables.acc_company_settings[0].ledger_start_date = null;
    sb.tables.acc_account_roles.length = 0; // petty cash back on the cash drawer's account: nothing is booked
    const res = await (await post(app(sb, [EDIT_KEY]), '/receipts/check', { items: [{ id: 'R1' }] })).json() as any;
    expect(res.results[0]).toMatchObject({ ok: false, error: 'journal_failed' });
    expect(sb.tables.staff_receipts[0].status).toBe('HANDED_IN');
  });
});

describe('twice', () => {
  test('a second pay-back for the same receipt is refused', async () => {
    const sb = world();
    fakeVoucher(sb);
    const a = app(sb, [FULL_KEY, EDIT_KEY]);
    sb.tables.staff_bank_details.push({ company_id: CO, user_id: 'u-ops', bank_name: 'Maybank', account_no: '1234567890', account_name: 'Wei Wen' });
    await post(a, '/receipts/check', { items: [{ id: 'R2' }] });
    expect((await post(a, '/receipts/R2/voucher', { bankAccountCode: '310-0010' })).status).toBe(201);
    expect((await post(a, '/receipts/R2/voucher', { bankAccountCode: '310-0010' })).status).toBe(409);
    expect(made).toHaveLength(1);
  });
  test('the top-up covers the receipts checked when it is raised, not later ones', async () => {
    const sb = world();
    fakeVoucher(sb);
    await post(app(sb, [EDIT_KEY]), '/receipts/check', { items: [{ id: 'R1' }] });
    await post(app(sb, [FULL_KEY]), '/floats/F1/top-up', { bankAccountCode: '310-0010' });
    expect(sb.tables.staff_receipts[0].topup_pv_id).toBe('PV1');
  });
});
