/* Finance's To do, read from the books (Conts; ported from Houzs accounting-todo). Pinned:
     · a payment request waits on the same rule as the Payment requests menu count: started on (a live voucher or AP
       invoice) it is no longer finance's job; utility bills wait by their due date;
     · claims, vouchers, supplier bills, limit requests, draft receipts and e-invoices each raise their job;
     · a read that fails is named, never shown as nothing waiting; the badge counts the caller's jobs;
     · the rule switches: read back, refused without Ledger full, an unknown rule refused, a switched-off rule silent. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly } from '../scm/lib/fake-postgrest';
import { financeTodoCountHandler, financeTodoHandler, todoSettingsGetHandler, todoSettingsPutHandler } from './finance-todo-routes';
import { todayMyt } from '../scm/lib/my-time';
import { addDays } from './finance-todo';
/* eslint-disable @typescript-eslint/no-explicit-any -- the page's JSON, read loosely */

const CO = 1;
const TODAY = todayMyt();
const FULL = ['scm.ledger.use', 'scm.payment_voucher.create', 'scm.payment_voucher.write', 'scm.payment_voucher.check', 'scm.payment_voucher.approve', 'scm.project_limit.approve'];
const VIEW = ['scm.ledger.use'];

const world = () => publicTablesOnly(fakeSb({
  acc_todo_settings: [],
  payment_requests: [
    { id: 'R1', company_id: CO, request_no: 'PRQ-1', payee_name: 'ACE HARDWARE', amount_sen: 10_000, status: 'SUBMITTED', created_at: '2026-11-01T02:00:00Z', wanted_on: null, source_key: null, ap_invoice_id: null },
    { id: 'R2', company_id: CO, request_no: 'PRQ-2', payee_name: 'KIAN', amount_sen: 20_000, status: 'SUBMITTED', created_at: '2026-11-01T02:00:00Z', wanted_on: null, source_key: null, ap_invoice_id: null },
    { id: 'R3', company_id: CO, request_no: 'PRQ-3', payee_name: 'TNB', amount_sen: 5_000, status: 'SUBMITTED', created_at: '2026-11-01T02:00:00Z', wanted_on: addDays(TODAY, 2), source_key: 'utility:b1:TNB', ap_invoice_id: null },
    { id: 'R4', company_id: CO, request_no: 'PRQ-4', payee_name: 'PAID', amount_sen: 5_000, status: 'PAID', created_at: '2026-11-01T02:00:00Z', wanted_on: null, source_key: null, ap_invoice_id: null },
  ],
  payment_vouchers: [
    { id: 'PV1', company_id: CO, pv_number: 'PV-1', status: 'DRAFT', payment_request_id: 'R2', payee_name: 'KIAN', total_sen: 20_000, exchange_rate: 1, submitted_at: null, submitted_by: null, checked_at: null, checked_by: null, approved_at: null, posted_at: null },
    { id: 'PV2', company_id: CO, pv_number: 'PV-2', status: 'DRAFT', payment_request_id: null, payee_name: 'LIM', total_sen: 7_000, exchange_rate: 1, submitted_at: '2026-11-01T02:00:00Z', submitted_by: 'Daniel', checked_at: null, checked_by: null, approved_at: null, posted_at: null },
  ],
  payment_voucher_lines: [],
  ap_invoices: [
    { id: 'AP1', company_id: CO, invoice_number: 'AP-1', supplier_id: 'S1', due_date: addDays(TODAY, -3), exchange_rate: 1, total_sen: 9_000, paid_sen: 1_000, status: 'PARTIALLY_PAID' },
    { id: 'AP2', company_id: CO, invoice_number: 'AP-2', supplier_id: 'S1', due_date: addDays(TODAY, 30), exchange_rate: 1, total_sen: 9_000, paid_sen: 0, status: 'POSTED' },
  ],
  suppliers: [{ id: 'S1', company_id: CO, name: 'ACE HARDWARE' }],
  staff_receipts: [
    { id: 'C1', company_id: CO, receipt_no: 'CL-1', submitter_user_id: 'u-tech', float_id: null, amount_sen: 500, status: 'HANDED_IN', created_at: '2026-11-01T02:00:00Z', checked_at: null, payback_pv_id: null },
    { id: 'C2', company_id: CO, receipt_no: 'CL-2', submitter_user_id: 'u-tech', float_id: null, amount_sen: 800, status: 'CHECKED', created_at: '2026-11-01T02:00:00Z', checked_at: '2026-11-01T03:00:00Z', payback_pv_id: null },
    { id: 'C3', company_id: CO, receipt_no: 'CL-3', submitter_user_id: 'u-tech', float_id: null, amount_sen: 800, status: 'CHECKED', created_at: '2026-11-01T02:00:00Z', checked_at: '2026-11-01T03:00:00Z', payback_pv_id: 'PV9' },
  ],
  conts_staff: [{ id: 'u-tech', full_name: 'Ah Wai' }],
  project_limit_requests: [{ id: 'L1', company_id: CO, project_id: 7, amount_sen: 50_000, status: 'PENDING', requested_by: 'Alvin', requested_by_id: '9', created_at: '2026-11-01T02:00:00Z', decided_at: null }],
  projects: [{ id: 7, company_id: CO, code: 'P7', name: 'SKYLINE' }],
  acc_bank_statement_config: [], accounts: [], acc_bank_statements: [], acc_bank_statement_lines: [], acc_bank_month_locks: [],
  acc_official_receipts: [{ id: 1, company_id: CO, or_number: 'DR-1', customer_name: 'WONG', amount_sen: 30_000, paid_at: '2026-11-01', status: 'DRAFT', issued_at: null }],
  acc_company_settings: [{ company_id: CO, deposit_invoice_enabled: false, deposit_invoice_from: null }],
  acc_einvoice_outbox: [{ id: 'E1', company_id: CO, doc_number: 'INV-1', status: 'NOT_READY', missing: ['buyer TIN'], prepared_at: '2026-11-01T02:00:00Z' }],
  v_account_balances: [{ company_id: CO, account_code: '100', total_debit_sen: 100, total_credit_sen: 100 }],
}), ['conts_staff', 'projects']);

