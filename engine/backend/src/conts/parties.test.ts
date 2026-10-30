/* Customers and suppliers imported from AutoCount's chart (Conts, finance phase 1.5; spec section 3): every SDR
   sub-account becomes a debtor under its control, every SCR one a supplier; the suppliers the ERP already holds are
   matched by name and take AutoCount's code. */
import { describe, expect, test } from 'vitest';
import { fakeSb } from '../scm/lib/fake-postgrest';
import { importParties, suggestSupplierMatches, type ParsedParty } from './parties';

const CO = 1;
const P = (code: string, name: string, controlCode: string, kind: ParsedParty['kind']): ParsedParty => ({ code, name, controlCode, kind });

describe('importing parties', () => {
  test('imports debtors under their control', async () => {
    const sb = fakeSb({ debtors: [], suppliers: [] });
    const r = await importParties(sb, CO, [P('301-M001', 'MS YAP (MAPLE A10-02)', '301-0000', 'DEBTOR')], {});
    expect(r).toMatchObject({ debtors: 1, creditors: 0, errors: [] });
    expect(sb.tables.debtors[0]).toMatchObject({ company_id: CO, code: '301-M001', name: 'MS YAP (MAPLE A10-02)', control_account: '301-0000', is_active: true });
  });

  test('a second import keeps a name finance changed', async () => {
    const sb = fakeSb({ debtors: [{ id: 'd1', company_id: CO, code: '301-M001', name: 'MS YAP', control_account: '301-0000', is_active: true }], suppliers: [] });
    const r = await importParties(sb, CO, [P('301-M001', 'MS YAP (MAPLE A10-02)', '301-0000', 'DEBTOR')], {});
    expect(r).toMatchObject({ debtors: 0, kept: 1 });
    expect(sb.tables.debtors).toHaveLength(1);
    expect(sb.tables.debtors[0].name).toBe('MS YAP');
  });

  test('a matched supplier takes the AutoCount code and control', async () => {
    const sb = fakeSb({ debtors: [], suppliers: [{ id: 'sup-h', company_id: CO, code: 'HOOKKA', name: 'HOOKKA INDUSTRIES SDN BHD', control_account: null }] });
    const r = await importParties(sb, CO, [P('400-H006', 'HOOKKA MANUFACTURING SDN BHD', '400-0000', 'CREDITOR')], { '400-H006': 'sup-h' });
    expect(r).toMatchObject({ creditors: 0, renamed: 1, errors: [] });
    expect(sb.tables.suppliers).toHaveLength(1);
    expect(sb.tables.suppliers[0]).toMatchObject({ code: '400-H006', control_account: '400-0000', name: 'HOOKKA INDUSTRIES SDN BHD' });
  });

  test('an unmatched creditor becomes a new supplier', async () => {
    const sb = fakeSb({ debtors: [], suppliers: [] });
    const r = await importParties(sb, CO, [P('405-O001', 'OC - ABNB ELECTRICAL', '405-0000', 'CREDITOR')], {});
    expect(r).toMatchObject({ creditors: 1 });
    expect(sb.tables.suppliers[0]).toMatchObject({ company_id: CO, code: '405-O001', name: 'OC - ABNB ELECTRICAL', control_account: '405-0000' });
  });

  test('a supplier already holding the AutoCount code only gains its control', async () => {
    const sb = fakeSb({ debtors: [], suppliers: [{ id: 's1', company_id: CO, code: '400-A001', name: 'AR RAYYAN', control_account: null }] });
    const r = await importParties(sb, CO, [P('400-A001', 'AR RAYYAN SHAH RESOURCES', '400-0000', 'CREDITOR')], {});
    expect(r).toMatchObject({ creditors: 0, kept: 1 });
    expect(sb.tables.suppliers[0]).toMatchObject({ name: 'AR RAYYAN', control_account: '400-0000' });
  });

  test('a match naming a supplier of another company is a row error', async () => {
    const sb = fakeSb({ debtors: [], suppliers: [{ id: 'x', company_id: 2, code: 'HOOKKA', name: 'HOOKKA', control_account: null }] });
    const r = await importParties(sb, CO, [P('400-H006', 'HOOKKA MANUFACTURING SDN BHD', '400-0000', 'CREDITOR')], { '400-H006': 'x' });
    expect(r.errors[0]).toMatchObject({ code: '400-H006' });
    expect(sb.tables.suppliers[0].code).toBe('HOOKKA');
  });
});

