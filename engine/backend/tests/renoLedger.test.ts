/* Renovation contracts in the ledger (spec docs/superpowers/specs/2026-10-30-renovation-revenue-einvoice-design.md 2.1;
   plan 2026-10-30-renovation-revenue-ledger.md Task 4). Pinned:
     • signing posts the whole contract: Dr the customer control (party = the project's own debtor) / Cr the project's
       advance sub-account, source RCON, doc = the SO;
     • a VO posts only the difference since, up or down, source RVO, doc = the SO + "-n";
     • nothing changed posts nothing; a contract signed before the ledger start posts nothing (the opening balances
       carry it), even when its change is dated after;
     • no advance account, or a debtor with no control, refuses by name and posts nothing. */

import { describe, expect, test } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { contractPostedSen, contractPostingState, postContractChange } from '../src/acc/reno-ledger';

const CO = 2;
const SO = '2990-SO-2611-001';
const acct = (code: string, name: string, type: string, over: Row = {}): Row => ({
  company_id: CO, account_code: code, account_name: name, account_type: type, parent_code: null, is_active: true, special_type: null, acc_money: false, ...over,
});
const CHART: Row[] = [
  acct('301-0000', 'TRADE DEBTORS - RENOVATION', 'ASSET', { special_type: 'SDC' }),
  acct('480-0000', 'ADVANCE FROM CUSTOMERS - DREAM CRAFTER', 'LIABILITY'),
  acct('480-S012', 'SKYLINE D-25-13', 'LIABILITY', { parent_code: '480-0000' }),
];
const item = (id: string, total: number, over: Row = {}): Row => ({
  id, doc_no: SO, company_id: CO, item_group: 'RENOVATION', item_code: 'RN-WORKS', total_sen: total, cancelled: false, ...over,
});

function harness(over: { soDate?: string; items?: Row[]; advance?: string | null; debtorControl?: string | null } = {}) {
  const sb = fakeSb({
    accounts: CHART.map((r) => ({ ...r })),
    companies: [{ id: CO, code: '2990', name: '2990' }],
    acc_account_roles: [],
    acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-11-01', fiscal_year_end_month: 8 }],
    debtors: [{ company_id: CO, code: '301-M002', name: 'MS LEE (SKYLINE D-25-13)', control_account: over.debtorControl === undefined ? '301-0000' : over.debtorControl, is_active: true }],
    mfg_sales_orders: [{ doc_no: SO, company_id: CO, so_kind: 'RENOVATION', status: 'RENO_CONFIRMED', so_date: over.soDate ?? '2026-11-03', debtor_code: '301-M002', debtor_name: 'MS LEE' }],
    mfg_sales_order_items: (over.items ?? [item('i1', 6_000_000), item('i2', 4_000_000)]).map((r) => ({ ...r })),
    reno_so_contracts: [{ so_doc_no: SO, company_id: CO, advance_account_code: over.advance === undefined ? '480-S012' : over.advance, billed_before_golive_sen: 0 }],
    journal_entries: [], journal_entry_lines: [],
  }, {}, [], ['journal_entry_lines']);
  return sb;
}

const entries = (sb: ReturnType<typeof fakeSb>) => sb.tables.journal_entries.map((je) => ({
  source_type: je.source_type, source_doc_no: je.source_doc_no, entry_date: je.entry_date,
  lines: sb.tables.journal_entry_lines.filter((l) => l.journal_entry_id === je.id)
    .map((l) => ({ account: l.account_code, dr: l.debit_sen, cr: l.credit_sen, party: l.party_code ?? null })),
}));

