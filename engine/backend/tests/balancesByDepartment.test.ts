/* The trial balance by department (Conts, finance phase 1, spec 3.5). GET /accounting/balances?department= reads the
   chosen department's posted lines (a reversal pair counts in neither, as the whole-company view leaves them out) and
   answers in the view's own shape, every account listed; without ?department= it is the view, as before. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { balancesHandler } from '../src/scm/routes/accounting';

const CO = 2;
const ACCOUNTS: Row[] = [
  { company_id: CO, account_code: '310-0010', account_name: 'BANK', account_type: 'ASSET', parent_code: null, section: 'CURRENT ASSETS' },
  { company_id: CO, account_code: '590-0000', account_name: 'RENT RECEIVED', account_type: 'INCOME', parent_code: null, section: 'OTHER INCOMES' },
  { company_id: CO, account_code: '900-A001', account_name: 'ADVERT', account_type: 'EXPENSE', parent_code: null, section: 'EXPENSES' },
];
const gl = (code: string, type: string, dr: number, cr: number, department: string, over: Row = {}): Row => ({
  company_id: CO, account_code: code, account_name: code, account_type: type, debit_sen: dr, credit_sen: cr,
  entry_date: '2026-12-05', posted: true, reversed: false, reversed_by_je: null, department, ...over,
});

function harness() {
  const sb = fakeSb({
    accounts: ACCOUNTS.map((r) => ({ ...r })),
    v_gl_entries: [
      gl('590-0000', 'INCOME', 0, 150_000, 'rental'), gl('310-0010', 'ASSET', 150_000, 0, 'rental'),
      gl('900-A001', 'EXPENSE', 12_000, 0, 'shared'), gl('310-0010', 'ASSET', 0, 12_000, 'shared'),
      gl('590-0000', 'INCOME', 0, 9_999, 'rental', { reversed: true, reversed_by_je: 'je-c' }),
      gl('310-0010', 'ASSET', 9_999, 0, 'rental', { reversed: true, reversed_by_je: 'je-c' }),
    ],
    v_account_balances: [{ company_id: CO, account_code: '310-0010', account_name: 'BANK', account_type: 'ASSET', total_debit_sen: 1, total_credit_sen: 0, balance_sen: 1 }],
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('allowedCompanyIds' as never, [CO] as never);
    await next();
  });
  app.get('/balances', balancesHandler as never);
  return app;
}

type Bal = { account_code: string; total_debit_sen: number; total_credit_sen: number; balance_sen: number };
const get = async (app: Hono, qs: string) => (await (await app.request(`/balances${qs}`)).json() as { balances: Bal[] }).balances;

describe('the trial balance by department', () => {
  test('rental: only its lines, every account listed, balances on the natural side', async () => {
    const rows = await get(harness(), '?department=rental');
    expect(rows.map((r) => [r.account_code, r.total_debit_sen, r.total_credit_sen, r.balance_sen])).toEqual([
      ['310-0010', 150_000, 0, 150_000],
      ['590-0000', 0, 150_000, 150_000],
      ['900-A001', 0, 0, 0],
    ]);
  });

  test('without a department it is the whole-company view, as before; an unknown one is a 400', async () => {
    const app = harness();
    expect(await get(app, '')).toEqual([expect.objectContaining({ account_code: '310-0010', balance_sen: 1 })]);
    expect((await app.request('/balances?department=hq')).status).toBe(400);
  });
});
