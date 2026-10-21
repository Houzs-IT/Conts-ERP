/* Is the ledger ready to go live? (Conts, finance phase 1, spec 3.4; gaps G8 and G9.) Pinned:
     · every posting rule names an account the chart has, active, not a header — and the money rules a bank or cash
       account; anything else is the rule's problem, named;
     · every active item group binds all four accounts;
     · every bank has its voucher letter;
     · the books have a start date;
     · ready only when all of that holds;
   and PUT /roles/:role sets ANY posting rule, with the same checks (money rules on money only). */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { ledgerSetupStatus } from '../src/conts/ledger-setup-status';
import { accountRolePut, setupStatusHandler } from '../src/scm/routes/accounting';
import { DEFAULT_ROLE_CODES } from '../src/acc/rules';

const CO = 2;
const acct = (code: string, over: Row = {}): Row => ({
  company_id: CO, account_code: code, account_name: `ACC ${code}`, account_type: 'ASSET', parent_code: null, is_active: true, acc_money: false, ...over,
});
/* A chart that has every default rule's account, the money ones marked money. */
const MONEY = new Set([DEFAULT_ROLE_CODES.CASH, DEFAULT_ROLE_CODES.BANK_DEFAULT, DEFAULT_ROLE_CODES.TRANSIT_EDC, DEFAULT_ROLE_CODES.TRANSIT_ONLINE]);
const fullChart = (): Row[] => [...new Set(Object.values(DEFAULT_ROLE_CODES))].map((code) => acct(code, { acc_money: MONEY.has(code) }));
const BOUND: Row = { company_id: CO, group_code: 'SOFA', sales_account: '500-0000', sales_return_account: '510-0000', purchase_account: '601-0001', purchase_return_account: '612-0000' };

function world(over: Record<string, Row[]> = {}) {
  return fakeSb({
    accounts: fullChart(),
    acc_account_roles: [],
    acc_item_groups: [{ code: 'SOFA', name: 'Sofa', is_active: true }, { code: 'OLD', name: 'Old', is_active: false }],
    acc_item_group_accounts: [{ ...BOUND }],
    /* Every money account except the cash drawer needs a letter: the bank and the two clearings here. */
    acc_bank_letters: [...MONEY].filter((c) => c !== DEFAULT_ROLE_CODES.CASH).map((code, i) => ({ company_id: CO, account_code: code, letter: 'MNO'[i] })),
    acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-12-01', fiscal_year_end_month: 8 }],
    ...over,
  });
}