describe('renovation contract postings', () => {
  test('signing posts the whole contract to the project accounts', async () => {
    const sb = harness();
    expect(await contractPostedSen(sb, SO)).toBe(10_000_000);
    const r = await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-03', actor: 'Chew' });
    expect(r).toMatchObject({ ok: true, status: 'posted' });
    expect(entries(sb)).toEqual([{
      source_type: 'RCON', source_doc_no: SO, entry_date: '2026-11-03',
      lines: [
        { account: '301-0000', dr: 10_000_000, cr: 0, party: '301-M002' },
        { account: '480-S012', dr: 0, cr: 10_000_000, party: null },
      ],
    }]);
    /* Asked again with nothing changed: nothing more. */
    expect(await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-03', actor: 'Chew' })).toMatchObject({ ok: true, status: 'nothing' });
    expect(sb.tables.journal_entries).toHaveLength(1);
  });

  test('a VO posts only the difference, up or down', async () => {
    const sb = harness();
    await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-03', actor: 'Chew' });

    sb.tables.mfg_sales_order_items.push(item('i3', 500_000));
    expect(await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-10', actor: 'Chew' })).toMatchObject({ ok: true, status: 'posted' });

    /* A partial omit reprices a line and a full omit cancels one: −200,000 net. */
    sb.tables.mfg_sales_order_items.find((r) => r.id === 'i2')!.total_sen = 3_900_000;
    sb.tables.mfg_sales_order_items.push(item('i4', 100_000, { cancelled: true }));
    sb.tables.mfg_sales_order_items.find((r) => r.id === 'i3')!.total_sen = 400_000;
    expect(await contractPostedSen(sb, SO)).toBe(10_300_000);
    expect(await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-20', actor: 'Chew' })).toMatchObject({ ok: true, status: 'posted' });

    const all = entries(sb);
    expect(all.map((e) => [e.source_type, e.source_doc_no])).toEqual([['RCON', SO], ['RVO', `${SO}-1`], ['RVO', `${SO}-2`]]);
    expect(all[1].lines).toEqual([
      { account: '301-0000', dr: 500_000, cr: 0, party: '301-M002' },
      { account: '480-S012', dr: 0, cr: 500_000, party: null },
    ]);
    expect(all[2].lines).toEqual([
      { account: '480-S012', dr: 200_000, cr: 0, party: null },
      { account: '301-0000', dr: 0, cr: 200_000, party: '301-M002' },
    ]);
  });

  test('a credit note row does not lower what the contract posted', async () => {
    const sb = harness({ items: [item('i1', 10_000_000), item('c1', -500_000, { item_code: 'RENO-CREDIT' })] });
    expect(await contractPostedSen(sb, SO)).toBe(10_000_000);
  });

  test('a reversed posting no longer counts as posted', async () => {
    const sb = harness();
    await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-03', actor: 'Chew' });
    sb.tables.journal_entries[0].reversed = true;
    expect(await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-04', actor: 'Chew' })).toMatchObject({ ok: true, status: 'posted' });
    const active = sb.tables.journal_entries.filter((je) => !je.reversed);
    expect(active.map((je) => [je.source_type, je.source_doc_no, je.total_debit_sen])).toEqual([['RCON', SO, 10_000_000]]);
  });

  test('a contract signed before the ledger start posts nothing', async () => {
    const sb = harness({ soDate: '2026-10-15' });
    /* Not a failure: nothing to post, so old contracts report no noise. */
    const r = await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-10-15', actor: 'Chew' });
    expect(r).toMatchObject({ ok: true, status: 'before_ledger_start' });
    /* Its VO after go-live does not post the whole contract either: the opening balances carry it. */
    const vo = await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-12', actor: 'Chew' });
    expect(vo).toMatchObject({ ok: true, status: 'before_ledger_start' });
    expect(sb.tables.journal_entries).toHaveLength(0);
    expect(await contractPostingState(sb, { companyId: CO, soDocNo: SO })).toMatchObject({ ok: true, status: 'before_ledger_start' });
  });

  test('the posting state tells finance when the contract is under-posted', async () => {
    const sb = harness();
    expect(await contractPostingState(sb, { companyId: CO, soDocNo: SO })).toEqual({ ok: true, status: 'under_posted', contractSen: 10_000_000, postedSen: 0 });
    await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-03', actor: 'Chew' });
    expect(await contractPostingState(sb, { companyId: CO, soDocNo: SO })).toEqual({ ok: true, status: 'in_step', contractSen: 10_000_000, postedSen: 10_000_000 });
    sb.tables.mfg_sales_order_items.push(item('i3', 250_000));
    expect(await contractPostingState(sb, { companyId: CO, soDocNo: SO })).toMatchObject({ status: 'under_posted', contractSen: 10_250_000, postedSen: 10_000_000 });
    const none = harness({ advance: null });
    expect(await contractPostingState(none, { companyId: CO, soDocNo: SO })).toMatchObject({ ok: false, status: 'no_advance_account' });
  });

  test('two VOs racing for one number: the loser re-reads and posts what remains under the next', async () => {
    const sb = harness();
    await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-03', actor: 'Chew' });
    /* VO B read the journals before VO A posted -1 … */
    const snapshot = sb.tables.journal_entries.map((r) => ({ ...r }));
    sb.tables.mfg_sales_order_items.push(item('i3', 500_000));
    await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-10', actor: 'A' });
    /* … and sees the contract after both VOs. */
    sb.tables.mfg_sales_order_items.push(item('i4', 300_000));
    const stale = fakeSb({ journal_entries: snapshot });
    let first = true;
    const racing = new Proxy(sb, {
      get(target, key, recv) {
        if (key !== 'from') return Reflect.get(target, key, recv);
        return (table: string) => {
          if (table === 'journal_entries' && first) { first = false; return stale.from(table); }
          return target.from(table);
        };
      },
    });
    expect(await postContractChange(racing, { companyId: CO, soDocNo: SO, date: '2026-11-10', actor: 'B' })).toMatchObject({ ok: true, status: 'posted', deltaSen: 300_000 });
    expect(entries(sb).map((e) => [e.source_doc_no, e.lines[0].dr])).toEqual([[SO, 10_000_000], [`${SO}-1`, 500_000], [`${SO}-2`, 300_000]]);
    expect(await contractPostingState(sb, { companyId: CO, soDocNo: SO })).toMatchObject({ status: 'in_step', postedSen: 10_800_000 });
  });

  test('finance posting again with no date: the signing on the contract date', async () => {
    const sb = harness();
    expect(await postContractChange(sb, { companyId: CO, soDocNo: SO, date: null, actor: 'Finance' })).toMatchObject({ ok: true, status: 'posted' });
    expect(entries(sb)[0]).toMatchObject({ source_type: 'RCON', entry_date: '2026-11-03' });
  });

  test('no advance account refuses by name', async () => {
    const sb = harness({ advance: null });
    const r = await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-03', actor: 'Chew' });
    expect(r).toMatchObject({ ok: false, status: 'no_advance_account' });
    if (!r.ok) expect(r.reason).toContain(SO);
    expect(sb.tables.journal_entries).toHaveLength(0);
  });

  test('a debtor with no control is never guessed onto the AR rule', async () => {
    const sb = harness({ debtorControl: null });
    const r = await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-03', actor: 'Chew' });
    expect(r).toMatchObject({ ok: false, status: 'no_customer_account' });
    if (!r.ok) expect(r.reason).toContain('301-M002');
    expect(sb.tables.journal_entries).toHaveLength(0);
  });
});
