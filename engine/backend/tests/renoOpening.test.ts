/* Existing renovation contracts at go-live (spec docs/superpowers/specs/2026-10-30-renovation-revenue-einvoice-design.md
   7.3; plan 2026-10-30-renovation-revenue-ledger.md Task 8). Finance uploads, per contract signed before the ledger
   start, its customer account, its advance sub-account and what AutoCount invoiced before go-live. Pinned:
     • the preview names every bad row's problem: unknown SO, signed after the ledger start, a customer not under
       301/302/303, an advance account not a child of 480/481 (or a header), an amount above the contract, a row twice,
       an advance account changed after this contract posted to the old one, a go-live amount changed after revenue
       was allocated from it;
     • Apply writes the SO's customer, the contract's advance account, the go-live amount and the go-live baseline, and
       posts nothing; one bad row stops the whole file; a second Apply keeps the first baseline;
     • a VO after go-live on a seeded contract posts only its difference (RVO), never the whole contract. */

import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { applyRenoOpening, previewRenoOpening, type RenoOpeningRow } from '../src/acc/reno-opening';
import { renoOpeningApply, renoOpeningPreview } from '../src/scm/routes/accounting-reno-opening';
import { contractPostingState, postContractChange } from '../src/acc/reno-ledger';
import type { RenoDb } from '../src/scm/lib/renovation-db';

const CO = 2;
const OLD = '2990-SO-2609-001';
const OLD2 = '2990-SO-2609-002';
const NEW = '2990-SO-2611-001';
const acct = (code: string, name: string, type: string, over: Row = {}): Row => ({
  company_id: CO, account_code: code, account_name: name, account_type: type, parent_code: null, is_active: true, special_type: null, acc_money: false, ...over,
});
const so = (doc: string, date: string, over: Row = {}): Row => ({ doc_no: doc, company_id: CO, so_kind: 'RENOVATION', status: 'RENO_IN_PROGRESS', so_date: date, debtor_code: null, debtor_name: 'MS CHUAH', ...over });
const item = (id: string, doc: string, total: number, over: Row = {}): Row => ({ id, doc_no: doc, company_id: CO, item_code: 'RN-WORKS', total_sen: total, cancelled: false, ...over });

function world(over: Record<string, Row[]> = {}) {
  return fakeSb({
    accounts: [
      acct('301-0000', 'TRADE DEBTORS - RENOVATION', 'ASSET', { special_type: 'SDC' }),
      acct('300-0000', 'TRADE DEBTORS', 'ASSET', { special_type: 'SDC' }),
      acct('480-0000', 'ADVANCE - DREAM CRAFTER', 'LIABILITY'),
      acct('480-D007', 'DIVO B-16-05', 'LIABILITY', { parent_code: '480-0000' }),
      acct('480-D008', 'DIVO C-02-01', 'LIABILITY', { parent_code: '480-0000' }),
      acct('480-H001', 'HEADER', 'LIABILITY', { parent_code: '480-0000' }),
      acct('480-H001-1', 'UNDER A HEADER', 'LIABILITY', { parent_code: '480-H001' }),
      acct('500-0000', 'SALES', 'INCOME'),
    ],
    companies: [{ id: CO, code: '2990', name: '2990' }],
    acc_account_roles: [],
    acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-11-01', fiscal_year_end_month: 8 }],
    debtors: [
      { company_id: CO, code: '301-C005', name: 'MS CHUAH (DIVO B-16-05)', control_account: '301-0000', is_active: true },
      { company_id: CO, code: '300-C001', name: 'MS CHUAH', control_account: '300-0000', is_active: true },
    ],
    mfg_sales_orders: [so(OLD, '2026-09-10'), so(OLD2, '2026-09-20'), so(NEW, '2026-11-03')],
    mfg_sales_order_items: [
      item('a1', OLD, 6_000_000), item('a2', OLD, 4_000_000), item('a3', OLD, -100_000, { item_code: 'RENO-CREDIT' }),
      item('b1', OLD2, 2_000_000), item('n1', NEW, 1_000_000),
    ],
    reno_so_contracts: [
      { so_doc_no: OLD, company_id: CO, advance_account_code: null, billed_before_golive_sen: 0 },
      { so_doc_no: OLD2, company_id: CO, advance_account_code: null, billed_before_golive_sen: 0 },
      { so_doc_no: NEW, company_id: CO, advance_account_code: '480-D008', billed_before_golive_sen: 0 },
    ],
    reno_revenue_allocations: [], reno_variation_orders: [],
    journal_entries: [], journal_entry_lines: [],
    ...over,
  }, {}, [], ['journal_entry_lines']);
}
type World = ReturnType<typeof world>;

