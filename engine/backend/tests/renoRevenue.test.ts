/* Renovation invoices, credit notes and cancel in the ledger (spec docs/superpowers/specs/2026-10-30-renovation-revenue-
   einvoice-design.md 2.2, 2.3, 7.1, 7.2; plan 2026-10-30-renovation-revenue-ledger.md Tasks 5–7, Review Focus 1–5).
   Pinned:
     • an invoice books Dr the advance sub-account / Cr revenue by the waterfall, per sub-category account (falling back
       to the group's), and the next invoice continues where the last stopped;
     • a VO that lowers an invoiced tier: the next invoice gives back from it, and revenue to date equals net invoiced;
     • a cancelled invoice: its journal reversed and its allocations gone, so the next invoice re-fills those tiers;
     • a line whose group (or sub-category and group) has no sales account, or whose product has no group, leaves the
       invoice unposted, by name, with no journal and no allocation;
     • an old contract: its billed-before-go-live amount is filled first (no journal), and invoices continue after it;
     • a contract credit lowers revenue from the last tier back and Cr's the customer; a negative instalment Cr's the
       advance (the VO already lowered the customer); a credit above net billed is refused;
     • cancel clears the advance left: Dr advance / Cr customer. */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { fakeSb, type Row } from '../src/scm/lib/fake-postgrest';
import { cancelGate, contractPostingState, postContractCancel, postContractChange } from '../src/acc/reno-ledger';
import { postSiRevenue, reverseSiRevenue } from '../src/scm/lib/post-si-revenue';
import { cancelCreditNote, postCreditNote } from '../src/acc/credit-notes';
import { assembleView, billInstalment, creditContract } from '../src/scm/lib/renovation-billing';
import type { RenoDb } from '../src/scm/lib/renovation-db';

const CO = 2;
const SO = '2990-SO-2611-001';
const acct = (code: string, name: string, type: string, over: Row = {}): Row => ({
  company_id: CO, account_code: code, account_name: name, account_type: type, parent_code: null, is_active: true, special_type: null, acc_money: false, ...over,
});
const CHART: Row[] = [
  acct('301-0000', 'TRADE DEBTORS - RENOVATION', 'ASSET', { special_type: 'SDC' }),
  acct('480-0000', 'ADVANCE FROM CUSTOMERS - DREAM CRAFTER', 'LIABILITY'),
  acct('480-S012', 'SKYLINE D-25-13', 'LIABILITY', { parent_code: '480-0000' }),
  acct('505-0000', 'DESIGN FEE', 'INCOME'),
  acct('501-0020', 'RENOVATION - ELECTRICAL', 'INCOME'),
  acct('501-0030', 'RENOVATION - CEILING', 'INCOME'),
  acct('501-0090', 'RENOVATION - OTHER WORKS', 'INCOME'),
  acct('502-0050', 'BUILT-IN FURNITURE', 'INCOME'),
  acct('503-0010', 'LOOSE FURNITURE', 'INCOME'),
];
const item = (id: string, total: number, code: string, lineNo: number, over: Row = {}): Row => ({
  id, doc_no: SO, company_id: CO, item_group: 'RENOVATION', item_code: code, total_sen: total, cancelled: false, line_no: lineNo, ...over,
});
const product = (code: string, group: string | null, sub: string | null): Row => ({ company_id: CO, code, category_group: group, sub_category: sub, status: 'ACTIVE' });

/* The plan's contract: Service 2,000 / Fixture (electrical 4,000, ceiling 5,000) / Carpentry 6,000 / Furniture 83,000
   = RM 100,000, chew's cancel example. */
function harness(over: { soDate?: string; billedBefore?: number; items?: Row[]; products?: Row[] } = {}) {
  return fakeSb({
    accounts: CHART.map((r) => ({ ...r })),
    companies: [{ id: CO, code: '2990', name: '2990' }],
    acc_account_roles: [],
    acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-11-01', fiscal_year_end_month: 8 }],
    debtors: [{ company_id: CO, code: '301-M002', name: 'MS LEE (SKYLINE D-25-13)', control_account: '301-0000', is_active: true }],
    mfg_sales_orders: [{ doc_no: SO, company_id: CO, so_kind: 'RENOVATION', status: 'RENO_CONFIRMED', so_date: over.soDate ?? '2026-11-03', debtor_code: '301-M002', debtor_name: 'MS LEE' }],
    mfg_sales_order_items: (over.items ?? [
      item('s1', 200_000, 'RN-SVC', 1), item('e1', 400_000, 'RN-ELEC', 2), item('c1', 500_000, 'RN-CEIL', 3),
      item('t1', 600_000, 'RN-TV', 4), item('f1', 8_300_000, 'RN-SOFA', 5),
    ]).map((r) => ({ ...r })),
    mfg_products: over.products ?? [
      product('RN-SVC', 'SERVICE', 'DESIGN_FEE'), product('RN-ELEC', 'WORKS', 'ELECTRICAL'), product('RN-CEIL', 'WORKS', 'CEILING'),
      product('RN-TV', 'BUILTIN', 'TV_CABINET'), product('RN-SOFA', 'FURNITURE', 'SOFA'),
    ],
    acc_item_group_accounts: [
      { company_id: CO, group_code: 'SERVICE', sales_account: '505-0000' },
      { company_id: CO, group_code: 'WORKS', sales_account: '501-0090' },
      { company_id: CO, group_code: 'BUILTIN', sales_account: '502-0050' },
      { company_id: CO, group_code: 'FURNITURE', sales_account: '503-0010' },
    ],
    acc_sub_category_accounts: [
      { company_id: CO, sub_category_code: 'ELECTRICAL', sales_account: '501-0020' },
      { company_id: CO, sub_category_code: 'CEILING', sales_account: '501-0030' },
    ],
    reno_so_contracts: [{ so_doc_no: SO, company_id: CO, advance_account_code: '480-S012', billed_before_golive_sen: over.billedBefore ?? 0 }],
    reno_revenue_allocations: [], reno_contract_credits: [], reno_instalment_bills: [],
    sales_invoices: [], sales_invoice_items: [], acc_credit_notes: [], acc_credit_note_lines: [],
    journal_entries: [], journal_entry_lines: [],
  }, {}, [], ['journal_entry_lines']);
}
type Sb = ReturnType<typeof fakeSb>;

