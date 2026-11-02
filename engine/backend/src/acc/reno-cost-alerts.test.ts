/* Renovation cost alerts (plan docs/superpowers/plans/2026-11-02-renovation-expected-cost-review.md Task 2; SOP 4.2.1,
   chew 2 Nov 2026). Pinned: the threshold (RM 500 or 5%, the larger); several POs on one line make one alert; a
   cancelled or draft PO does not count; a saving needs the line fully ordered; the project level; a kept alert stays
   kept until the gap grows by another threshold; a gone condition clears; the HOD email is off by default and sent
   once per alert when on. */
import { describe, expect, it, vi } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import { alertConditions, DEFAULT_ALERT_SETTINGS, sweepCostAlerts, thresholdSen, type AlertInput } from './reno-cost-alerts';

const S = DEFAULT_ALERT_SETTINGS;

describe('thresholdSen', () => {
  it('is RM 500 or 5% of the budget, the larger', () => {
    expect(thresholdSen(800_000, S)).toBe(50_000);
    expect(thresholdSen(6_500_000, S)).toBe(325_000);
  });
});

const input = (over: Partial<AlertInput> = {}): AlertInput => ({
  projects: [{ soDocNo: 'SO-1', expectedCostSen: 6_500_000, costSpentSen: 0, orderedNotBilledSen: 0, handedOver: false }],
  lines: [{ id: 'k', soDocNo: 'SO-1', qty: 1, costSen: 800_000, description: 'Kitchen cabinet' }],
  poItems: [],
  ...over,
});
const po = (soItemId: string, totalSen: number, qty = 1, live = true) => ({ soItemId, qty, totalSen, live, poNumber: 'PO-1' });

describe('alertConditions', () => {
  it('two POs on one line make one alert', () => {
    expect(alertConditions(input({ poItems: [po('k', 500_000), po('k', 500_000)] }), S)).toEqual([
      { soDocNo: 'SO-1', kind: 'LINE_OVER', soItemId: 'k', budgetSen: 800_000, committedSen: 1_000_000, gapSen: 200_000, label: 'Kitchen cabinet', poNumbers: ['PO-1'] },
    ]);
  });

  it('a cancelled or draft PO does not count', () => {
    expect(alertConditions(input({ poItems: [po('k', 800_000), po('k', 500_000, 1, false)] }), S)).toEqual([]);
  });

  it('inside the threshold is quiet', () => {
    expect(alertConditions(input({ poItems: [po('k', 840_000)] }), S)).toEqual([]);
    expect(alertConditions(input({ poItems: [po('k', 860_000)] }), S).map((c) => c.kind)).toEqual(['LINE_OVER']);
  });

  it('a saving needs the line fully ordered', () => {
    const two = { lines: [{ id: 'k', soDocNo: 'SO-1', qty: 2, costSen: 800_000, description: 'Kitchen cabinet' }] };
    expect(alertConditions(input({ ...two, poItems: [po('k', 600_000, 1)] }), S)).toEqual([]);
    expect(alertConditions(input({ ...two, poItems: [po('k', 600_000, 2)] }), S)).toMatchObject([{ kind: 'LINE_UNDER', gapSen: 200_000 }]);
  });

  it('the project: cost spent and ordered against the expected cost', () => {
    const at = (ordered: number) => alertConditions(input({
      lines: [], projects: [{ soDocNo: 'SO-1', expectedCostSen: 6_500_000, costSpentSen: 5_000_000, orderedNotBilledSen: ordered, handedOver: false }],
    }), S);
    expect(at(1_800_000)).toEqual([]);
    expect(at(1_900_000)).toMatchObject([{ kind: 'PROJECT_OVER', soItemId: null, budgetSen: 6_500_000, committedSen: 6_900_000, gapSen: 400_000 }]);
  });

  it('a handed-over contract raises nothing', () => {
    expect(alertConditions(input({
      projects: [{ soDocNo: 'SO-1', expectedCostSen: 100, costSpentSen: 9_000_000, orderedNotBilledSen: 0, handedOver: true }],
      poItems: [po('k', 2_000_000)],
    }), S)).toEqual([]);
  });
});

/* ── The sweep, against the tables ──────────────────────────────────────── */