/** The SQL transaction Apply writes in, over the fake tables: its writes land only when the whole function returns;
    `failOn` makes a statement fail (a lost connection, a constraint), which rolls every write back. */
function fakeTx(sb: World, failOn?: (text: string, params: readonly unknown[]) => boolean) {
  return async <T>(f: (db: RenoDb) => Promise<T>): Promise<T> => {
    const pending: Array<() => void> = [];
    const db: RenoDb = {
      async q<R>(text: string, params: readonly unknown[] = []): Promise<R[]> {
        if (failOn?.(text, params)) throw new Error('connection reset');
        if (/update scm.mfg_sales_orders/.test(text)) {
          const row = (sb.tables.mfg_sales_orders as Row[]).find((x) => x.doc_no === params[0] && x.company_id === params[2]);
          if (!row) return [];
          pending.push(() => { row.debtor_code = params[1]; });
          return [{ doc_no: params[0] }] as R[];
        }
        if (/update scm.reno_so_contracts/.test(text)) {
          const row = (sb.tables.reno_so_contracts as Row[]).find((x) => x.so_doc_no === params[0]);
          if (!row) return [];
          pending.push(() => {
            row.advance_account_code = params[1];
            row.billed_before_golive_sen = params[2];
            row.golive_contract_sen = row.golive_contract_sen ?? params[3];
          });
          return [{ so_doc_no: params[0] }] as R[];
        }
        throw new Error(`unexpected statement: ${text}`);
      },
    };
    const out = await f(db);
    for (const w of pending) w();
    return out;
  };
}

const good: RenoOpeningRow = { soDocNo: OLD, debtorCode: '301-C005', advanceAccountCode: '480-D007', billedBeforeGoLiveSen: 3_000_000 };

const problemsOf = async (sb: World, rows: RenoOpeningRow[]) => {
  const r = await previewRenoOpening(sb, CO, rows);
  if (!r.ok) throw new Error(r.error);
  return r.rows.map((x) => x.problems);
};