let invN = 0;
async function invoice(sb: Sb, totalSen: number, date = '2026-11-05') {
  invN += 1;
  const no = `2990SI-2611-${String(invN).padStart(3, '0')}`;
  sb.tables.sales_invoices.push({ id: `si-${invN}`, invoice_number: no, invoice_date: date, debtor_code: '301-M002', debtor_name: 'MS LEE', total_sen: totalSen, company_id: CO, so_doc_no: SO, status: 'SENT' });
  sb.tables.sales_invoice_items.push({ id: `sii-${invN}`, sales_invoice_id: `si-${invN}`, item_code: 'RENO-PROGRESS', item_group: 'RENOVATION', line_total_sen: totalSen });
  return { no, r: await postSiRevenue(sb, no) };
}

/** The live journal of one source document. */
function journalOf(sb: Sb, sourceType: string, docNo: string) {
  const je = sb.tables.journal_entries.find((j) => j.source_type === sourceType && j.source_doc_no === docNo && !j.reversed);
  if (!je) return null;
  return sb.tables.journal_entry_lines.filter((l) => l.journal_entry_id === je.id)
    .map((l) => ({ account: l.account_code, dr: l.debit_sen, cr: l.credit_sen, party: l.party_code ?? null }));
}

/** Balances the way the ledger views read them: posted, not reversed, not a contra. Dr − Cr. */
function balances(sb: Sb): Record<string, number> {
  const live = new Set(sb.tables.journal_entries.filter((j) => j.posted !== false && !j.reversed && !j.reversed_by_je).map((j) => j.id));
  const out: Record<string, number> = {};
  for (const l of sb.tables.journal_entry_lines) {
    if (!live.has(l.journal_entry_id)) continue;
    out[l.account_code] = (out[l.account_code] ?? 0) + Number(l.debit_sen ?? 0) - Number(l.credit_sen ?? 0);
  }
  return out;
}
const REVENUE = ['505-0000', '501-0020', '501-0030', '501-0090', '502-0050', '503-0010'];
const revenueToDate = (sb: Sb) => REVENUE.reduce((s, a) => s - (balances(sb)[a] ?? 0), 0);
const allocatedTotal = (sb: Sb) => sb.tables.reno_revenue_allocations.reduce((s, r) => s + Number(r.amount_sen), 0);

afterEach(() => { vi.useRealTimers(); });