const app = (sb: ReturnType<typeof world>, perms: string[], id = '7') => {
  const a = new Hono<{ Variables: Record<string, unknown> }>();
  a.use('*', async (c, next) => {
    c.set('supabase', sb);
    c.set('companyId', CO);
    c.set('houzsUser', { id, name: 'Mei Ling', permissions_set: new Set(perms) });
    await next();
  });
  a.get('/todo', financeTodoHandler);
  a.get('/todo/count', financeTodoCountHandler);
  a.get('/todo/settings', todoSettingsGetHandler);
  a.put('/todo/settings', todoSettingsPutHandler);
  return a;
};
type App = ReturnType<typeof app>;
const page = async (a: App): Promise<any> => (await a.request('/todo')).json();
const put = (a: App, body: unknown) => a.request('/todo/settings', { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe("Finance's To do", () => {
  test('each item raises its job, on the rule the Payment requests menu counts by', async () => {
    const p = await page(app(world(), FULL));
    expect(p.problems).toEqual([]);
    const byRule = Object.fromEntries((p.mine as any[]).map((j) => [j.rule, j]));
    /* R2 has a voucher: finance started on it. R3 is a utility bill due in two days. */
    expect(byRule.requests).toMatchObject({ title: 'Pay 1 payment request', detail: 'ACE HARDWARE', amountSen: 10_000 });
    expect(byRule.utilities).toMatchObject({ title: expect.stringMatching(/^Pay 1 utility bill due by /), amountSen: 5_000 });
    expect(byRule['claims-check']).toMatchObject({ title: 'Check 1 staff claim', detail: 'Handed in by Ah Wai' });
    expect(byRule['claims-pay']).toMatchObject({ title: 'Pay back 1 staff claim', amountSen: 800 });
    expect(byRule['pv-check']).toMatchObject({ title: 'Check 1 payment voucher', detail: 'Prepared by Daniel · LIM' });
    expect(byRule['ap-overdue']).toMatchObject({ title: 'Pay 1 overdue supplier bill', detail: 'AP-1 ACE HARDWARE', amountSen: 8_000 });
    expect(byRule['ap-due']).toBeUndefined();
    expect(byRule.limits).toMatchObject({ title: 'Decide 1 project limit request', detail: 'SKYLINE · asked by Alvin' });
    expect(byRule.receipts).toMatchObject({ title: 'Confirm 1 customer payment received', amountSen: 30_000 });
    expect(byRule.einvoice).toMatchObject({ title: 'Fix 1 e-invoice' });
    expect(byRule['deposit-invoices']).toBeUndefined();
    expect(p.checklist.items.find((c: any) => c.key === 'trial-balance')).toMatchObject({ value: '0.00', state: 'ok' });
    expect((await (await app(world(), FULL).request('/todo/count')).json())).toEqual({ count: p.mine.length });
  });

  test('a viewer who only opens the Ledger has nothing waiting on them, and sees who it waits on', async () => {
    const p = await page(app(world(), VIEW));
    expect(p.mine).toEqual([]);
    expect(new Set((p.others as any[]).map((j) => j.who))).toEqual(new Set(['Finance', 'Checker', 'Approver']));
    expect(await (await app(world(), VIEW).request('/todo/count')).json()).toEqual({ count: 0 });
  });

  test('a read that fails is named, and the rest is still shown', async () => {
    const sb = world();
    (sb as any).from = ((orig) => (t: string) => (t === 'acc_einvoice_outbox' ? { select: () => { throw new Error('timeout'); } } : orig(t)))(sb.from);
    const p = await page(app(sb, FULL));
    expect(p.problems).toEqual(['e-invoices (timeout)']);
    expect((p.mine as any[]).some((j) => j.rule === 'requests')).toBe(true);
  });
});

describe('To do rules', () => {
  test('switched off, a rule is silent; only Ledger full may switch, and only rules that exist', async () => {
    const sb = world();
    expect(await (await app(sb, FULL).request('/todo/settings')).json()).toEqual({ rulesOff: [], mayEdit: true });
    expect(await (await app(sb, VIEW).request('/todo/settings')).json()).toEqual({ rulesOff: [], mayEdit: false });
    expect((await put(app(sb, VIEW), { rulesOff: ['requests'] })).status).toBe(403);
    expect((await put(app(sb, FULL), { rulesOff: ['card-missing'] })).status).toBe(400);
    expect((await put(app(sb, FULL), { rulesOff: 'requests' })).status).toBe(400);
    expect((await put(app(sb, FULL), { rulesOff: ['requests', 'einvoice'] })).status).toBe(200);
    expect(await (await app(sb, FULL).request('/todo/settings')).json()).toEqual({ rulesOff: ['requests', 'einvoice'], mayEdit: true });
    const rules = ((await page(app(sb, FULL))).mine as any[]).map((j) => j.rule);
    expect(rules).not.toContain('requests');
    expect(rules).not.toContain('einvoice');
    expect(rules).toContain('utilities');
  });
});