describe('suggesting supplier matches', () => {
  const existing = [
    { id: 'h', code: 'HOOKKA', name: 'HOOKKA INDUSTRIES SDN BHD' },
    { id: 'l', code: 'LOTWIN', name: 'LOT WIN LED LIGHTINGS (PUCHONG) SDN BHD' },
    { id: 'd', code: 'DHI', name: 'DHI FLOOR' },
    { id: 'k', code: 'KKGYPSUM', name: 'K & K GYPSUM MARKETING SDN BHD' },
  ];
  const parties = [
    P('400-H006', 'HOOKKA MANUFACTURING SDN BHD', '400-0000', 'CREDITOR'),
    P('400-H004', 'HIN LIM FURNITURE MANUFACTURER SDN BHD', '400-0000', 'CREDITOR'),
    P('400-L001', 'LOT WIN LED LIGHTINGS', '400-0000', 'CREDITOR'),
    P('400-K003', 'K & K GYPSUM MARKETING SDN BHD', '400-0000', 'CREDITOR'),
    P('301-M001', 'MS DHI', '301-0000', 'DEBTOR'),
  ];

  test('pairs HOOKKA, LOT WIN and K & K, and nothing for DHI FLOOR', () => {
    expect(suggestSupplierMatches(existing, parties)).toEqual({ '400-H006': 'h', '400-L001': 'l', '400-K003': 'k' });
  });

  test('a supplier already on its AutoCount code is not offered again', () => {
    expect(suggestSupplierMatches([{ id: 'h', code: '400-H006', name: 'HOOKKA' }], parties)).toEqual({});
  });
});

describe('suggesting supplier matches, best pair first', () => {
  test('the closest creditor wins even when a weaker one comes first in the file', () => {
    const r = suggestSupplierMatches([{ id: 'h', code: 'HOOKKA', name: 'HOOKKA INDUSTRIES SDN BHD' }], [
      P('400-H001', 'HOOKKA TRADING', '400-0000', 'CREDITOR'),
      P('400-H006', 'HOOKKA INDUSTRIES SDN BHD', '400-0000', 'CREDITOR'),
    ]);
    expect(r).toEqual({ '400-H006': 'h' });
  });

  test('a tie is left for finance to choose', () => {
    expect(suggestSupplierMatches([{ id: 'h', code: 'HOOKKA', name: 'HOOKKA' }], [
      P('400-H001', 'HOOKKA TRADING', '400-0000', 'CREDITOR'),
      P('400-H006', 'HOOKKA INDUSTRIES', '400-0000', 'CREDITOR'),
    ])).toEqual({});
  });

  test('a repeated word counts once', () => {
    expect(suggestSupplierMatches([{ id: 'k', code: 'KK', name: 'K & K TRADING' }], [
      P('400-K003', 'K & K GYPSUM MARKETING SDN BHD', '400-0000', 'CREDITOR'),
    ])).toEqual({});
  });
});

describe('importing parties, a batch already saved', () => {
  test('a row that is already there counts as kept, not as an error', async () => {
    const sb = fakeSb({ debtors: [], suppliers: [] }, {}, [{ table: 'debtors', column: 'code' }]);
    // Another import wrote this code between the read and the insert.
    const orig = sb.from.bind(sb);
    let calls = 0;
    (sb as { from: typeof sb.from }).from = ((t: string) => {
      // The second call is the batch insert: the row lands just after the read saw nothing.
      if (t === 'debtors' && ++calls === 2) sb.tables.debtors.push({ company_id: CO, code: '301-M001', name: 'X', control_account: '301-0000' });
      return orig(t);
    }) as typeof sb.from;
    const r = await importParties(sb, CO, [P('301-M001', 'MS YAP', '301-0000', 'DEBTOR'), P('301-M002', 'MR LIM', '301-0000', 'DEBTOR')], {});
    expect(r).toMatchObject({ debtors: 1, kept: 1, errors: [] });
  });
});