describe('renovation invoices by the waterfall', () => {
  test('an invoice books Dr advance / Cr revenue by the waterfall', async () => {
    const sb = harness();
    const { no, r } = await invoice(sb, 1_000_000);
    expect(r).toMatchObject({ ok: true, status: 'posted' });
    expect(journalOf(sb, 'SI', no)).toEqual([
      { account: '480-S012', dr: 1_000_000, cr: 0, party: null },
      { account: '505-0000', dr: 0, cr: 200_000, party: null },
      { account: '501-0020', dr: 0, cr: 355_556, party: null },
      { account: '501-0030', dr: 0, cr: 444_444, party: null },
    ]);
    expect(sb.tables.reno_revenue_allocations.map((a) => [a.source_type, a.source_doc_no, a.line_key, a.account_code, a.amount_sen])).toEqual([
      ['SI', no, 's1', '505-0000', 200_000], ['SI', no, 'e1', '501-0020', 355_556], ['SI', no, 'c1', '501-0030', 444_444],
    ]);
    /* Posting again changes nothing. */
    expect(await postSiRevenue(sb, no)).toMatchObject({ ok: true, status: 'already_posted' });
    expect(allocatedTotal(sb)).toBe(1_000_000);
  });

  test('the second invoice continues where the first stopped', async () => {
    const sb = harness();
    await invoice(sb, 1_000_000);
    const { no } = await invoice(sb, 1_000_000);
    expect(journalOf(sb, 'SI', no)).toEqual([
      { account: '480-S012', dr: 1_000_000, cr: 0, party: null },
      { account: '501-0020', dr: 0, cr: 44_444, party: null },
      { account: '501-0030', dr: 0, cr: 55_556, party: null },
      { account: '502-0050', dr: 0, cr: 600_000, party: null },
      { account: '503-0010', dr: 0, cr: 300_000, party: null },
    ]);
    expect(revenueToDate(sb)).toBe(2_000_000);
  });

  test('after a VO lowers fixture, the next invoice absorbs it', async () => {
    const sb = harness();
    await invoice(sb, 1_000_000);
    /* A partial omit takes the ceiling from 5,000 to 1,000: fixture is now 5,000, of which 8,000 was invoiced. */
    sb.tables.mfg_sales_order_items.find((r) => r.id === 'c1')!.total_sen = 100_000;
    const { no } = await invoice(sb, 500_000);
    /* Target at 15,000: service 2,000, electrical 4,000, ceiling 1,000, carpentry 6,000, furniture 2,000. */
    expect(journalOf(sb, 'SI', no)).toEqual([
      { account: '480-S012', dr: 500_000, cr: 0, party: null },
      { account: '501-0020', dr: 0, cr: 44_444, party: null },
      { account: '501-0030', dr: 344_444, cr: 0, party: null },
      { account: '502-0050', dr: 0, cr: 600_000, party: null },
      { account: '503-0010', dr: 0, cr: 200_000, party: null },
    ]);
    expect(-(balances(sb)['501-0030'] ?? 0)).toBe(100_000);
    expect(revenueToDate(sb)).toBe(1_500_000);
    expect(allocatedTotal(sb)).toBe(1_500_000);
  });

  test('a cancelled invoice gives its tiers back', async () => {
    const sb = harness();
    await invoice(sb, 1_000_000);
    const second = await invoice(sb, 1_000_000);
    /* The contra is dated the day of the cancel: after the ledger start. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-20T04:00:00Z'));
    sb.tables.sales_invoices.find((s) => s.invoice_number === second.no)!.status = 'CANCELLED';
    expect(await reverseSiRevenue(sb, second.no)).toMatchObject({ ok: true, status: 'reversed' });
    expect(sb.tables.reno_revenue_allocations.filter((a) => a.source_doc_no === second.no)).toHaveLength(0);
    expect(revenueToDate(sb)).toBe(1_000_000);
    /* The next invoice re-fills fixture first, as the cancelled one did. */
    const third = await invoice(sb, 600_000);
    expect(journalOf(sb, 'SI', third.no)).toEqual([
      { account: '480-S012', dr: 600_000, cr: 0, party: null },
      { account: '501-0020', dr: 0, cr: 44_444, party: null },
      { account: '501-0030', dr: 0, cr: 55_556, party: null },
      { account: '502-0050', dr: 0, cr: 500_000, party: null },
    ]);
    expect(revenueToDate(sb)).toBe(1_600_000);
  });

  test('a line with no binding leaves the invoice unposted, by name', async () => {
    const unbound = harness({ items: [item('s1', 200_000, 'RN-SVC', 1), item('l1', 300_000, 'RN-LAMP', 2)],
      products: [product('RN-SVC', 'SERVICE', 'DESIGN_FEE'), product('RN-LAMP', 'LIGHTING', 'DOWNLIGHT')] });
    const { r } = await invoice(unbound, 100_000);
    expect(r).toMatchObject({ ok: false, status: 'group_unbound' });
    if (!r.ok) expect(r.reason).toContain('LIGHTING / DOWNLIGHT');
    expect(unbound.tables.journal_entries).toHaveLength(0);
    expect(unbound.tables.reno_revenue_allocations).toHaveLength(0);

    const ungrouped = harness({ items: [item('s1', 200_000, 'RN-SVC', 1), item('x1', 300_000, 'RN-ODD', 2)],
      products: [product('RN-SVC', 'SERVICE', 'DESIGN_FEE'), product('RN-ODD', null, null)] });
    const u = await invoice(ungrouped, 100_000);
    expect(u.r).toMatchObject({ ok: false, status: 'line_ungrouped' });
    if (!u.r.ok) expect(u.r.reason).toContain('RN-ODD');
    expect(ungrouped.tables.journal_entries).toHaveLength(0);
  });

  test('an old contract continues after its billed-before-go-live amount', async () => {
    const sb = harness({ soDate: '2026-10-10', billedBefore: 1_000_000 });
    const { no, r } = await invoice(sb, 1_000_000, '2026-11-12');
    expect(r).toMatchObject({ ok: true, status: 'posted' });
    /* The go-live amount is allocated first with no journal … */
    expect(sb.tables.reno_revenue_allocations.filter((a) => a.source_type === 'OPENING').reduce((s, a) => s + Number(a.amount_sen), 0)).toBe(1_000_000);
    expect(sb.tables.journal_entries.map((j) => j.source_type)).toEqual(['SI']);
    /* … and the invoice continues from there, out of the seeded advance account. */
    expect(journalOf(sb, 'SI', no)).toEqual([
      { account: '480-S012', dr: 1_000_000, cr: 0, party: null },
      { account: '501-0020', dr: 0, cr: 44_444, party: null },
      { account: '501-0030', dr: 0, cr: 55_556, party: null },
      { account: '502-0050', dr: 0, cr: 600_000, party: null },
      { account: '503-0010', dr: 0, cr: 300_000, party: null },
    ]);
  });

  test('a contract with no advance account leaves the invoice unposted, by name', async () => {
    const sb = harness();
    sb.tables.reno_so_contracts[0].advance_account_code = null;
    const { r } = await invoice(sb, 100_000);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toContain(SO);
    expect(sb.tables.journal_entries).toHaveLength(0);
  });
});

/** A credit note row as creditContract / billInstalment leave it: DRAFT, one placeholder line. */
function draftNote(sb: Sb, id: string, number: string, amount: number, date = '2026-11-20') {
  sb.tables.acc_credit_notes.push({ id, company_id: CO, note_number: number, kind: 'CN', party_type: 'CUSTOMER', party_code: '301-M002', party_name: 'MS LEE', so_doc_no: SO, note_date: date, total_sen: amount, reason: 'Special discount', status: 'DRAFT' });
  sb.tables.acc_credit_note_lines.push({ id: `${id}-l1`, company_id: CO, note_id: id, line_no: 1, description: 'Special discount', account_code: '480-S012', amount_sen: amount });
  return sb.tables.acc_credit_notes.find((n) => n.id === id)!;
}
const contractCredit = (sb: Sb, noteId: string, number: string, amount: number) => {
  sb.tables.reno_contract_credits.push({ id: `cc-${noteId}`, company_id: CO, so_doc_no: SO, credit_note_id: noteId, note_number: number, amount_sen: amount });
  sb.tables.mfg_sales_order_items.push(item(`cc-${noteId}`, -amount, 'RENO-CREDIT', 99));
};

