/* A payment voucher line's Rental unit (chew 2 Nov 2026; SOP 3.2; plan docs/superpowers/plans/2026-11-02-voucher-
   purpose-unit-project-pickers.md Task 2). Pinned:
     · a Rental line carries its unit to the ledger; a non-Rental line and a leg settling bills never do;
     · a unit on a non-Rental line, or one that is not a Property OS unit, is refused;
     · editing a voucher keeps each line's unit unless the edit names another or clears it. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly, type Row } from '../src/scm/lib/fake-postgrest';
import { pvLines } from '../src/acc/rules';
import { buildLines, updatePaymentVoucherHandler } from '../src/scm/routes/payment-vouchers';

describe('pvLines', () => {
  const pv = { pv_number: 'PV-1', payee_name: 'Aircond Sdn Bhd', credit_account_code: '310-0010' };
  const supplier = { code: '400-A001', name: 'Aircond Sdn Bhd' };
  test('a Rental leg carries its unit; another department does not; nor does a leg on the AP control', () => {
    const lines = pvLines(pv, [
      { description: 'A-3-1 aircond', debit_account_code: '620-0010', myrSen: 35_000, department: 'rental', unit_id: 'u-a31' },
      { description: 'Office', debit_account_code: '620-0020', myrSen: 10_000, department: 'shared', unit_id: 'u-a31' },
    ], supplier);
    expect(lines.filter((l) => l.debitSen).map((l) => l.unitId ?? null)).toEqual(['u-a31', null]);
    const ap = pvLines(pv, [{ description: 'Bills', debit_account_code: '400-A001', myrSen: 35_000, department: 'rental', unit_id: 'u-a31' }], supplier, '400-A001');
    expect(ap[0]!.unitId ?? null).toBeNull();
  });
});

describe('buildLines', () => {
  test('a unit only on a Rental line; no unitId means unchanged', () => {
    expect(buildLines([{ debitAccountCode: '620-0010', amountSen: 100, department: 'shared', unitId: 'u-a31' }])).toEqual({ error: 'unit_not_rental' });
    const ok = buildLines([{ debitAccountCode: '620-0010', amountSen: 100, department: 'rental', unitId: 'u-a31' }, { debitAccountCode: '620-0010', amountSen: 100, department: 'rental' }]);
    expect('rows' in ok && ok.rows.map((r) => r.unit_id)).toEqual(['u-a31', undefined]);
  });
});

const CO = 2;
const DRAFT: Row = {
  id: 'pv-1', pv_number: '2990-Draft-2612-001', company_id: CO, voucher_date: '2026-12-03',
  payee_name: 'Aircond', credit_account_code: '310-0010', total_sen: 35_000, currency: 'MYR', exchange_rate: 1,
  status: 'DRAFT', purpose: 'GENERAL_EXPENSE', supplier_id: null, notes: null,
  submitted_at: null, submitted_by: null, checked_at: null, checked_by: null, approved_at: null, approved_by: null,
};
function harness() {
  const sb = publicTablesOnly(fakeSb({
    accounts: [
      { company_id: CO, account_code: '310-0010', account_name: 'MAYBANK', parent_code: null, is_active: true, acc_money: true, everyday_expense: false },
      { company_id: CO, account_code: '620-0010', account_name: 'REPAIRS', parent_code: null, is_active: true, acc_money: false, everyday_expense: false },
    ],
    acc_account_roles: [], acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-12-01', fiscal_year_end_month: 8 }],
    companies: [{ id: CO, code: '2990' }], entity_audit_log: [], journal_entries: [], journal_entry_lines: [],
    projects: [], project_limit_requests: [], purchase_invoices: [], purchase_orders: [], ap_invoice_lines: [], pv_allocations: [],
    conts_units: [{ id: 'u-a31', building: 'ASTER HILL', unit_number: 'A-3-1' }, { id: 'u-b22', building: 'ASTER HILL', unit_number: 'B-2-2' }],
    payment_voucher_lines: [
      { id: 'l1', pv_id: 'pv-1', company_id: CO, line_no: 1, description: 'A-3-1 aircond', debit_account_code: '620-0010', amount_sen: 35_000, department: 'rental', unit_id: 'u-a31', project_id: null },
    ],
    payment_vouchers: [{ ...DRAFT }],
  }), ['projects', 'project_brands', 'conts_units']);
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('user' as never, { id: 'u1' } as never);
    c.set('houzsUser' as never, { name: 'Chew', permissions_set: ['scm.payment_voucher.write'] } as never);
    c.set('allowedCompanyIds' as never, [CO] as never);
    c.set('companies' as never, [{ id: CO, code: '2990' }] as never);
    c.set('companyCode' as never, '2990' as never);
    await next();
  });
  app.patch('/payment-vouchers/:id', updatePaymentVoucherHandler as never);
  return { app, sb };
}
const patch = (app: Hono, body: unknown) => app.request('/payment-vouchers/pv-1', { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const line = (over: Row = {}) => ({ debitAccountCode: '620-0010', description: 'A-3-1 aircond repair', amountSen: 35_000, department: 'rental', ...over });

describe('editing a voucher', () => {
  test('keeps the unit when the edit does not name one', async () => {
    const { app, sb } = harness();
    expect((await patch(app, { lines: [line()] })).status).toBe(200);
    expect(sb.tables.payment_voucher_lines.map((l) => [l.description, l.unit_id])).toEqual([['A-3-1 aircond repair', 'u-a31']]);
  });

  test('takes another unit, or clears it', async () => {
    const { app, sb } = harness();
    await patch(app, { lines: [line({ unitId: 'u-b22' })] });
    expect(sb.tables.payment_voucher_lines[0]!.unit_id).toBe('u-b22');
    await patch(app, { lines: [line({ unitId: null })] });
    expect(sb.tables.payment_voucher_lines[0]!.unit_id).toBeNull();
  });

  test('a line moved off Rental drops its unit', async () => {
    const { app, sb } = harness();
    await patch(app, { lines: [line({ department: 'shared' })] });
    expect(sb.tables.payment_voucher_lines[0]!.unit_id ?? null).toBeNull();
  });

  test('refuses a unit that is not a Property OS unit, and a unit on a non-Rental line', async () => {
    const { app, sb } = harness();
    const r = await patch(app, { lines: [line({ unitId: 'nope' })] });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: 'unit_unknown' });
    expect((await patch(app, { lines: [line({ department: 'shared', unitId: 'u-a31' })] })).status).toBe(400);
    expect(sb.tables.payment_voucher_lines[0]!.unit_id).toBe('u-a31');
  });
});