describe('suggesting supplier matches, codes', () => {
  test('a supplier already on another AutoCount-shaped code is left alone', () => {
    expect(suggestSupplierMatches([{ id: 'h', code: '400-H999', name: 'HOOKKA INDUSTRIES SDN BHD' }], [
      P('400-H006', 'HOOKKA INDUSTRIES SDN BHD', '400-0000', 'CREDITOR'),
    ])).toEqual({});
  });
});

/* PR B: every customer and supplier posts to its own control (spec 2.4). */
describe('the control a party posts to', () => {
  test('a debtor posts to its own control', async () => {
    const { debtorControl } = await import('./parties');
    const sb = fakeSb({ debtors: [{ id: 'd1', company_id: CO, code: '301-M001', name: 'MS LEE', control_account: '301-0000', is_active: true }] });
    expect(await debtorControl(sb, CO, '301-M001')).toEqual({ ok: true, control: '301-0000' });
  });

  test('an unknown or empty debtor code has no control, and its posting is refused — never guessed onto the AR rule', async () => {
    /* chew, 29 Oct 2026: 不知道就别乱记账，等 finance 处理. */
    const { debtorControl, resolveDebtorRoles } = await import('./parties');
    const sb = fakeSb({ debtors: [], acc_account_roles: [] });
    expect(await debtorControl(sb, CO, '301-M999')).toEqual({ ok: true, control: null });
    expect(await debtorControl(sb, CO, null)).toEqual({ ok: true, control: null });
    const unknown = await resolveDebtorRoles(sb, CO, '301-M999');
    expect(unknown).toMatchObject({ ok: false, noAccount: true });
    expect((unknown as { error: string }).error).toContain('Customer 301-M999 has no account');
    const none = await resolveDebtorRoles(sb, CO, '  ');
    expect(none).toMatchObject({ ok: false, noAccount: true });
    expect((none as { error: string }).error).toContain('names no customer');
  });

  test("a customer with a control posts AR to that control", async () => {
    const { resolveDebtorRoles } = await import('./parties');
    const sb = fakeSb({ debtors: [{ id: 'd1', company_id: CO, code: '302-M001', name: 'MS LEE', control_account: '302-0000', is_active: true }], acc_account_roles: [] });
    const r = await resolveDebtorRoles(sb, CO, '302-M001');
    expect(r.ok && r.roles.AR).toBe('302-0000');
  });

  test('a read that fails is not read as "no control"', async () => {
    const { debtorControl } = await import('./parties');
    const sb = fakeSb({ debtors: [] }, { debtors: ['control_account'] });
    expect(await debtorControl(sb, CO, '301-M001')).toMatchObject({ ok: false });
  });

  test('a supplier with a control uses it; one without keeps the 405- rule', async () => {
    const { apControlFor } = await import('./parties');
    const { DEFAULT_ROLE_CODES } = await import('../acc/rules');
    expect(apControlFor(DEFAULT_ROLE_CODES, { code: '400-K001', control_account: '405-0000' })).toBe('405-0000');
    expect(apControlFor(DEFAULT_ROLE_CODES, { code: '405-O001', control_account: null })).toBe(DEFAULT_ROLE_CODES.AP_OTHER);
    expect(apControlFor(DEFAULT_ROLE_CODES, { code: 'DHI' })).toBe(DEFAULT_ROLE_CODES.AP);
  });
});