describe('renovation credit notes', () => {
  test('a discount credit lowers revenue, what the customer owes and the contract', async () => {
    const sb = harness();
    await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-03', actor: 'Chew' });
    await invoice(sb, 1_000_000);
    const note = draftNote(sb, 'cn-1', '2990CN-2611-001', 500_000);
    contractCredit(sb, 'cn-1', '2990CN-2611-001', 500_000);

    const r = await postCreditNote(sb, { companyId: CO, note, actor: 'Finance' });
    expect(r).toMatchObject({ ok: true, status: 'posted' });
    /* Net billed 5,000: service 2,000 stays, fixture gives back to 3,000 (1,333.33 / 1,666.67). */
    expect(journalOf(sb, 'CN', '2990CN-2611-001')).toEqual([
      { account: '301-0000', dr: 0, cr: 500_000, party: '301-M002' },
      { account: '501-0020', dr: 222_223, cr: 0, party: null },
      { account: '501-0030', dr: 277_777, cr: 0, party: null },
    ]);
    /* The note's own lines now say where it went. */
    expect(sb.tables.acc_credit_note_lines.filter((l) => l.note_id === 'cn-1').map((l) => [l.account_code, l.amount_sen])).toEqual([['501-0020', 222_223], ['501-0030', 277_777]]);
    expect(sb.tables.acc_credit_notes[0].status).toBe('POSTED');
    expect(revenueToDate(sb)).toBe(500_000);
    /* The customer owes the contract less the credit; the RENO-CREDIT row did not move the advance. */
    expect(balances(sb)['301-0000']).toBe(9_500_000);
    expect(await contractPostingState(sb, { companyId: CO, soDocNo: SO })).toMatchObject({ status: 'in_step', postedSen: 10_000_000 });

    /* Cancelling the note gives the revenue back and the contract its amount. */
    const c = await cancelCreditNote(sb, { companyId: CO, note: sb.tables.acc_credit_notes[0], actor: 'Finance', entryDate: '2026-11-21' });
    expect(c).toMatchObject({ ok: true, status: 'cancelled' });
    expect(sb.tables.reno_revenue_allocations.filter((a) => a.source_doc_no === '2990CN-2611-001')).toHaveLength(0);
    expect(sb.tables.mfg_sales_order_items.find((i) => i.id === 'cc-cn-1')!.cancelled).toBe(true);
    expect(revenueToDate(sb)).toBe(1_000_000);
  });

  test('a credit above what is invoiced is refused by the ledger too', async () => {
    const sb = harness();
    await invoice(sb, 300_000);
    const note = draftNote(sb, 'cn-1', '2990CN-2611-001', 500_000);
    contractCredit(sb, 'cn-1', '2990CN-2611-001', 500_000);
    const r = await postCreditNote(sb, { companyId: CO, note, actor: 'Finance' });
    expect(r).toMatchObject({ ok: false, status: 'credit_exceeds_billed' });
    expect(sb.tables.journal_entries.filter((j) => j.source_type === 'CN')).toHaveLength(0);
    expect(sb.tables.acc_credit_notes[0].status).toBe('DRAFT');
  });

  test('a negative instalment posts as a renovation credit, not to the RENOVATION group account', async () => {
    const sb = harness();
    await invoice(sb, 1_000_000);
    const note = draftNote(sb, 'cn-2', '2990CN-2611-002', 100_000);
    sb.tables.reno_instalment_bills.push({ id: 'b-2', company_id: CO, so_doc_no: SO, kind: 'CREDIT_NOTE', amount_sen: -100_000, credit_note_id: 'cn-2', note_number: '2990CN-2611-002' });
    const r = await postCreditNote(sb, { companyId: CO, note, actor: 'Finance' });
    expect(r).toMatchObject({ ok: true, status: 'posted' });
    /* The VO already lowered the customer: the over-billed part goes back to the advance. */
    expect(journalOf(sb, 'CN', '2990CN-2611-002')).toEqual([
      { account: '480-S012', dr: 0, cr: 100_000, party: null },
      { account: '501-0020', dr: 44_445, cr: 0, party: null },
      { account: '501-0030', dr: 55_555, cr: 0, party: null },
    ]);
    expect(sb.tables.reno_revenue_allocations.find((a) => a.source_doc_no === '2990CN-2611-002')?.source_type).toBe('BILL_CN');
  });

  test('the next instalment is worked out on the contract less the credit', () => {
    const inst = [
      { id: 'a', seq: 1, label: 'Deposit', pctBp: 1000, description: '', stageCode: null, trigger: 'manual' },
      { id: 'b', seq: 2, label: 'Works', pctBp: 2000, description: '', stageCode: null, trigger: 'manual' },
      { id: 'c', seq: 3, label: 'Handover', pctBp: 7000, description: '', stageCode: null, trigger: 'manual' },
    ];
    const bills = [{ instalment_id: 'a', seq: 1, kind: 'INVOICE' as const, amount_sen: 1_000_000, invoice_date: '2026-11-05', invoice_number: 'SI-1', sales_invoice_id: 'si-1', note_number: null, credit_note_id: null, paid_sen: 0, si_status: 'SENT', cn_status: null }];
    const v = assembleView(SO, 'RENO_CONFIRMED', 10_000_000, 9_500_000, inst, bills, 500_000);
    expect(v.billedSen).toBe(500_000);
    expect(v.creditedSen).toBe(500_000);
    /* 30% of 95,000 = 28,500, less 5,000 billed net. */
    expect(v.instalments.find((i) => i.seq === 2)!.amountSen).toBe(2_350_000);
  });
});