const CO = 2;
const SO = 'SO-2611-001';
function world(over: Record<string, Row[]> = {}) {
  return fakeSb({
    acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-11-01' }],
    accounts: [{ company_id: CO, account_code: '620-0010', account_type: 'EXPENSE' }],
    reno_so_contracts: [{ so_doc_no: SO, company_id: CO, project_id: 7, doc_date: '2026-11-03', billed_before_golive_sen: 0, golive_cost_sen: null }],
    mfg_sales_orders: [{ doc_no: SO, company_id: CO, status: 'RENO_IN_PROGRESS', project_id: 7 }],
    mfg_sales_order_items: [{ id: 'k', doc_no: SO, company_id: CO, qty: 1, total_sen: 10_000_000, line_cost_sen: 800_000, cancelled: false,
      description: 'Kitchen cabinet', created_at: '2026-11-03T03:00:00Z' },
    /* The rest of the work, not ordered yet: the project as a whole is well inside its expected cost. */
    { id: 'w', doc_no: SO, company_id: CO, qty: 1, total_sen: 0, line_cost_sen: 5_700_000, cancelled: false,
      description: 'Wet works', created_at: '2026-11-03T03:00:00Z' }],
    purchase_orders: [
      { id: 'p1', company_id: CO, project_id: 7, status: 'SUBMITTED', total_sen: 950_000, po_date: '2026-11-05', po_number: 'PO-0123' },
    ],
    purchase_order_items: [{ id: 'i1', company_id: CO, purchase_order_id: 'p1', so_item_id: 'k', qty: 1, line_total_sen: 950_000 }],
    journal_entries: [], journal_entry_lines: [], sales_invoices: [], reno_contract_credits: [], reno_instalment_bills: [], acc_credit_notes: [],
    reno_expected_cost_changes: [], reno_cost_alerts: [],
    ...over,
  });
}
const TODAY = '2026-11-20';

describe('sweepCostAlerts', () => {
  it('raises one line alert and leaves it open on the next sweep', async () => {
    const sb = world();
    expect(await sweepCostAlerts(sb, CO, { today: TODAY })).toMatchObject({ raised: 1 });
    expect(await sweepCostAlerts(sb, CO, { today: TODAY })).toMatchObject({ raised: 0, updated: 1 });
    expect(sb.tables.reno_cost_alerts).toMatchObject([{ so_doc_no: SO, kind: 'LINE_OVER', so_item_id: 'k', status: 'OPEN', committed_sen: 950_000, gap_sen: 150_000 }]);
  });

  it('a kept alert stays kept until the gap grows by another threshold', async () => {
    const sb = world();
    await sweepCostAlerts(sb, CO, { today: TODAY });
    Object.assign(sb.tables.reno_cost_alerts[0]!, { status: 'KEPT', resolved_at: '2026-11-20T05:00:00Z' });
    expect(await sweepCostAlerts(sb, CO, { today: TODAY })).toMatchObject({ raised: 0 });
    sb.tables.purchase_order_items[0]!.line_total_sen = 1_010_000;
    expect(await sweepCostAlerts(sb, CO, { today: TODAY })).toMatchObject({ raised: 1 });
    expect(sb.tables.reno_cost_alerts.filter((a) => a.status === 'OPEN')).toHaveLength(1);
  });

  it('a gone condition clears', async () => {
    const sb = world();
    await sweepCostAlerts(sb, CO, { today: TODAY });
    sb.tables.purchase_orders[0]!.status = 'CANCELLED';
    expect(await sweepCostAlerts(sb, CO, { today: TODAY })).toMatchObject({ cleared: 1 });
    expect(sb.tables.reno_cost_alerts[0]!.status).toBe('CLEARED');
  });

  it('another company\'s alerts are left alone', async () => {
    const sb = world({ reno_cost_alerts: [{ id: 'x', company_id: 9, so_doc_no: SO, kind: 'PROJECT_OVER', so_item_id: null, status: 'OPEN', budget_sen: 1, committed_sen: 2, gap_sen: 1 }] });
    await sweepCostAlerts(sb, CO, { today: TODAY });
    expect(sb.tables.reno_cost_alerts.find((a) => a.id === 'x')!.status).toBe('OPEN');
  });

  it('the HOD email is off by default; on, each new alert is sent once', async () => {
    const send = vi.fn(async (_m: { to: string[]; subject: string; html: string }) => true);
    const off = world({ acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-11-01', reno_alert_hod_emails: 'hod@example.com' }] });
    expect(await sweepCostAlerts(off, CO, { today: TODAY, send })).toMatchObject({ mailed: 0 });
    expect(send).not.toHaveBeenCalled();

    const on = world({ acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-11-01', reno_alert_hod_notify: true, reno_alert_hod_emails: 'hod@example.com' }] });
    expect(await sweepCostAlerts(on, CO, { today: TODAY, send })).toMatchObject({ mailed: 1 });
    await sweepCostAlerts(on, CO, { today: TODAY, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ to: ['hod@example.com'] });
    expect(on.tables.reno_cost_alerts[0]!.hod_notified_at).toBeTruthy();
  });

  it('uses the company\'s own threshold', async () => {
    const sb = world({ acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-11-01', reno_alert_min_sen: 200_000, reno_alert_pct_bp: 500 }] });
    expect(await sweepCostAlerts(sb, CO, { today: TODAY })).toMatchObject({ raised: 0 });
  });
});
