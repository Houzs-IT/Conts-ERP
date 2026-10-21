/* "Post now" (Conts, finance phase 1, spec 3.6): a person who holds prepare, check AND approve walks a payment
   voucher through all four layers in one request. Every step is still stamped with who and when, through the
   same doors the four buttons use. Pinned:
     · a draft voucher posts in one request: prepared, checked (formal number minted), approved, POSTED, one journal;
     · steps already done are skipped: a checked voucher is not checked again and keeps its number;
     · a bank with no voucher letter stops at the check: 409 bank_letter_missing, no journal, still a draft;
     · without all three keys it is refused, and nothing is stamped.
   Bare Hono + fakeSb, mounting the exported handler (as tests/ledgerStartRoutes.test.ts). */

import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { postNowHandler } from '../src/conts/pv-post-now';

const CO = 2;
const FULL = ['scm.payment_voucher.write', 'scm.payment_voucher.check', 'scm.payment_voucher.approve'];

const CHART: Row[] = [
  { company_id: CO, account_code: '310-0010', account_name: 'MAYBANK', parent_code: null, is_active: true, acc_money: true },
  { company_id: CO, account_code: '900-0000', account_name: 'RENT', parent_code: null, is_active: true, acc_money: false },
];

const DRAFT: Row = {
  id: 'pv-1', pv_number: '2990-Draft-2612-001', company_id: CO, voucher_date: '2026-12-03',
  payee_name: 'Landlord', credit_account_code: '310-0010', total_sen: 10000, currency: 'MYR', exchange_rate: 1,
  status: 'DRAFT', purpose: 'GENERAL_EXPENSE', supplier_id: null, notes: null,
  submitted_at: null, submitted_by: null, checked_at: null, checked_by: null, approved_at: null, approved_by: null,
};

function harness(tables: Record<string, Row[]> = {}, perms: readonly string[] = FULL) {
  const sb = fakeSb(
    {
      accounts: CHART.map((r) => ({ ...r })),
      acc_account_roles: [],
      acc_bank_letters: [{ company_id: CO, account_code: '310-0010', letter: 'M' }],
      acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-12-01', fiscal_year_end_month: 8 }],
      acc_numbering: [],
      companies: [{ id: CO, code: '2990' }],
      entity_audit_log: [],
      journal_entries: [],
      journal_entry_lines: [],
      payment_voucher_lines: [{ pv_id: 'pv-1', line_no: 1, description: 'Rent', debit_account_code: '900-0000', amount_sen: 10000 }],
      payment_vouchers: [{ ...DRAFT }],
      pv_allocations: [],
      ...tables,
    },
    {},
    [{ table: 'payment_vouchers', column: 'pv_number', name: 'payment_vouchers_pv_number_key' }],
  );
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('user' as never, { id: 'u1' } as never);
    c.set('houzsUser' as never, { name: 'Chew', permissions_set: perms } as never);
    c.set('allowedCompanyIds' as never, [CO] as never);
    c.set('companies' as never, [{ id: CO, code: '2990' }] as never);
    c.set('companyCode' as never, '2990' as never);
    await next();
  });
  app.post('/payment-vouchers/:id/post-now', postNowHandler as never);
  return { app, sb };
}

const postNow = (app: Hono) => app.request('/payment-vouchers/pv-1/post-now', { method: 'POST' });

describe('Post now', () => {
  test('posts a draft voucher in one request', async () => {
    const { app, sb } = harness();
    const res = await postNow(app);
    expect(res.status).toBe(200);
    const pv = sb.tables.payment_vouchers[0];
    expect(pv).toMatchObject({ status: 'POSTED', pv_number: '2990-MPV-2612-001', submitted_by: 'Chew', checked_by: 'Chew', approved_by: 'Chew' });
    expect(pv.submitted_at).toBeTruthy();
    expect(pv.checked_at).toBeTruthy();
    expect(pv.approved_at).toBeTruthy();
    expect(sb.tables.journal_entries).toHaveLength(1);
    expect(sb.tables.entity_audit_log.map((r) => r.action)).toEqual(expect.arrayContaining(['SUBMIT_FOR_APPROVAL', 'CHECK', 'APPROVE']));
  });

  test('skips steps already done', async () => {
    const checked = { ...DRAFT, pv_number: '2990-MPV-2612-007', submitted_at: '2026-12-03T01:00:00Z', submitted_by: 'Clerk', checked_at: '2026-12-03T02:00:00Z', checked_by: 'Ah Kow' };
    const { app, sb } = harness({ payment_vouchers: [checked] });
    const res = await postNow(app);
    expect(res.status).toBe(200);
    const pv = sb.tables.payment_vouchers[0];
    expect(pv).toMatchObject({ status: 'POSTED', pv_number: '2990-MPV-2612-007', submitted_by: 'Clerk', checked_by: 'Ah Kow', approved_by: 'Chew' });
    expect(sb.tables.entity_audit_log.map((r) => r.action)).not.toContain('CHECK');
  });

  test('stops when the bank has no letter', async () => {
    const { app, sb } = harness({ acc_bank_letters: [] });
    const res = await postNow(app);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('bank_letter_missing');
    expect(sb.tables.journal_entries).toHaveLength(0);
    expect(sb.tables.payment_vouchers[0]).toMatchObject({ status: 'DRAFT', checked_at: null, approved_at: null });
  });

  test.each([
    ['write', ['scm.payment_voucher.check', 'scm.payment_voucher.approve']],
    ['check', ['scm.payment_voucher.write', 'scm.payment_voucher.approve']],
    ['approve', ['scm.payment_voucher.write', 'scm.payment_voucher.check']],
  ])('refuses a user without %s, and stamps nothing', async (_missing, perms) => {
    const { app, sb } = harness({}, perms);
    const res = await postNow(app);
    expect(res.status).toBe(403);
    expect(sb.tables.payment_vouchers[0]).toMatchObject({ status: 'DRAFT', submitted_at: null, checked_at: null });
  });
});
