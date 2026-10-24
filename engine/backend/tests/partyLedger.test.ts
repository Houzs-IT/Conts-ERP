/* One customer's (or supplier's) ledger (Conts, finance phase 1.5; SOP 2.1: "每个顾客看得到欠款、所有往来和余额"). Pinned:
     · a customer's ledger shows its lines on customer controls — the contract, the payments — with a running balance;
     · the balance brought forward is everything before the from date;
     · another customer's lines, and the customer's lines on other accounts, never show;
     · a supplier's ledger runs the other way (what is owed to them is the credit). */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { partyLedgerHandler } from '../src/conts/party-ledger';

const CO = 1;
let id = 0;
const gl = (jeNo: string, date: string, source: string, account: string, party: string | null, dr: number, cr: number, over: Row = {}): Row => ({
  line_id: ++id, company_id: CO, je_no: jeNo, entry_date: date, source_type: source, source_doc_no: `${source}-${jeNo}`, line_no: 1,
  account_code: account, account_name: account, account_type: account.startsWith('4') ? 'LIABILITY' : 'ASSET', party_code: party, party_name: party,
  debit_sen: dr, credit_sen: cr, notes: null, reversed: false, reversed_by_je: null, posted: true, ...over,
});
const world = () => fakeSb({
  accounts: [
    { company_id: CO, account_code: '301-0000', account_name: 'RENOVATION CUSTOMER', account_type: 'ASSET', special_type: 'SDC' },
    { company_id: CO, account_code: '302-0000', account_name: 'INHOUSE CUSTOMER', account_type: 'ASSET', special_type: 'SDC' },
    { company_id: CO, account_code: '400-0000', account_name: 'TRADE CREDITORS', account_type: 'LIABILITY', special_type: 'SCC' },
    { company_id: CO, account_code: '481-S032', account_name: 'SKYLINE A-12-06', account_type: 'LIABILITY', special_type: null },
  ],
  debtors: [{ id: 'd1', company_id: CO, code: '301-M001', name: 'MS LEE', control_account: '301-0000', customer_id: 'c-9' }],
  suppliers: [{ id: 's1', company_id: CO, code: '400-H010', name: 'HOYEN SPACE', control_account: '400-0000' }],
  journal_entries: [],
  v_gl_entries: [
    gl('JE-1', '2026-10-20', 'SIPAY', '301-0000', '301-M001', 0, 100_000),
    gl('JE-2', '2026-11-03', 'CONTRACT', '301-0000', '301-M001', 3_000_000, 0),
    gl('JE-2', '2026-11-03', 'CONTRACT', '481-S032', null, 0, 3_000_000),
    gl('JE-3', '2026-11-12', 'SIPAY', '301-0000', '301-M001', 0, 900_000),
    gl('JE-4', '2026-11-13', 'SIPAY', '301-0000', '301-M009', 0, 50_000),
    gl('JE-5', '2026-11-14', 'PI', '400-0000', '400-H010', 0, 120_000),
    gl('JE-6', '2026-11-20', 'PV', '400-0000', '400-H010', 70_000, 0),
    /* An order that named no debtor code: the payment carries the customer id. */
    gl('JE-7', '2026-11-15', 'SOPAY', '301-0000', 'c-9', 0, 10_000),
    /* The customer named on a line that is not a control: not theirs to owe. */
    gl('JE-8', '2026-11-16', 'MANUAL', '481-S032', '301-M001', 0, 5_000),
    /* A reversed payment and its contra: neither shows, nothing changes. */
    gl('JE-9', '2026-11-17', 'SIPAY', '301-0000', '301-M001', 0, 77_000, { reversed: true }),
    gl('JE-10', '2026-11-18', 'SIPAY_REVERSAL', '301-0000', '301-M001', 77_000, 0, { reversed_by_je: 'JE-9' }),
  ],
});
const ask = async (q: string) => {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('supabase' as never, world() as never);
    c.set('companyId' as never, CO as never);
    c.set('houzsUser' as never, { name: 'T', permissions_set: new Set(['scm.payment_voucher.post']) } as never);
    await next();
  });
  app.get('/party-ledger', partyLedgerHandler as never);
  return app.request(`/party-ledger?${q}`);
};
type Body = { party: { code: string; name: string }; openingSen: number; closingSen: number; lines: Array<{ jeNo: string; debitSen: number; creditSen: number; balanceSen: number; account: string }> };

describe('a ledger for one party', () => {
  test("one customer's ledger: its contract and payments with a running balance; the earlier payment brought forward", async () => {
    const res = await ask('kind=debtor&code=301-M001&from=2026-11-01&to=2026-11-30');
    expect(res.status).toBe(200);
    const b = await res.json() as Body;
    expect(b.party).toMatchObject({ code: '301-M001', name: 'MS LEE' });
    expect(b.openingSen).toBe(-100_000);
    expect(b.lines.map((l) => [l.jeNo, l.debitSen, l.creditSen, l.balanceSen])).toEqual([
      ['JE-2', 3_000_000, 0, 2_900_000],
      ['JE-3', 0, 900_000, 2_000_000],
      ['JE-7', 0, 10_000, 1_990_000],
    ]);
    expect(b.closingSen).toBe(1_990_000);
    expect(b.lines.every((l) => l.account === '301-0000')).toBe(true);
  });

  test("a supplier's ledger: what is owed to them is the credit", async () => {
    const b = await (await ask('kind=creditor&code=400-H010&from=2026-11-01&to=2026-11-30')).json() as Body;
    expect(b.lines.map((l) => l.balanceSen)).toEqual([120_000, 50_000]);
    expect(b.closingSen).toBe(50_000);
  });

  test('an unknown party is a 404; a bad range a 400', async () => {
    expect((await ask('kind=debtor&code=301-X999&from=2026-11-01&to=2026-11-30')).status).toBe(404);
    expect((await ask('kind=debtor&code=301-M001&from=2026-12-01&to=2026-11-30')).status).toBe(400);
  });
});