/* What AutoCount invoiced before go-live is billed (plan Task 8 review): it counts in billedSen, the instalments it
   covers show as billed before go-live and are skipped, and the next one is worked out after it. */
describe('billing an old contract after go-live', () => {
  const inst = [
    { id: 'a', seq: 1, label: 'Deposit', pctBp: 3000, description: '', stageCode: null, trigger: 'manual' },
    { id: 'b', seq: 2, label: 'Carpentry', pctBp: 4000, description: '', stageCode: null, trigger: 'manual' },
    { id: 'c', seq: 3, label: 'Handover', pctBp: 3000, description: '', stageCode: null, trigger: 'manual' },
  ];

  test('contract 100k, AutoCount invoiced 30k (instalment 1): the next is instalment 2, never instalment 1 again', () => {
    const v = assembleView(SO, 'RENO_IN_PROGRESS', 10_000_000, 10_000_000, inst, [], 0, [], 3_000_000);
    expect(v.billedSen).toBe(3_000_000);
    expect(v.nextSeq).toBe(2);
    expect(v.instalments.map((i) => [i.seq, i.billedBeforeGoLive, i.isNext, i.amountSen])).toEqual([
      [1, true, false, 0],
      [2, false, true, 4_000_000],
      [3, false, false, 3_000_000],
    ]);
  });

  test('a go-live amount between two targets: the instalment it falls in bills the rest of it', () => {
    const v = assembleView(SO, 'RENO_IN_PROGRESS', 10_000_000, 10_000_000, inst, [], 0, [], 5_000_000);
    expect(v.nextSeq).toBe(2);
    expect(v.instalments.find((i) => i.seq === 2)!.amountSen).toBe(2_000_000);
  });

  test('billInstalment refuses a covered instalment and bills the next at cum% less everything billed', async () => {
    const { db, seen } = scriptDb([
      [/as revised_sen/, () => [{ doc_no: SO, status: 'RENO_IN_PROGRESS', original_contract_sen: 10_000_000, revised_sen: 10_000_000, billed_before_golive_sen: 3_000_000 }]],
      [HEAD_RE, () => [{ ...head, status: 'RENO_IN_PROGRESS' }]],
      [/from scm\.reno_doc_instalments/, () => inst.map((i) => ({ id: i.id, so_doc_no: SO, seq: i.seq, label: i.label, pct_bp: i.pctBp, description: '', stage_code: null, trigger: 'manual' }))],
      [/from scm\.reno_instalment_bills b/, () => []],
      [/from scm\.reno_contract_credits cc/, () => []],
      [/next_doc_no_n/, () => [{ n: 1 }]],
      [/insert into scm\.sales_invoices/, () => [{ id: 'si-2' }]],
    ]);
    await expect(billInstalment(db, actor, SO, 'a', { expectedAmountSen: 3_000_000 })).rejects.toMatchObject({ code: 'not_next' });
    const out = await billInstalment(db, actor, SO, 'b', { expectedAmountSen: 4_000_000, invoiceDate: '2026-11-20' });
    expect(out).toMatchObject({ kind: 'INVOICE', amountSen: 4_000_000 });
    const bill = seen.find((s) => /insert into scm\.reno_instalment_bills/.test(s.text))!;
    /* billed_before_sen records everything billed before this one, AutoCount's 30k included. */
    expect(bill.params[8]).toBe(3_000_000);
  });

  test("the invoice line and header use finance's description template", async () => {
    const answers: Array<[RegExp, (params: readonly unknown[]) => unknown[]]> = [
      [/as revised_sen/, () => [{ doc_no: SO, status: 'RENO_IN_PROGRESS', original_contract_sen: 10_000_000, revised_sen: 10_000_000, billed_before_golive_sen: 3_000_000 }]],
      [HEAD_RE, () => [{ ...head, status: 'RENO_IN_PROGRESS' }]],
      [/from scm\.reno_doc_instalments/, () => inst.map((i) => ({ id: i.id, so_doc_no: SO, seq: i.seq, label: i.label, pct_bp: i.pctBp, description: '', stage_code: null, trigger: 'manual' }))],
      [/next_doc_no_n/, () => [{ n: 1 }]],
      [/insert into scm\.sales_invoices/, () => [{ id: 'si-2' }]],
    ];
    const { db, seen } = scriptDb(answers);
    await billInstalment(db, actor, SO, 'b', { expectedAmountSen: 4_000_000, invoiceDate: '2026-11-20' });
    const want = '2nd Progress Billing for Interior Design & Renovation Works (40% Carpentry as per Sales Order, refer to attached breakdown)';
    expect(seen.find((s) => /insert into scm\.sales_invoice_items/.test(s.text))!.params[1]).toBe(want);
    expect(seen.find((s) => /insert into scm\.sales_invoices/.test(s.text))!.params[6]).toBe(want);

    const custom = scriptDb([[/reno_invoice_description/, () => [{ reno_invoice_description: '{ordinal} claim: {label} ({so})' }]], ...answers]);
    await billInstalment(custom.db, actor, SO, 'b', { expectedAmountSen: 4_000_000, invoiceDate: '2026-11-20' });
    expect(custom.seen.find((s) => /insert into scm\.sales_invoice_items/.test(s.text))!.params[1]).toBe(`2nd claim: Carpentry (${SO})`);
  });
});

