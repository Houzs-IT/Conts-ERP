/* The expected-cost review routes (plan docs/superpowers/plans/2026-11-02-renovation-expected-cost-review.md Task 3;
   SOP 4.2.1). Pinned: a change is stored as an adjustment on what the expected cost is now, answers the contract's open
   alerts and shows in the log; refusals for no permission, a bad amount, no reason and a handed-over project; keep
   once only; the count is the company's own; the settings are checked. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly, type Row } from '../scm/lib/fake-postgrest';
import {
  changeExpectedCostHandler, expectedCostLogHandler, keepCostAlertHandler, listCostAlertsHandler, pendingCostAlertsHandler, putAlertSettingsHandler,
} from './reno-cost-review-routes';

const CO = 2;
const SO = 'SO-2611-001';
const alert = (id: string, over: Row = {}): Row => ({
  id, company_id: CO, so_doc_no: SO, kind: 'LINE_OVER', so_item_id: 'k', budget_sen: 800_000, committed_sen: 950_000, gap_sen: 150_000,
  status: 'OPEN', raised_at: '2026-11-20T01:00:00Z', ...over,
});
function world(over: Record<string, Row[]> = {}) {
  return publicTablesOnly(fakeSb({
    acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-10-01' }],
    accounts: [],
    reno_so_contracts: [{ so_doc_no: SO, company_id: CO, project_id: 7, doc_date: '2026-10-03', billed_before_golive_sen: 0, golive_cost_sen: null }],
    mfg_sales_orders: [{ doc_no: SO, company_id: CO, status: 'RENO_IN_PROGRESS', project_id: 7 }],
    mfg_sales_order_items: [{ id: 'k', doc_no: SO, company_id: CO, qty: 1, total_sen: 10_000_000, line_cost_sen: 6_500_000, cancelled: false,
      description: 'Kitchen cabinet', created_at: '2026-10-03T03:00:00Z' }],
    projects: [{ id: 7, company_id: CO, name: 'SKYLINE D-25-13', handed_over_at: null }],
    purchase_orders: [{ id: 'p1', company_id: CO, project_id: 7, status: 'SUBMITTED', po_number: 'PO-0123' }],
    purchase_order_items: [{ id: 'i1', company_id: CO, purchase_order_id: 'p1', so_item_id: 'k', qty: 1, line_total_sen: 950_000 }],
    journal_entries: [], journal_entry_lines: [], sales_invoices: [], reno_contract_credits: [], reno_instalment_bills: [], acc_credit_notes: [],
    reno_expected_cost_changes: [],
    reno_cost_alerts: [alert('a1'), alert('a2', { kind: 'PROJECT_OVER', so_item_id: null }), alert('z', { company_id: 9 })],
    ...over,
  }), ['projects']);
}
const app = (sb: ReturnType<typeof world>, perms: string[]) => {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('houzsUser' as never, { id: 5, name: 'Chew', permissions_set: new Set(perms) } as never);
    await next();
  });
  a.get('/reno-cost-alerts', listCostAlertsHandler as never);
  a.get('/reno-cost-alerts/pending-count', pendingCostAlertsHandler as never);
  a.post('/reno-projects/:soDocNo/expected-cost', changeExpectedCostHandler as never);
  a.post('/reno-cost-alerts/:id/keep', keepCostAlertHandler as never);
  a.get('/reno-expected-cost-log', expectedCostLogHandler as never);
  a.put('/reno-alert-settings', putAlertSettingsHandler as never);
  return a;
};
const send = (a: Hono, method: string, path: string, body: unknown = {}) =>
  a.request(path, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const FIN = ['scm.reno_estimate.change', 'scm.payment_voucher.post'];

describe('change the expected cost', () => {
  test('stores the change as an adjustment, answers the open alerts and shows in the log', async () => {
    const sb = world();
    const a = app(sb, FIN);
    const r = await send(a, 'POST', `/reno-projects/${SO}/expected-cost`, { newExpectedSen: 7_500_000, reason: 'Kitchen upgrade, HOD confirmed' });
    expect(r.status).toBe(201);
    expect(sb.tables.reno_expected_cost_changes).toMatchObject([{ so_doc_no: SO, old_expected_sen: 6_500_000, new_expected_sen: 7_500_000, adjustment_sen: 1_000_000, changed_by: 5, changed_by_name: 'Chew' }]);
    expect(sb.tables.reno_cost_alerts.filter((x) => x.company_id === CO).map((x) => x.status)).toEqual(['CHANGED', 'CHANGED']);
    expect(sb.tables.reno_cost_alerts.find((x) => x.id === 'z')!.status).toBe('OPEN');

    const log = await (await a.request('/reno-expected-cost-log')).json() as { rows: Row[] };
    expect(log.rows).toMatchObject([{
      outcome: 'Changed', projectName: 'SKYLINE D-25-13', oldSen: 6_500_000, newSen: 7_500_000, differenceSen: 1_000_000, by: 'Chew',
      reason: 'Kitchen upgrade, HOD confirmed',
    }]);
    expect(log.rows[0]!.cause).toContain('Line over budget: Kitchen cabinet (PO-0123)');
    expect(log.rows[0]!.cause).toContain('Project cost over the expected cost');
  });

  test('a second change is an adjustment on the first', async () => {
    const sb = world();
    const a = app(sb, FIN);
    await send(a, 'POST', `/reno-projects/${SO}/expected-cost`, { newExpectedSen: 7_500_000, reason: 'Up' });
    await send(a, 'POST', `/reno-projects/${SO}/expected-cost`, { newExpectedSen: 7_000_000, reason: 'Down a bit' });
    expect(sb.tables.reno_expected_cost_changes.map((x) => x.adjustment_sen)).toEqual([1_000_000, -500_000]);
    expect(sb.tables.reno_expected_cost_changes[1]!.old_expected_sen).toBe(7_500_000);
  });

  test('refusals', async () => {
    const sb = world();
    expect((await send(app(sb, ['scm.payment_voucher.post']), 'POST', `/reno-projects/${SO}/expected-cost`, { newExpectedSen: 7_500_000, reason: 'x' })).status).toBe(403);
    const a = app(sb, FIN);
    expect((await send(a, 'POST', `/reno-projects/${SO}/expected-cost`, { newExpectedSen: 7_500_000, reason: ' ' })).status).toBe(400);
    expect((await send(a, 'POST', `/reno-projects/${SO}/expected-cost`, { newExpectedSen: 0, reason: 'x' })).status).toBe(400);
    expect((await send(a, 'POST', `/reno-projects/${SO}/expected-cost`, { newExpectedSen: 'abc', reason: 'x' })).status).toBe(400);
    expect((await send(a, 'POST', '/reno-projects/SO-NONE/expected-cost', { newExpectedSen: 1, reason: 'x' })).status).toBe(404);
    const done = world({ mfg_sales_orders: [{ doc_no: SO, company_id: CO, status: 'RENO_COMPLETED', project_id: 7 }] });
    const r = await send(app(done, FIN), 'POST', `/reno-projects/${SO}/expected-cost`, { newExpectedSen: 7_500_000, reason: 'x' });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: 'closed' });
    expect(sb.tables.reno_expected_cost_changes).toEqual([]);
  });
});

describe('keep, the list and the count', () => {
  test('keep once only, with a reason, and it shows in the log', async () => {
    const sb = world();
    const a = app(sb, FIN);
    expect((await send(a, 'POST', '/reno-cost-alerts/a1/keep', { note: '' })).status).toBe(400);
    expect((await send(a, 'POST', '/reno-cost-alerts/a1/keep', { note: 'Offset by cheaper tiles' })).status).toBe(200);
    expect((await send(a, 'POST', '/reno-cost-alerts/a1/keep', { note: 'again' })).status).toBe(409);
    expect((await send(a, 'POST', '/reno-cost-alerts/z/keep', { note: 'other company' })).status).toBe(404);
    const log = await (await a.request('/reno-expected-cost-log')).json() as { rows: Row[] };
    expect(log.rows).toMatchObject([{ outcome: 'Kept', reason: 'Offset by cheaper tiles', by: 'Chew', oldSen: null }]);
  });

  test('the list says what each alert is about; the count is the company\'s open alerts', async () => {
    const a = app(world(), FIN);
    const list = await (await a.request('/reno-cost-alerts')).json() as { alerts: Row[] };
    expect(list.alerts.map((x) => x.what).sort()).toEqual(['Line over budget: Kitchen cabinet', 'Project cost over the expected cost']);
    expect(list.alerts.find((x) => x.kind === 'LINE_OVER')).toMatchObject({ project_name: 'SKYLINE D-25-13', po_numbers: ['PO-0123'] });
    expect(await (await a.request('/reno-cost-alerts/pending-count')).json()).toEqual({ count: 2 });
  });
});

describe('alert settings', () => {
  test('are checked and saved', async () => {
    const sb = world();
    const a = app(sb, FIN);
    expect((await send(a, 'PUT', '/reno-alert-settings', { minSen: 50_000, pctBp: 20_000 })).status).toBe(400);
    expect((await send(a, 'PUT', '/reno-alert-settings', { minSen: 50_000, pctBp: 500, hodNotify: true, hodEmails: '' })).status).toBe(400);
    expect((await send(a, 'PUT', '/reno-alert-settings', { minSen: 80_000, pctBp: 300, hodNotify: true, hodEmails: 'hod@example.com; boss@example.com' })).status).toBe(200);
    expect(sb.tables.acc_company_settings[0]).toMatchObject({ reno_alert_min_sen: 80_000, reno_alert_pct_bp: 300, reno_alert_hod_notify: true, reno_alert_hod_emails: 'hod@example.com, boss@example.com' });
    expect((await send(app(sb, ['scm.reno_estimate.change']), 'PUT', '/reno-alert-settings', { minSen: 1, pctBp: 1 })).status).toBe(403);
  });
});
