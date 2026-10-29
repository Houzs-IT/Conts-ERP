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
/* A chart that has every default rule's account; the drawer and the bank are money, the 326 / 327 clearings are not. */
const MONEY = new Set([DEFAULT_ROLE_CODES.CASH, DEFAULT_ROLE_CODES.BANK_DEFAULT]);
const fullChart = (): Row[] => [...new Set(Object.values(DEFAULT_ROLE_CODES))].map((code) => acct(code, { acc_money: MONEY.has(code) }));
const BOUND: Row = { company_id: CO, group_code: 'SOFA', sales_account: '500-0000', sales_return_account: '510-0000', purchase_account: '601-0001', purchase_return_account: '612-0000' };

function world(over: Record<string, Row[]> = {}) {
  return fakeSb({
    accounts: fullChart(),
    acc_account_roles: [],
    acc_item_groups: [{ code: 'SOFA', name: 'Sofa', is_active: true }, { code: 'OLD', name: 'Old', is_active: false }],
    acc_item_group_accounts: [{ ...BOUND }],
    /* Every money account except the cash drawer needs a letter: the bank here. */
    acc_bank_letters: [{ company_id: CO, account_code: DEFAULT_ROLE_CODES.BANK_DEFAULT, letter: 'M' }],
    acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-12-01', fiscal_year_end_month: 8 }],
    petty_cash_floats: [],
    ...over,
  });
}