/** A RenoDb that answers by the query's text; every statement is kept for the test to read. */
function scriptDb(answers: Array<[RegExp, (params: readonly unknown[]) => unknown[]]>) {
  const seen: Array<{ text: string; params: readonly unknown[] }> = [];
  const db: RenoDb = {
    async q<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      seen.push({ text, params });
      for (const [re, fn] of answers) if (re.test(text)) return fn(params) as T[];
      return [] as T[];
    },
  };
  return { db, seen };
}
const head = {
  doc_no: SO, status: 'RENO_IN_PROGRESS', so_kind: 'RENOVATION', so_date: '2026-11-03', debtor_name: 'MS LEE', debtor_code: '301-M002', project_id: 7,
  local_total_sen: 10_000_000, paid_sen: 0, balance_sen: 0, version: 1, revision: 0, company_id: CO, branding: null, contract_version: 1,
  original_contract_sen: 10_000_000, doc_discount_sen: 0, promo_lines: [], brand_id: null,
};
const actor = { name: 'Finance', staffId: 'u1', companyId: CO, docPrefix: '2990' };
const HEAD_RE = /from scm\.mfg_sales_orders o\s+left join scm\.reno_so_contracts/;

describe('creditContract', () => {
  test('a credit above what is billed is refused', async () => {
    const { db, seen } = scriptDb([[HEAD_RE, () => [head]], [/as net_billed_sen/, () => [{ net_billed_sen: 300_000 }]]]);
    await expect(creditContract(db, actor, SO, { amountSen: 300_001, reason: 'Refund' })).rejects.toMatchObject({ status: 409, code: 'credit_exceeds_billed' });
    expect(seen.some((s) => /insert into scm\.acc_credit_notes/.test(s.text))).toBe(false);
  });

  test('a credit raises the note, a RENO-CREDIT row and the contract credit', async () => {
    const { db, seen } = scriptDb([
      [HEAD_RE, () => [head]],
      [/as net_billed_sen/, () => [{ net_billed_sen: 1_000_000 }]],
      [/select advance_account_code/, () => [{ advance_account_code: '480-S012' }]],
      [/next_doc_no_n/, () => [{ n: 4 }]],
      [/insert into scm\.acc_credit_notes/, () => [{ id: 'cn-9' }]],
      [/with s as/, () => [{ total: 9_500_000 }]],
    ]);
    const out = await creditContract(db, actor, SO, { amountSen: 500_000, reason: 'Special discount', noteDate: '2026-11-20' });
    expect(out).toMatchObject({ noteNumber: '2990CN-2611-004', creditNoteId: 'cn-9' });
    const note = seen.find((s) => /insert into scm\.acc_credit_notes/.test(s.text))!;
    expect(note.params).toEqual(expect.arrayContaining([500_000, '301-M002', SO, '2026-11-20']));
    const so = seen.find((s) => /insert into scm\.mfg_sales_order_items/.test(s.text))!;
    expect(so.text).toContain("'RENO-CREDIT'");
    expect(so.params).toEqual(expect.arrayContaining([-500_000]));
    const cc = seen.find((s) => /insert into scm\.reno_contract_credits/.test(s.text))!;
    expect(cc.params).toEqual(expect.arrayContaining(['cn-9', '2990CN-2611-004', 500_000]));
  });

  test('a nil amount or no reason is refused before anything is read', async () => {
    const { db, seen } = scriptDb([]);
    await expect(creditContract(db, actor, SO, { amountSen: 0, reason: 'x' })).rejects.toMatchObject({ code: 'invalid_amount' });
    await expect(creditContract(db, actor, SO, { amountSen: 10, reason: '  ' })).rejects.toMatchObject({ code: 'reason_required' });
    expect(seen).toHaveLength(0);
  });
});