describe('the go-live preview', () => {
  test('a good row has no problem and shows the contract it seeds', async () => {
    const r = await previewRenoOpening(world(), CO, [good]);
    expect(r).toMatchObject({ ok: true, rows: [{ ...good, problems: [], contractSen: 10_000_000 }] });
  });

  test('refuses each bad row by name', async () => {
    const sb = world();
    const p = await problemsOf(sb, [
      { ...good, soDocNo: '2990-SO-NOPE' },
      { ...good, soDocNo: NEW, billedBeforeGoLiveSen: 0 },
      { ...good, soDocNo: OLD2, debtorCode: '300-C001', advanceAccountCode: '480-D008', billedBeforeGoLiveSen: 0 },
      { ...good, soDocNo: OLD2, debtorCode: '301-NONE', advanceAccountCode: '500-0000', billedBeforeGoLiveSen: 2_000_001 },
    ]);
    expect(p[0]).toEqual([expect.stringContaining('2990-SO-NOPE is not a renovation contract')]);
    expect(p[1]).toEqual([expect.stringContaining('signed on or after the ledger start')]);
    expect(p[2]).toEqual([expect.stringContaining('listed more than once'), expect.stringContaining('300-C001 is under 300-0000, not 301, 302 or 303')]);
    /* Listed twice, and every other fault of the row named. */
    expect(p[3]).toEqual(expect.arrayContaining([
      expect.stringContaining('listed more than once'),
      expect.stringContaining('301-NONE is not a customer'),
      expect.stringContaining('500-0000 is not a sub-account of 480-0000 or 481-0000'),
      expect.stringContaining('more than the contract'),
    ]));
  });

  test('a header (an account with children) cannot be the advance account', async () => {
    expect((await problemsOf(world(), [{ ...good, advanceAccountCode: '480-H001' }]))[0]).toEqual([expect.stringContaining('480-H001 has sub-accounts')]);
  });

  test('the advance account cannot change once this contract posted to the old one', async () => {
    const sb = world({
      reno_so_contracts: [{ so_doc_no: OLD, company_id: CO, advance_account_code: '480-D008', billed_before_golive_sen: 3_000_000, golive_contract_sen: 10_000_000 }],
      reno_revenue_allocations: [{ id: 'x1', company_id: CO, so_doc_no: OLD, source_type: 'SI', source_doc_no: '2990-SI-2611-001', line_key: 'a1', account_code: '500-0000', amount_sen: 500_000 }],
      journal_entries: [{ id: 'je1', company_id: CO, source_type: 'SI', source_doc_no: '2990-SI-2611-001', reversed: false, posted: true }],
      journal_entry_lines: [
        { id: 'l1', journal_entry_id: 'je1', account_code: '480-D008', debit_sen: 500_000, credit_sen: 0 },
        { id: 'l2', journal_entry_id: 'je1', account_code: '500-0000', debit_sen: 0, credit_sen: 500_000 },
      ],
    });
    const p = await problemsOf(sb, [{ ...good, billedBeforeGoLiveSen: 2_500_000 }]);
    expect(p[0]).toEqual(expect.arrayContaining([
      expect.stringContaining('already posted to 480-D008'),
      expect.stringContaining('Revenue is already allocated'),
    ]));
    /* The same account and amount again is fine. */
    expect((await problemsOf(sb, [{ ...good, advanceAccountCode: '480-D008' }]))[0]).toEqual([]);
  });

  test('an advance account changed before anything posted is allowed', async () => {
    const sb = world({ reno_so_contracts: [{ so_doc_no: OLD, company_id: CO, advance_account_code: '480-D008', billed_before_golive_sen: 0 }] });
    expect((await problemsOf(sb, [good]))[0]).toEqual([]);
  });

  /* The customer account like the advance: lines already posted with the old customer as party would stay with it. */
  test('the customer account cannot change once this contract posted with the old customer as party', async () => {
    const withDebtor = (over: Record<string, Row[]> = {}) => world({
      mfg_sales_orders: [so(OLD, '2026-09-10', { debtor_code: '301-C004' }), so(OLD2, '2026-09-20'), so(NEW, '2026-11-03')],
      debtors: [
        { company_id: CO, code: '301-C005', name: 'MS CHUAH (DIVO B-16-05)', control_account: '301-0000', is_active: true },
        { company_id: CO, code: '301-C004', name: 'MS CHUAH', control_account: '301-0000', is_active: true },
      ],
      ...over,
    });
    /* Nothing posted yet: the customer may change. */
    expect((await problemsOf(withDebtor(), [good]))[0]).toEqual([]);

    /* A confirmed payment on the order posted Cr the customer control with 301-C004 as party. */
    const paid = withDebtor({
      mfg_sales_order_payments: [{ id: 'pay-1', so_doc_no: OLD, company_id: CO, amount_sen: 100_000 }],
      journal_entries: [{ id: 'je-p', company_id: CO, source_type: 'SOPAY', source_doc_no: 'pay-1', reversed: false, posted: true }],
      journal_entry_lines: [
        { id: 'l1', journal_entry_id: 'je-p', account_code: '310-0010', debit_sen: 100_000, credit_sen: 0, party_code: null },
        { id: 'l2', journal_entry_id: 'je-p', account_code: '301-0000', debit_sen: 0, credit_sen: 100_000, party_type: 'CUSTOMER', party_code: '301-C004' },
      ],
    });
    expect((await problemsOf(paid, [good]))[0]).toEqual([expect.stringContaining('already posted with customer 301-C004')]);
    expect(await applyRenoOpening(paid, CO, [good], fakeTx(paid))).toMatchObject({ ok: false, status: 'problems' });
    expect((paid.tables.mfg_sales_orders as Row[]).find((s) => s.doc_no === OLD)!.debtor_code).toBe('301-C004');

    /* A reversed posting no longer holds it. */
    (paid.tables.journal_entries as Row[])[0].reversed = true;
    expect((await problemsOf(paid, [good]))[0]).toEqual([]);

    /* The contract's own journals hold it too. */
    const signed = withDebtor({
      journal_entries: [{ id: 'je-v', company_id: CO, source_type: 'RVO', source_doc_no: `${OLD}-1`, reversed: false, posted: true }],
      journal_entry_lines: [
        { id: 'l3', journal_entry_id: 'je-v', account_code: '301-0000', debit_sen: 50_000, credit_sen: 0, party_type: 'CUSTOMER', party_code: '301-C004' },
        { id: 'l4', journal_entry_id: 'je-v', account_code: '480-D007', debit_sen: 0, credit_sen: 50_000, party_code: null },
      ],
    });
    expect((await problemsOf(signed, [good]))[0]).toEqual([expect.stringContaining('already posted with customer 301-C004')]);
  });

  test('with no ledger start every row waits for it', async () => {
    const sb = world({ acc_company_settings: [{ company_id: CO, ledger_start_date: null, fiscal_year_end_month: 8 }] });
    expect((await problemsOf(sb, [good]))[0]).toEqual([expect.stringContaining('Set the day the books start')]);
  });
});