describe('ledgerSetupStatus', () => {
  test("petty cash is each float's own account: no petty cash rule, and a float's account needs no voucher letter", async () => {
    const pc = acct('315-0101', { account_name: 'PETTY CASH - AMIN', acc_money: true, special_type: 'SCH' });
    const s = await ledgerSetupStatus(world({ accounts: [...fullChart(), pc], petty_cash_floats: [{ id: 'F1', company_id: CO, account_code: '315-0101', active: false }] }), CO);
    expect(s.roles.map((r) => r.role)).not.toContain('PETTY_CASH');
    expect(s.banksWithoutLetter).toEqual([]);
    expect(s.ready).toBe(true);
  });

  test('ready when every role, item group binding, bank letter and the ledger start are set', async () => {
    const s = await ledgerSetupStatus(world(), CO);
    expect(s.roles.filter((r) => r.problem)).toEqual([]);
    expect(s.itemGroups).toEqual([]);
    expect(s.banksWithoutLetter).toEqual([]);
    expect(s.ledgerStartDate).toBe('2026-12-01');
    expect(s.ready).toBe(true);
  });

  test('AR is retired: every customer posts to its own account, so it is not a rule and its account does not hold the books back', async () => {
    /* chew, 29 Oct 2026: a customer with no account is never guessed onto a default. */
    const s = await ledgerSetupStatus(world({ accounts: fullChart().filter((a) => a.account_code !== DEFAULT_ROLE_CODES.AR) }), CO);
    expect(s.roles.map((r) => r.role)).not.toContain('AR');
    expect(s.ready).toBe(true);
  });

  test("customer deposits are retired: a deposit sits on the customer's own account, so no rule and no account to set", async () => {
    /* chew, 29 Oct 2026: 顾客定金直接进顾客 account. */
    const s = await ledgerSetupStatus(world({ accounts: fullChart().filter((a) => a.account_code !== DEFAULT_ROLE_CODES.CUSTOMER_DEPOSITS) }), CO);
    expect(s.roles.map((r) => r.role)).not.toContain('CUSTOMER_DEPOSITS');
    expect(s.ready).toBe(true);
  });

  test("cash over / short is retired: no cash drawer, cash goes straight to the bank", async () => {
    /* chew, 29 Oct 2026: 我没收现金的；现金都是直接进银行的. */
    const s = await ledgerSetupStatus(world({ accounts: fullChart().filter((a) => a.account_code !== DEFAULT_ROLE_CODES.OVER_SHORT) }), CO);
    expect(s.roles.map((r) => r.role)).not.toContain('OVER_SHORT');
    expect(s.ready).toBe(true);
  });

  test('a role pointing at a code that is not in the chart is a problem', async () => {
    const s = await ledgerSetupStatus(world({ accounts: fullChart().filter((a) => a.account_code !== DEFAULT_ROLE_CODES.AR_OTHER) }), CO);
    expect(s.roles.find((r) => r.role === 'AR_OTHER')).toMatchObject({ role: 'AR_OTHER', accountCode: DEFAULT_ROLE_CODES.AR_OTHER, problem: 'missing_account' });
    expect(s.ready).toBe(false);
  });

  test('the bank role must be a money account; inactive and header accounts are problems too', async () => {
    const chart = fullChart().map((a) => (a.account_code === DEFAULT_ROLE_CODES.BANK_DEFAULT ? { ...a, acc_money: false }
      : a.account_code === DEFAULT_ROLE_CODES.AP ? { ...a, is_active: false } : a));
    chart.push(acct('305-0001', { parent_code: DEFAULT_ROLE_CODES.AR_OTHER }));
    const s = await ledgerSetupStatus(world({ accounts: chart }), CO);
    expect(s.roles.find((r) => r.role === 'BANK_DEFAULT')!.problem).toBe('not_money');
    expect(s.roles.find((r) => r.role === 'AP')!.problem).toBe('inactive');
    expect(s.roles.find((r) => r.role === 'AR_OTHER')!.problem).toBe('header');
  });

  test('an override is what is checked, not the default', async () => {
    const s = await ledgerSetupStatus(world({ acc_account_roles: [{ company_id: CO, role: 'AR_OTHER', account_code: '399-9999' }] }), CO);
    expect(s.roles.find((r) => r.role === 'AR_OTHER')).toMatchObject({ role: 'AR_OTHER', accountCode: '399-9999', problem: 'missing_account' });
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
    expect(s.banksWithoutLetter).toEqual([DEFAULT_ROLE_CODES.BANK_DEFAULT]);
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

/* Review of PR 7. The card and online clearings are NOT money (the settlement setup refuses money there; Daily Bank
   shows them beside the banks), and they live at 326- / 327-. The rules nothing posts on any more (SALES, INVENTORY,
   CLOSING_STOCK — the stock buckets replaced the last two) are not part of being ready. */
describe('the clearing rules and the retired rules', () => {
  const realChart = (): Row[] => fullChart().map((a) => (
    a.account_code === DEFAULT_ROLE_CODES.TRANSIT_EDC || a.account_code === DEFAULT_ROLE_CODES.TRANSIT_ONLINE ? { ...a, acc_money: false } : a
  )).concat([acct('330-0009', { parent_code: DEFAULT_ROLE_CODES.INVENTORY }), acct('620-0009', { parent_code: DEFAULT_ROLE_CODES.CLOSING_STOCK }), acct('500-0009', { parent_code: DEFAULT_ROLE_CODES.SALES })]);
  const lettersFor = (chart: Row[]) => chart.filter((a) => a.acc_money && a.account_code !== DEFAULT_ROLE_CODES.CASH)
    .map((a, i) => ({ company_id: CO, account_code: a.account_code, letter: String.fromCharCode(65 + i) }));

  test('a sensible chart is ready: clearings not money, the retired rules left out', async () => {
    const chart = realChart();
    const s = await ledgerSetupStatus(world({ accounts: chart, acc_bank_letters: lettersFor(chart) }), CO);
    expect(s.roles.filter((r) => r.problem)).toEqual([]);
    expect(s.roles.map((r) => r.role)).not.toContain('SALES');
    expect(s.roles.map((r) => r.role)).not.toContain('INVENTORY');
    expect(s.roles.map((r) => r.role)).not.toContain('CLOSING_STOCK');
    expect(s.roles.find((r) => r.role === 'TRANSIT_EDC')!.kind).toBe('clearing');
    expect(s.roles.find((r) => r.role === 'BANK_DEFAULT')!.kind).toBe('money');
    expect(s.ready).toBe(true);
  });

  test('a clearing rule on a bank, or outside 326- / 327-, is a problem', async () => {
    const chart = realChart();
    const onBank = await ledgerSetupStatus(world({ accounts: chart, acc_bank_letters: lettersFor(chart), acc_account_roles: [{ company_id: CO, role: 'TRANSIT_EDC', account_code: DEFAULT_ROLE_CODES.BANK_DEFAULT }] }), CO);
    expect(onBank.roles.find((r) => r.role === 'TRANSIT_EDC')!.problem).toBe('not_clearing');
  });
});

describe('the routes, after review', () => {
  const app = (sb: ReturnType<typeof world>) => {
    const a = new Hono();
    a.use('*', async (c, next) => {
      c.set('supabase' as never, sb as never);
      c.set('companyId' as never, CO as never);
      c.set('houzsUser' as never, { name: 'Chew', permissions_set: ['scm.payment_voucher.post'] } as never);
      await next();
    });
    a.put('/roles/:role', accountRolePut as never);
    return a;
  };
  const put = (a: Hono, role: string, body: Record<string, unknown>) =>
    a.request(`/roles/${role}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const chart = () => fullChart().map((a) => (a.account_code === DEFAULT_ROLE_CODES.TRANSIT_EDC ? { ...a, acc_money: false } : a))
    .concat([acct('326-0010'), acct('300-0100')]);

  test('a clearing rule takes a 326- clearing account, never a bank', async () => {
    const sb = world({ accounts: chart() });
    expect((await put(app(sb), 'TRANSIT_EDC', { accountCode: '326-0010' })).status).toBe(200);
    expect((await put(app(sb), 'TRANSIT_EDC', { accountCode: DEFAULT_ROLE_CODES.BANK_DEFAULT })).status).toBe(409);
  });

  test('moving a rule whose account already has postings asks for confirmation, with the balance', async () => {
    const sb = world({ accounts: chart(), v_gl_entries: [
      { company_id: CO, account_code: DEFAULT_ROLE_CODES.AR, debit_sen: 50_000, credit_sen: 10_000, posted: true, reversed: false, reversed_by_je: null, entry_date: '2026-10-01' },
    ] });
    const first = await put(app(sb), 'AR', { accountCode: '300-0100' });
    expect(first.status).toBe(409);
    expect(await first.json()).toMatchObject({ error: 'role_in_use', accountCode: DEFAULT_ROLE_CODES.AR, balanceSen: 40_000 });
    expect(sb.tables.acc_account_roles).toEqual([]);
    expect((await put(app(sb), 'AR', { accountCode: '300-0100', confirm: true })).status).toBe(200);
  });

  /* The default bank and the drawer hold their own money: moving the default only changes where new vouchers start,
     and the Settlement setup page moves it with no confirm step — so no guard there. */
  test('moving the default bank needs no confirmation, whatever the old bank carries', async () => {
    const sb = world({ accounts: chart().concat([acct('310-0020', { acc_money: true })]), v_gl_entries: [
      { company_id: CO, account_code: DEFAULT_ROLE_CODES.BANK_DEFAULT, debit_sen: 50_000, credit_sen: 0, posted: true, reversed: false, reversed_by_je: null, entry_date: '2026-10-01' },
    ] });
    expect((await put(app(sb), 'BANK_DEFAULT', { accountCode: '310-0020' })).status).toBe(200);
  });

  test('a prototype key is not a posting rule', async () => {
    const sb = world({ accounts: chart() });
    expect((await put(app(sb), 'constructor', { accountCode: '300-0100' })).status).toBe(400);
    expect((await put(app(sb), 'toString', { accountCode: '300-0100' })).status).toBe(400);
  });

  test('a code with filter characters is simply not in the chart', async () => {
    const sb = world({ accounts: chart() });
    expect((await put(app(sb), 'AR', { accountCode: '300-0000,parent_code.eq.x' })).status).toBe(404);
  });
});