describe('cancel contract', () => {
  test('cancelling after a partial refund leaves the kept part as revenue', async () => {
    const sb = harness();
    await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-03', actor: 'Chew' });
    await invoice(sb, 1_000_000);
    const note = draftNote(sb, 'cn-1', '2990CN-2611-001', 600_000);
    contractCredit(sb, 'cn-1', '2990CN-2611-001', 600_000);
    expect(await postCreditNote(sb, { companyId: CO, note, actor: 'Finance' })).toMatchObject({ ok: true });

    /* Not yet cancelled: nothing to clear. */
    expect(await postContractCancel(sb, { companyId: CO, soDocNo: SO, date: '2026-11-25', actor: 'Finance' })).toMatchObject({ ok: false, status: 'not_cancelled' });
    sb.tables.mfg_sales_orders[0].status = 'CANCELLED';
    const r = await postContractCancel(sb, { companyId: CO, soDocNo: SO, date: '2026-11-25', actor: 'Finance' });
    expect(r).toMatchObject({ ok: true, status: 'posted', deltaSen: 9_000_000 });
    expect(journalOf(sb, 'RCAN', SO)).toEqual([
      { account: '480-S012', dr: 9_000_000, cr: 0, party: null },
      { account: '301-0000', dr: 0, cr: 9_000_000, party: '301-M002' },
    ]);
    const bal = balances(sb);
    expect(bal['480-S012'] ?? 0).toBe(0);
    expect(revenueToDate(sb)).toBe(400_000);
    expect(-(bal['505-0000'] ?? 0)).toBe(200_000);
    expect(bal['301-0000']).toBe(10_000_000 - 600_000 - 9_000_000);
    /* Again: the advance is at 0, nothing more. */
    expect(await postContractCancel(sb, { companyId: CO, soDocNo: SO, date: '2026-11-25', actor: 'Finance' })).toMatchObject({ ok: true, status: 'nothing' });
    expect(await contractPostingState(sb, { companyId: CO, soDocNo: SO })).toMatchObject({ status: 'in_step' });
  });

  test('a cancelled contract whose clearing was refused shows as under-posted', async () => {
    const sb = harness();
    await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-03', actor: 'Chew' });
    sb.tables.mfg_sales_orders[0].status = 'CANCELLED';
    expect(await contractPostingState(sb, { companyId: CO, soDocNo: SO })).toMatchObject({ status: 'under_posted', uncleared: 10_000_000 });
  });

  /** Signed, invoiced 1,000,000 and cancelled (advance cleared to 0). */
  async function cancelled() {
    const sb = harness();
    await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-03', actor: 'Chew' });
    await invoice(sb, 1_000_000);
    sb.tables.mfg_sales_orders[0].status = 'CANCELLED';
    expect(await postContractCancel(sb, { companyId: CO, soDocNo: SO, date: '2026-11-25', actor: 'Finance' })).toMatchObject({ ok: true, status: 'posted', deltaSen: 9_000_000 });
    return sb;
  }

  test('an invoice cancelled after the contract was cancelled: the advance is cleared again', async () => {
    const sb = await cancelled();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-27T04:00:00Z'));
    const no = sb.tables.sales_invoices[0].invoice_number;
    sb.tables.sales_invoices[0].status = 'CANCELLED';
    expect(await reverseSiRevenue(sb, no)).toMatchObject({ ok: true, status: 'reversed' });
    expect(journalOf(sb, 'RCAN', `${SO}-2`)).toEqual([
      { account: '480-S012', dr: 1_000_000, cr: 0, party: null },
      { account: '301-0000', dr: 0, cr: 1_000_000, party: '301-M002' },
    ]);
    expect(balances(sb)['480-S012'] ?? 0).toBe(0);
    expect(revenueToDate(sb)).toBe(0);
    expect(await contractPostingState(sb, { companyId: CO, soDocNo: SO })).toMatchObject({ status: 'in_step' });
  });

  test('an invoice posted late on a cancelled contract: the advance is cleared again', async () => {
    const sb = await cancelled();
    await invoice(sb, 500_000, '2026-11-26');
    expect(journalOf(sb, 'RCAN', `${SO}-2`)).toEqual([
      { account: '301-0000', dr: 500_000, cr: 0, party: '301-M002' },
      { account: '480-S012', dr: 0, cr: 500_000, party: null },
    ]);
    expect(balances(sb)['480-S012'] ?? 0).toBe(0);
    expect(revenueToDate(sb)).toBe(1_500_000);
  });

  test('an old contract with only its opening balance on the advance is cleared to 0', async () => {
    const sb = harness({ soDate: '2026-10-10', billedBefore: 1_000_000 });
    sb.tables.journal_entries.push({ id: 'op-1', company_id: CO, je_no: 'OB-1', entry_date: '2026-10-31', source_type: 'OPENING', source_doc_no: 'OPENING', posted: true, reversed: false, reversed_by_je: null, total_debit_sen: 9_000_000, total_credit_sen: 9_000_000 });
    sb.tables.journal_entry_lines.push({ id: 1, company_id: CO, journal_entry_id: 'op-1', line_no: 1, account_code: '480-S012', debit_sen: 0, credit_sen: 9_000_000 });
    sb.tables.mfg_sales_orders[0].status = 'CANCELLED';
    expect(await contractPostingState(sb, { companyId: CO, soDocNo: SO })).toMatchObject({ status: 'under_posted', uncleared: 9_000_000 });
    const r = await postContractCancel(sb, { companyId: CO, soDocNo: SO, date: null, actor: 'Finance' });
    expect(r).toMatchObject({ ok: true, status: 'posted', deltaSen: 9_000_000 });
    expect(journalOf(sb, 'RCAN', SO)).toEqual([
      { account: '480-S012', dr: 9_000_000, cr: 0, party: null },
      { account: '301-0000', dr: 0, cr: 9_000_000, party: '301-M002' },
    ]);
    expect(balances(sb)['480-S012'] ?? 0).toBe(0);
    /* Dated today, or the ledger start when today is before it. */
    expect(sb.tables.journal_entries.find((j) => j.source_type === 'RCAN')!.entry_date >= '2026-11-01').toBe(true);
    expect(await contractPostingState(sb, { companyId: CO, soDocNo: SO })).toMatchObject({ status: 'in_step' });
  });
});