describe('ledgerSetupStatus', () => {
  test('ready when every role, item group binding, bank letter and the ledger start are set', async () => {
    const s = await ledgerSetupStatus(world(), CO);
    expect(s.roles.filter((r) => r.problem)).toEqual([]);
    expect(s.itemGroups).toEqual([]);
    expect(s.banksWithoutLetter).toEqual([]);
    expect(s.ledgerStartDate).toBe('2026-12-01');
    expect(s.ready).toBe(true);
  });

  test('a role pointing at a code that is not in the chart is a problem', async () => {
    const s = await ledgerSetupStatus(world({ accounts: fullChart().filter((a) => a.account_code !== DEFAULT_ROLE_CODES.AR) }), CO);
    expect(s.roles.find((r) => r.role === 'AR')).toEqual({ role: 'AR', accountCode: DEFAULT_ROLE_CODES.AR, problem: 'missing_account' });
    expect(s.ready).toBe(false);
  });

  test('the bank role must be a money account; inactive and header accounts are problems too', async () => {
    const chart = fullChart().map((a) => (a.account_code === DEFAULT_ROLE_CODES.BANK_DEFAULT ? { ...a, acc_money: false }
      : a.account_code === DEFAULT_ROLE_CODES.AP ? { ...a, is_active: false } : a));
    chart.push(acct('300-0001', { parent_code: DEFAULT_ROLE_CODES.AR }));
    const s = await ledgerSetupStatus(world({ accounts: chart }), CO);
    expect(s.roles.find((r) => r.role === 'BANK_DEFAULT')!.problem).toBe('not_money');
    expect(s.roles.find((r) => r.role === 'AP')!.problem).toBe('inactive');
    expect(s.roles.find((r) => r.role === 'AR')!.problem).toBe('header');
  });

  test('an override is what is checked, not the default', async () => {
    const s = await ledgerSetupStatus(world({ acc_account_roles: [{ company_id: CO, role: 'AR', account_code: '399-9999' }] }), CO);
    expect(s.roles.find((r) => r.role === 'AR')).toEqual({ role: 'AR', accountCode: '399-9999', problem: 'missing_account' });
  });

  test('an active item group missing a binding, a bank without a letter, no start date: each named', async () => {
    const s = await ledgerSetupStatus(world({
      acc_item_groups: [{ code: 'SOFA', name: 'Sofa', is_active: true }, { code: 'BED', name: 'Bed', is_active: true }],
      acc_item_group_accounts: [{ ...BOUND, sales_return_account: null }],
      acc_bank_letters: [],
      acc_company_settings: [],
    }), CO);
    expect(s.itemGroups).toEqual([
      { group: 'BED', missing: ['sales_account', 'sales_return_account', 'purchase_account', 'purchase_return_account'] },
      { group: 'SOFA', missing: ['sales_return_account'] },
    ]);
    expect(s.banksWithoutLetter).toEqual([DEFAULT_ROLE_CODES.BANK_DEFAULT, DEFAULT_ROLE_CODES.TRANSIT_EDC, DEFAULT_ROLE_CODES.TRANSIT_ONLINE].sort());
    expect(s.ledgerStartDate).toBeNull();
    expect(s.ready).toBe(false);
  });
});

describe('the routes', () => {
  const app = (sb: ReturnType<typeof world>, perms: string[] = ['scm.payment_voucher.post']) => {
    const a = new Hono();
    a.use('*', async (c, next) => {
      c.set('supabase' as never, sb as never);
      c.set('companyId' as never, CO as never);
      c.set('houzsUser' as never, { name: 'Chew', permissions_set: perms } as never);
      await next();
    });
    a.put('/roles/:role', accountRolePut as never);
    a.get('/setup-status', setupStatusHandler as never);
    return a;
  };
  const put = (a: Hono, role: string, accountCode: string) =>
    a.request(`/roles/${role}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountCode }) });

  test('PUT /roles/AR saves any role', async () => {
    const sb = world({ accounts: [...fullChart(), acct('300-0100')] });
    const res = await put(app(sb), 'AR', '300-0100');
    expect(res.status, await res.clone().text()).toBe(200);
    expect(sb.tables.acc_account_roles).toEqual([expect.objectContaining({ company_id: CO, role: 'AR', account_code: '300-0100' })]);
  });

  /* The statuses the default-bank route always answered: 404 not in the chart, 409 the wrong kind of account. */
  test('PUT /roles/CASH refuses a non-money account; an unknown role, a header, a missing account and a missing key are refused', async () => {
    const sb = world({ accounts: [...fullChart(), acct('300-0100'), acct('300-0200', { parent_code: DEFAULT_ROLE_CODES.AR })] });
    expect((await put(app(sb), 'CASH', '300-0100')).status).toBe(409);
    expect((await put(app(sb), 'NOT_A_ROLE', '300-0100')).status).toBe(400);
    expect((await put(app(sb), 'AR', DEFAULT_ROLE_CODES.AR)).status).toBe(409); // 300-0200 sits under it
    expect((await put(app(sb), 'AR', '399-9999')).status).toBe(404);
    expect((await put(app(sb, []), 'AR', '300-0100')).status).toBe(403);
    expect(sb.tables.acc_account_roles).toEqual([]);
  });

  test('GET /setup-status answers the status', async () => {
    const res = await app(world()).request('/setup-status');
    expect(res.status).toBe(200);
    expect((await res.json() as { ready: boolean }).ready).toBe(true);
  });
});