/* PR B: a new customer gets a debtor, coded like AutoCount (SOP 2.1). */
describe('debtor codes', () => {
  test('the letter: MR / MS and their kin are M, anyone else their first letter, a digit 0', async () => {
    const { debtorLetter } = await import('./parties');
    expect(debtorLetter('MS LEE')).toBe('M');
    expect(debtorLetter('MR. / MS. LEE SOH TENG')).toBe('M');
    expect(debtorLetter('Dr. Kris See')).toBe('D'); // as AutoCount coded him (301-D001): only the MR / MS family is M
    expect(debtorLetter('HOOKKA MANUFACTURING')).toBe('H');
    expect(debtorLetter('  the 2990 home')).toBe('T');
    expect(debtorLetter('2RIO SDN BHD')).toBe('0');
    expect(debtorLetter('MSIG INSURANCE')).toBe('M');
    expect(debtorLetter('MARVANT EVOLUTIONS')).toBe('M');
  });

  test('the next number: one past the highest, three digits at least, no ceiling', async () => {
    const { nextPartyCode } = await import('./parties');
    expect(nextPartyCode('301', 'M', ['301-M154', '301-M009', '301-H001', '302-M200'])).toBe('301-M155');
    expect(nextPartyCode('301', 'M', ['301-M999'])).toBe('301-M1000');
    expect(nextPartyCode('301', 'H', [])).toBe('301-H001');
    expect(nextPartyCode('301', 'M', ['301-MAXX', '301-M0007'])).toBe('301-M008');
  });
});