describe('Apply', () => {
  test('writes the customer, the advance account, the go-live amount and baseline; posts nothing', async () => {
    const sb = world();
    const r = await applyRenoOpening(sb, CO, [good, { ...good, soDocNo: OLD2, advanceAccountCode: '480-D008', billedBeforeGoLiveSen: 0 }], fakeTx(sb));
    expect(r).toEqual({ ok: true, applied: 2 });
    expect((sb.tables.mfg_sales_orders as Row[]).find((s) => s.doc_no === OLD)).toMatchObject({ debtor_code: '301-C005' });
    expect((sb.tables.reno_so_contracts as Row[]).find((c) => c.so_doc_no === OLD)).toMatchObject({
      advance_account_code: '480-D007', billed_before_golive_sen: 3_000_000, golive_contract_sen: 10_000_000,
    });
    expect(sb.tables.journal_entries).toHaveLength(0);
    expect(sb.tables.reno_revenue_allocations).toHaveLength(0);
  });

  test('one bad row stops the whole file, with nothing written', async () => {
    const sb = world();
    const r = await applyRenoOpening(sb, CO, [good, { ...good, soDocNo: OLD2, advanceAccountCode: '500-0000' }], fakeTx(sb));
    expect(r).toMatchObject({ ok: false, status: 'problems' });
    expect((sb.tables.mfg_sales_orders as Row[]).find((s) => s.doc_no === OLD)!.debtor_code).toBeNull();
    expect((sb.tables.reno_so_contracts as Row[]).find((c) => c.so_doc_no === OLD)!.advance_account_code).toBeNull();
  });

  test('a failure on row 2 rolls row 1 back: nothing is written', async () => {
    const sb = world();
    const rows = [good, { ...good, soDocNo: OLD2, advanceAccountCode: '480-D008', billedBeforeGoLiveSen: 0 }];
    const r = await applyRenoOpening(sb, CO, rows, fakeTx(sb, (text, params) => /reno_so_contracts/.test(text) && params[0] === OLD2));
    expect(r).toMatchObject({ ok: false, status: 'failed', error: expect.stringContaining('Nothing was applied') });
    expect((sb.tables.mfg_sales_orders as Row[]).find((s) => s.doc_no === OLD)!.debtor_code).toBeNull();
    expect((sb.tables.reno_so_contracts as Row[]).find((c) => c.so_doc_no === OLD)).toMatchObject({ advance_account_code: null, billed_before_golive_sen: 0 });
  });

  test('without a database connection nothing is applied', async () => {
    expect(await applyRenoOpening(world(), CO, [good], null)).toMatchObject({ ok: false, status: 'failed' });
  });

  test('a cancelled contract is refused', async () => {
    const sb = world({ mfg_sales_orders: [so(OLD, '2026-09-10', { status: 'CANCELLED' }), so(OLD2, '2026-09-20'), so(NEW, '2026-11-03')] });
    expect((await problemsOf(sb, [good]))[0]).toEqual([expect.stringContaining('is cancelled')]);
  });

  /* The baseline is the contract at go-live: a VO approved on or after the ledger start but before the seeding is
     left out of it, so it posts as RVO. */
  test('a VO approved on 5 Nov, seeded on 10 Nov: the baseline leaves it out and it posts as RVO', async () => {
    const sb = world({
      reno_variation_orders: [
        { id: 'vo-1', company_id: CO, so_doc_no: OLD, vo_no: 'VO-1', seq: 1, status: 'APPROVED', doc_date: '2026-10-20', approved_at: '2026-10-21T03:00:00Z', net_sen: 200_000 },
        { id: 'vo-2', company_id: CO, so_doc_no: OLD, vo_no: 'VO-2', seq: 2, status: 'APPROVED', doc_date: '2026-11-05', approved_at: '2026-11-05T02:00:00Z', net_sen: 500_000 },
        { id: 'vo-3', company_id: CO, so_doc_no: OLD, vo_no: 'VO-3', seq: 3, status: 'DRAFT', doc_date: '2026-11-06', approved_at: null, net_sen: 900_000 },
      ],
    });
    /* The contract today carries both approved VOs: 10,000,000 + VO-2's 500,000 (VO-1 is in the 10,000,000 already). */
    (sb.tables.mfg_sales_order_items as Row[]).push(item('a5', OLD, 500_000));
    const pv = await previewRenoOpening(sb, CO, [good]);
    expect(pv).toMatchObject({ ok: true, rows: [{ problems: [], contractSen: 10_500_000, goLiveContractSen: 10_000_000 }] });
    expect(await applyRenoOpening(sb, CO, [good], fakeTx(sb))).toEqual({ ok: true, applied: 1 });
    expect((sb.tables.reno_so_contracts as Row[]).find((c) => c.so_doc_no === OLD)!.golive_contract_sen).toBe(10_000_000);
    expect(await postContractChange(sb, { companyId: CO, soDocNo: OLD, date: '2026-11-05', actor: 'Chew' })).toMatchObject({ ok: true, status: 'posted', deltaSen: 500_000 });
    expect((sb.tables.journal_entries as Row[]).map((j) => [j.source_type, j.source_doc_no, j.entry_date])).toEqual([['RVO', `${OLD}-1`, '2026-11-05']]);
  });

  test('a second Apply keeps the first baseline (a VO posted since stays counted)', async () => {
    const sb = world();
    await applyRenoOpening(sb, CO, [good], fakeTx(sb));
    (sb.tables.mfg_sales_order_items as Row[]).push(item('a4', OLD, 500_000));
    await applyRenoOpening(sb, CO, [good], fakeTx(sb));
    expect((sb.tables.reno_so_contracts as Row[]).find((c) => c.so_doc_no === OLD)!.golive_contract_sen).toBe(10_000_000);
  });
});