describe('the cancel gate', () => {
  test('refused while the contract is under-posted', async () => {
    const sb = harness();
    const r = await cancelGate(sb, { companyId: CO, soDocNo: SO, isFinance: true });
    expect(r).toMatchObject({ ok: false, status: 'contract_under_posted' });
    if (!r.ok) expect(r.reason).toContain(SO);
  });

  test('refused while an issued invoice or a credit note on it is unposted', async () => {
    const sb = harness();
    await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-03', actor: 'Chew' });
    sb.tables.sales_invoices.push({ id: 'si-x', invoice_number: '2990SI-2611-900', invoice_date: '2026-11-05', total_sen: 100_000, company_id: CO, so_doc_no: SO, status: 'SENT' });
    const r = await cancelGate(sb, { companyId: CO, soDocNo: SO, isFinance: true });
    expect(r).toMatchObject({ ok: false, status: 'documents_unposted' });
    if (!r.ok) expect(r.reason).toContain('2990SI-2611-900');

    const sb2 = harness();
    await postContractChange(sb2, { companyId: CO, soDocNo: SO, date: '2026-11-03', actor: 'Chew' });
    draftNote(sb2, 'cn-1', '2990CN-2611-001', 100_000);
    const r2 = await cancelGate(sb2, { companyId: CO, soDocNo: SO, isFinance: true });
    expect(r2).toMatchObject({ ok: false, status: 'documents_unposted' });
    if (!r2.ok) expect(r2.reason).toContain('2990CN-2611-001');
  });

  test('a billed contract needs finance to cancel it', async () => {
    const sb = harness();
    await postContractChange(sb, { companyId: CO, soDocNo: SO, date: '2026-11-03', actor: 'Chew' });
    expect(await cancelGate(sb, { companyId: CO, soDocNo: SO, isFinance: false })).toEqual({ ok: true });
    await invoice(sb, 1_000_000);
    sb.tables.reno_instalment_bills.push({ id: 'b-1', company_id: CO, so_doc_no: SO, kind: 'INVOICE', amount_sen: 1_000_000 });
    expect(await cancelGate(sb, { companyId: CO, soDocNo: SO, isFinance: false })).toMatchObject({ ok: false, status: 'forbidden' });
    expect(await cancelGate(sb, { companyId: CO, soDocNo: SO, isFinance: true })).toEqual({ ok: true });
  });

  test('an old contract signed before the ledger start is not held by the contract posting', async () => {
    const sb = harness({ soDate: '2026-10-10' });
    expect(await cancelGate(sb, { companyId: CO, soDocNo: SO, isFinance: true })).toEqual({ ok: true });
  });
});

describe('review fixes', () => {
  test('a give-back debits the account the revenue went to, not today\'s binding', async () => {
    const sb = harness();
    await invoice(sb, 1_000_000);
    sb.tables.acc_sub_category_accounts.find((r) => r.sub_category_code === 'ELECTRICAL')!.sales_account = '501-0090';
    const note = draftNote(sb, 'cn-1', '2990CN-2611-001', 500_000);
    contractCredit(sb, 'cn-1', '2990CN-2611-001', 500_000);
    expect(await postCreditNote(sb, { companyId: CO, note, actor: 'Finance' })).toMatchObject({ ok: true });
    expect(journalOf(sb, 'CN', '2990CN-2611-001')).toEqual([
      { account: '301-0000', dr: 0, cr: 500_000, party: '301-M002' },
      { account: '501-0020', dr: 222_223, cr: 0, party: null },
      { account: '501-0030', dr: 277_777, cr: 0, party: null },
    ]);
  });

  test('cancelling a contract credit puts the contract back to its amount', async () => {
    const sb = harness();
    await invoice(sb, 1_000_000);
    const note = draftNote(sb, 'cn-1', '2990CN-2611-001', 500_000);
    contractCredit(sb, 'cn-1', '2990CN-2611-001', 500_000);
    await postCreditNote(sb, { companyId: CO, note, actor: 'Finance' });
    await cancelCreditNote(sb, { companyId: CO, note: sb.tables.acc_credit_notes[0], actor: 'Finance', entryDate: '2026-11-21' });
    expect(sb.tables.mfg_sales_orders[0].local_total_sen).toBe(10_000_000);
    expect(sb.tables.mfg_sales_orders[0].line_count).toBe(5);
  });

  test('a posted note keeps its lines when the rewrite cannot be saved', async () => {
    const base = harness();
    await invoice(base, 1_000_000);
    const note = draftNote(base, 'cn-1', '2990CN-2611-001', 500_000);
    contractCredit(base, 'cn-1', '2990CN-2611-001', 500_000);
    let failed = false;
    const sb = new Proxy(base, {
      get(target, key, recv) {
        if (key !== 'from') return Reflect.get(target, key, recv);
        return (table: string) => {
          const b = target.from(table);
          if (table !== 'acc_credit_note_lines' || failed) return b;
          return new Proxy(b, { get(t, k, r) {
            if (k !== 'insert') return Reflect.get(t, k, r);
            return () => { failed = true; return Promise.resolve({ data: null, error: { message: 'down' } }); };
          } });
        };
      },
    });
    expect(await postCreditNote(sb, { companyId: CO, note, actor: 'Finance' })).toMatchObject({ ok: true, status: 'posted' });
    expect(failed).toBe(true);
    expect(base.tables.acc_credit_note_lines.filter((l) => l.note_id === 'cn-1').map((l) => [l.account_code, l.amount_sen])).toEqual([['480-S012', 500_000]]);
  });

  test('two first invoices racing on an old contract seed its go-live amount once', async () => {
    const sb = harness({ soDate: '2026-10-10', billedBefore: 1_000_000 });
    sb.tables.sales_invoices.push(
      { id: 'si-a', invoice_number: '2990SI-2611-801', invoice_date: '2026-11-12', debtor_code: '301-M002', debtor_name: 'MS LEE', total_sen: 100_000, company_id: CO, so_doc_no: SO, status: 'SENT' },
      { id: 'si-b', invoice_number: '2990SI-2611-802', invoice_date: '2026-11-12', debtor_code: '301-M002', debtor_name: 'MS LEE', total_sen: 100_000, company_id: CO, so_doc_no: SO, status: 'SENT' },
    );
    await Promise.all([postSiRevenue(sb, '2990SI-2611-801'), postSiRevenue(sb, '2990SI-2611-802')]);
    const opening = sb.tables.reno_revenue_allocations.filter((a) => a.source_type === 'OPENING');
    expect(opening.reduce((s, a) => s + Number(a.amount_sen), 0)).toBe(1_000_000);
    expect(new Set(opening.map((a) => a.line_key)).size).toBe(opening.length);
  });
});