describe('opening a debtor for a new order', () => {
  const MAP = [
    { company_id: CO, order_kind: 'RENOVATION', control_account: '301-0000' },
    { company_id: CO, order_kind: 'INHOUSE_RENOVATION', control_account: '302-0000' },
  ];

  test('a renovation customer gets the next 301 code', async () => {
    const { ensureDebtor } = await import('./parties');
    const sb = fakeSb({ acc_debtor_control_map: MAP.map((r) => ({ ...r })), acc_account_roles: [], debtors: [{ id: 'd1', company_id: CO, code: '301-M154', name: 'MS IRIS', control_account: '301-0000', customer_id: null, phone: '011', is_active: true }] });
    const r = await ensureDebtor(sb, CO, { name: 'MS CHEW', phone: '012', customerId: 'c-9', orderKind: 'RENOVATION' });
    expect(r).toEqual({ ok: true, code: '301-M155', created: true });
    expect(sb.tables.debtors.find((d) => d.code === '301-M155')).toMatchObject({ name: 'MS CHEW', phone: '012', customer_id: 'c-9', control_account: '301-0000' });
  });

  test('the second order for the same customer reuses the debtor — by customer, else by name and phone', async () => {
    const { ensureDebtor } = await import('./parties');
    const sb = fakeSb({ acc_debtor_control_map: MAP.map((r) => ({ ...r })), acc_account_roles: [], debtors: [] });
    const a = await ensureDebtor(sb, CO, { name: 'MS CHEW', phone: '012', customerId: 'c-9', orderKind: 'RENOVATION' });
    const b = await ensureDebtor(sb, CO, { name: 'MS CHEW', phone: '012', customerId: 'c-9', orderKind: 'RENOVATION' });
    const c = await ensureDebtor(sb, CO, { name: ' ms chew ', phone: '012', customerId: null, orderKind: 'RENOVATION' });
    expect([a, b, c].map((x) => x.ok && x.code)).toEqual(['301-M001', '301-M001', '301-M001']);
    expect(b).toMatchObject({ created: false });
    expect(sb.tables.debtors).toHaveLength(1);
  });

  test('a kind with no control row opens no debtor — finance chooses the account, never the AR rule (chew, 29 Oct 2026)', async () => {
    const { ensureDebtor } = await import('./parties');
    const sb = fakeSb({ acc_debtor_control_map: MAP.map((r) => ({ ...r })), acc_account_roles: [], debtors: [] });
    const r = await ensureDebtor(sb, CO, { name: 'HOOKKA', phone: null, customerId: null, orderKind: 'STANDARD' });
    expect(r).toEqual({ ok: true, code: null, created: false });
    expect(sb.tables.debtors).toHaveLength(0);
  });

  test('the same customer on a job of the other kind gets a debtor of its own under that control (chew, 24 Oct 2026)', async () => {
    const { ensureDebtor } = await import('./parties');
    const sb = fakeSb({ acc_debtor_control_map: MAP.map((r) => ({ ...r })), acc_account_roles: [], debtors: [{ id: 'd1', company_id: CO, code: '301-M001', name: 'MS LEE', control_account: '301-0000', customer_id: 'c-9', phone: '012', is_active: true }] });
    expect(await ensureDebtor(sb, CO, { name: 'MS LEE', phone: '012', customerId: 'c-9', orderKind: 'INHOUSE_RENOVATION' })).toEqual({ ok: true, code: '302-M001', created: true });
    expect(await ensureDebtor(sb, CO, { name: 'MS LEE', phone: '012', customerId: 'c-9', orderKind: 'RENOVATION' })).toEqual({ ok: true, code: '301-M001', created: false });
    expect(sb.tables.debtors.find((d) => d.code === '302-M001')).toMatchObject({ customer_id: 'c-9', control_account: '302-0000' });
  });

  test('a walk-in with no phone is not attached to another customer of the same name', async () => {
    const { ensureDebtor } = await import('./parties');
    const sb = fakeSb({ acc_debtor_control_map: MAP.map((r) => ({ ...r })), acc_account_roles: [], debtors: [{ id: 'd1', company_id: CO, code: '301-M001', name: 'MR TAN', control_account: '301-0000', customer_id: null, phone: null, is_active: true }] });
    const r = await ensureDebtor(sb, CO, { name: 'MR TAN', phone: null, customerId: 'c-7', orderKind: 'RENOVATION' });
    expect(r).toEqual({ ok: true, code: '301-M002', created: true });
  });

  test('a name and phone match takes on the customer; one already tied to another customer is not it', async () => {
    const { ensureDebtor } = await import('./parties');
    const sb = fakeSb({ acc_debtor_control_map: MAP.map((r) => ({ ...r })), acc_account_roles: [], debtors: [
      { id: 'd1', company_id: CO, code: '301-M001', name: 'MS LEE', control_account: '301-0000', customer_id: null, phone: '012', is_active: true },
      { id: 'd2', company_id: CO, code: '301-M002', name: 'MS WONG', control_account: '301-0000', customer_id: 'c-1', phone: '013', is_active: true },
    ] });
    expect(await ensureDebtor(sb, CO, { name: 'MS LEE', phone: '012', customerId: 'c-9', orderKind: 'RENOVATION' })).toEqual({ ok: true, code: '301-M001', created: false });
    expect(sb.tables.debtors[0].customer_id).toBe('c-9');
    expect(await ensureDebtor(sb, CO, { name: 'MS WONG', phone: '013', customerId: 'c-2', orderKind: 'RENOVATION' })).toEqual({ ok: true, code: '301-M003', created: true });
  });

  test('two orders racing for a new customer get one debtor and no clash', async () => {
    const { ensureDebtor } = await import('./parties');
    const sb = fakeSb({ acc_debtor_control_map: MAP.map((r) => ({ ...r })), acc_account_roles: [], debtors: [] }, {}, [{ table: 'debtors', column: 'code' }]);
    const [a, b] = await Promise.all([
      ensureDebtor(sb, CO, { name: 'MS CHEW', phone: '012', customerId: 'c-9', orderKind: 'RENOVATION' }),
      ensureDebtor(sb, CO, { name: 'MR TAN', phone: '013', customerId: 'c-8', orderKind: 'RENOVATION' }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(new Set(sb.tables.debtors.map((d) => d.code)).size).toBe(2);
  });
});

describe('opening a debtor inside a renovation transaction', () => {
  /* The SQL the function sends, answered from memory: enough to pin its order of questions and its retry. */
  const fakeDb = (debtors: Array<{ code: string; name: string; phone: string | null; customer_id: string | null; control_account?: string }>, map: Record<string, string>) => {
    const sent: string[] = [];
    /* A debtor's control: its own, else the one its code sits under. */
    const ctl = (d: { code: string; control_account?: string }) => d.control_account ?? `${d.code.slice(0, 3)}-0000`;
    return {
      sent, debtors,
      async q<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
        sent.push(text.split(/\s+/).slice(0, 4).join(' '));
        if (/customer_id = \$2/.test(text)) return debtors.filter((d) => d.customer_id === params[1] && ctl(d) === params[2]).map((d) => ({ code: d.code })) as T[];
        if (/upper\(btrim\(name\)\)/.test(text)) return debtors.filter((d) => d.name.trim().toUpperCase() === String(params[1]).trim().toUpperCase() && (d.phone ?? '') === (params[2] ?? '') && ctl(d) === params[4]).map((d) => ({ code: d.code })) as T[];
        if (/^update scm.debtors set customer_id/.test(text)) {
          for (const d of debtors) if (d.code === params[1] && !d.customer_id) d.customer_id = String(params[2]);
          return [] as T[];
        }
        if (/acc_debtor_control_map/.test(text)) return (map[String(params[1])] ? [{ control_account: map[String(params[1])] }] : []) as T[];
        if (/acc_account_roles/.test(text)) return [] as T[];
        if (/code like \$2/.test(text)) return debtors.filter((d) => d.code.startsWith(String(params[1]).replace('%', ''))).map((d) => ({ code: d.code })) as T[];
        if (/insert into scm.debtors/.test(text)) {
          if (debtors.some((d) => d.code === params[1])) return [] as T[];
          debtors.push({ code: String(params[1]), name: String(params[2]), phone: (params[5] as string | null) ?? null, customer_id: (params[4] as string | null) ?? null, control_account: String(params[3]) });
          return [{ code: params[1] }] as T[];
        }
        throw new Error(`unexpected ${text}`);
      },
    };
  };

  test('a renovation customer gets the next 301 code, and the same customer keeps it', async () => {
    const { ensureDebtorSql } = await import('./parties');
    const db = fakeDb([{ code: '301-M154', name: 'MS IRIS', phone: '011', customer_id: null }], { RENOVATION: '301-0000' });
    expect(await ensureDebtorSql(db, CO, { name: 'MS CHEW', phone: '012', customerId: 'c-9', orderKind: 'RENOVATION' })).toBe('301-M155');
    expect(await ensureDebtorSql(db, CO, { name: 'MS CHEW', phone: '012', customerId: 'c-9', orderKind: 'RENOVATION' })).toBe('301-M155');
    expect(db.debtors).toHaveLength(2);
  });

  test('a code taken a moment ago is skipped, not fatal', async () => {
    const { ensureDebtorSql } = await import('./parties');
    const db = fakeDb([], { RENOVATION: '301-0000' });
    const q = db.q.bind(db);
    let first = true;
    db.q = async <T,>(text: string, params?: readonly unknown[]) => {
      // Another transaction takes 301-M001 between this one's look and its insert.
      if (first && /insert into scm.debtors/.test(text)) { first = false; db.debtors.push({ code: '301-M001', name: 'MR TAN', phone: null, customer_id: 'c-8' }); }
      return q<T>(text, params);
    };
    expect(await ensureDebtorSql(db, CO, { name: 'MS CHEW', phone: '012', customerId: 'c-9', orderKind: 'RENOVATION' })).toBe('301-M002');
  });

  test('the same customer on a job of the other kind gets a debtor of its own', async () => {
    const { ensureDebtorSql } = await import('./parties');
    const db = fakeDb([{ code: '301-M001', name: 'MS LEE', phone: '012', customer_id: 'c-9', control_account: '301-0000' }], { RENOVATION: '301-0000', INHOUSE_RENOVATION: '302-0000' });
    expect(await ensureDebtorSql(db, CO, { name: 'MS LEE', phone: '012', customerId: 'c-9', orderKind: 'INHOUSE_RENOVATION' })).toBe('302-M001');
    expect(await ensureDebtorSql(db, CO, { name: 'MS LEE', phone: '012', customerId: 'c-9', orderKind: 'RENOVATION' })).toBe('301-M001');
  });

  test('a customer with no phone is not matched by name alone', async () => {
    const { ensureDebtorSql } = await import('./parties');
    const db = fakeDb([{ code: '301-M001', name: 'MR TAN', phone: null, customer_id: null }], { RENOVATION: '301-0000' });
    expect(await ensureDebtorSql(db, CO, { name: 'MR TAN', phone: null, customerId: 'c-7', orderKind: 'RENOVATION' })).toBe('301-M002');
  });

  test('a per-project debtor is never reused', async () => {
    /* One customer account per project (spec 2.5; chew 30 Oct 2026): MS LEE's second project is a new debtor, named with
       its unit as AutoCount names them. */
    const { ensureDebtorSql } = await import('./parties');
    const db = fakeDb([{ code: '301-M001', name: 'MS LEE', phone: '012', customer_id: 'c-9', control_account: '301-0000' }], { RENOVATION: '301-0000' });
    const input = { name: 'MS LEE', phone: '012', customerId: 'c-9', orderKind: 'RENOVATION' as const, perProject: true, unitLabel: 'SKYLINE D-25-13' };
    expect(await ensureDebtorSql(db, CO, input)).toBe('301-M002');
    expect(db.debtors.find((d) => d.code === '301-M002')).toMatchObject({ name: 'MS LEE (SKYLINE D-25-13)', customer_id: 'c-9', control_account: '301-0000' });
    /* Never looked up by customer or by name: a third project opens a third account. */
    expect(await ensureDebtorSql(db, CO, { ...input, unitLabel: 'TROFI A-3-1' })).toBe('301-M003');
    expect(db.debtors.find((d) => d.code === '301-M003')?.name).toBe('MS LEE (TROFI A-3-1)');
  });

  test('a per-project debtor with no control row still opens nothing', async () => {
    const { ensureDebtorSql } = await import('./parties');
    const db = fakeDb([], {});
    expect(await ensureDebtorSql(db, CO, { name: 'MS LEE', phone: null, customerId: null, orderKind: 'RENOVATION', perProject: true, unitLabel: 'X' })).toBeNull();
    expect(db.debtors).toHaveLength(0);
  });

  test('a kind with no control row opens no debtor — never the AR rule', async () => {
    const { ensureDebtorSql } = await import('./parties');
    const db = fakeDb([], { RENOVATION: '301-0000' });
    expect(await ensureDebtorSql(db, CO, { name: 'HOOKKA', phone: null, customerId: 'c-7', orderKind: 'STANDARD' })).toBeNull();
    expect(db.debtors).toHaveLength(0);
    expect(db.sent.some((s) => /acc_account_roles|insert/.test(s))).toBe(false);
  });
});

describe('the kind of a renovation contract, for its customer control', () => {
  /* The two questions it asks — the project's own kind, the brand's — answered from memory. */
  const db = (projectKind: string | null, brandKind: string | null) => ({
    async q<T>(text: string): Promise<T[]> {
      if (/from public\.projects/.test(text)) return [{ finance_kind: projectKind }] as T[];
      if (/from public\.project_brands/.test(text)) return [{ finance_kind: brandKind }] as T[];
      throw new Error(`unexpected ${text}`);
    },
  });

  test('follows the brand: The Conts is inhouse renovation, Dream Crafter renovation', async () => {
    const { contractOrderKind } = await import('./parties');
    expect(await contractOrderKind(db(null, 'INHOUSE_RENOVATION'), 7, 2)).toBe('INHOUSE_RENOVATION');
    expect(await contractOrderKind(db(null, 'RENOVATION'), 7, 1)).toBe('RENOVATION');
  });

  test('a kind the project names wins over the brand', async () => {
    const { contractOrderKind } = await import('./parties');
    expect(await contractOrderKind(db('RENOVATION', 'INHOUSE_RENOVATION'), 7, 2)).toBe('RENOVATION');
  });

  test('neither says: renovation', async () => {
    const { contractOrderKind } = await import('./parties');
    expect(await contractOrderKind(db(null, null), 7, 2)).toBe('RENOVATION');
    expect(await contractOrderKind(db(null, null), null, null)).toBe('RENOVATION');
  });
});

describe("a project's kind as typed", () => {
  test('renovation, inhouse renovation, or blank to follow the brand; anything else is refused', async () => {
    const { financeKindFrom } = await import('./parties');
    expect(financeKindFrom('INHOUSE_RENOVATION')).toEqual({ ok: true, value: 'INHOUSE_RENOVATION' });
    expect(financeKindFrom('RENOVATION')).toEqual({ ok: true, value: 'RENOVATION' });
    expect(financeKindFrom('')).toEqual({ ok: true, value: null });
    expect(financeKindFrom(null)).toEqual({ ok: true, value: null });
    expect(financeKindFrom('RENTAL')).toEqual({ ok: false });
  });
});