describe('a seeded old contract in the ledger', () => {
  test('a VO after go-live posts only its difference, up or down; the contract itself never re-posts', async () => {
    const sb = world();
    await applyRenoOpening(sb, CO, [good], fakeTx(sb));
    expect(await postContractChange(sb, { companyId: CO, soDocNo: OLD, date: '2026-11-12', actor: 'Chew' })).toMatchObject({ ok: true, status: 'nothing' });
    expect(await contractPostingState(sb, { companyId: CO, soDocNo: OLD })).toMatchObject({ ok: true, status: 'in_step', contractSen: 10_000_000, postedSen: 10_000_000 });

    (sb.tables.mfg_sales_order_items as Row[]).push(item('a4', OLD, 500_000));
    expect(await postContractChange(sb, { companyId: CO, soDocNo: OLD, date: '2026-11-12', actor: 'Chew' })).toMatchObject({ ok: true, status: 'posted', deltaSen: 500_000 });
    (sb.tables.mfg_sales_order_items as Row[]).find((r) => r.id === 'a2')!.total_sen = 3_800_000;
    /* A VO dated before go-live but applied after it posts on the ledger start. */
    expect(await postContractChange(sb, { companyId: CO, soDocNo: OLD, date: '2026-10-28', actor: 'Chew' })).toMatchObject({ ok: true, status: 'posted', deltaSen: -200_000 });

    const jes = (sb.tables.journal_entries as Row[]).map((je) => [je.source_type, je.source_doc_no, je.entry_date,
      (sb.tables.journal_entry_lines as Row[]).filter((l) => l.journal_entry_id === je.id).map((l) => [l.account_code, l.debit_sen, l.credit_sen, l.party_code ?? null])]);
    expect(jes).toEqual([
      ['RVO', `${OLD}-1`, '2026-11-12', [['301-0000', 500_000, 0, '301-C005'], ['480-D007', 0, 500_000, null]]],
      ['RVO', `${OLD}-2`, '2026-11-01', [['480-D007', 200_000, 0, null], ['301-0000', 0, 200_000, '301-C005']]],
    ]);
  });

  test('an old contract never seeded still posts nothing', async () => {
    const sb = world();
    (sb.tables.mfg_sales_order_items as Row[]).push(item('a4', OLD, 500_000));
    expect(await postContractChange(sb, { companyId: CO, soDocNo: OLD, date: '2026-11-12', actor: 'Chew' })).toMatchObject({ ok: true, status: 'before_ledger_start' });
    expect(sb.tables.journal_entries).toHaveLength(0);
  });
});

describe('the routes', () => {
  const app = (sb: World, perms: string[]) => {
    const a = new Hono();
    a.use('*', async (c, next) => {
      c.set('supabase' as never, sb as never);
      c.set('companyId' as never, CO as never);
      c.set('allowedCompanyIds' as never, [CO] as never);
      c.set('houzsUser' as never, { name: 'Finance Fiona', permissions_set: perms } as never);
      await next();
    });
    a.post('/accounting/renovation-opening/preview', renoOpeningPreview as never);
    a.post('/accounting/renovation-opening/apply', renoOpeningApply as never);
    return a;
  };
  const call = async (a: Hono, path: string, body: unknown) => {
    const res = await a.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };

  test('finance only; an empty file is refused; preview and apply answer', async () => {
    const sb = world();
    expect((await call(app(sb, ['scm.sales_order.write']), '/accounting/renovation-opening/apply', { rows: [good] })).status).toBe(403);
    const fin = app(sb, ['scm.payment_voucher.post']);
    expect((await call(fin, '/accounting/renovation-opening/preview', { rows: [] })).status).toBe(400);
    const pv = await call(fin, '/accounting/renovation-opening/preview', { rows: [good] });
    expect(pv).toMatchObject({ status: 200, body: { rows: [{ soDocNo: OLD, problems: [] }] } });
    const bad = await call(fin, '/accounting/renovation-opening/apply', { rows: [{ ...good, advanceAccountCode: '500-0000' }] });
    expect(bad.status).toBe(409);
    /* A clean file needs the database transaction: none is configured here. */
    const ok = await call(fin, '/accounting/renovation-opening/apply', { rows: [good] });
    expect(ok.status).toBe(503);
  });
});
