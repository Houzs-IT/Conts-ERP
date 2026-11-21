// Finance's To do — the built-in rules (ported from Houzs acc/finance-todo.test.ts, filled with Conts' items): which
// facts raise which job, whose desk it is on, how long it has waited, and the month's checklist.

import { describe, it, expect } from 'vitest';
import { addDays, bankName, buildFinanceTodo, raiseJobs, BUILT_IN_RULES, type TodoFacts, type TodoViewer } from './finance-todo';

const TODAY = '2026-11-02';

const facts = (over: Partial<TodoFacts> = {}): TodoFacts => ({
  today: TODAY,
  requests: [], claims: [], vouchers: [], bills: [], limits: [],
  bankAccounts: [], lastStatementTo: {}, bankLines: [], lockedLastMonth: [],
  receipts: [], deposits: [], einvoices: [],
  trialBalanceDiffSen: null, done: [], problems: [], rulesOff: [],
  ...over,
});

const FINANCE: TodoViewer = { id: '7', name: 'Mei Ling', finance: true, checker: true, approver: true, limitApprover: true };
const req = (payee: string, over: Partial<TodoFacts['requests'][number]> = {}) =>
  ({ no: `PRQ-${payee}`, payee, amountSen: 1_000, createdOn: '2026-10-30', wantedOn: null, utility: false, ...over });

describe('payment requests and utility bills', () => {
  it('requests waiting for payment are one job, the payees listed, the oldest setting the wait', () => {
    const { mine } = raiseJobs(facts({
      requests: ['Kian', 'TNB', 'Ikhlas', 'Lim'].map((payee, i) => req(payee, { amountSen: 1_000 * (i + 1), createdOn: `2026-10-2${i}` })),
    }), FINANCE);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      rule: 'requests', group: 'pay', title: 'Pay 4 payment requests', detail: 'Kian · TNB · Ikhlas · +1 more',
      amountSen: 10_000, since: '2026-10-20', action: { label: 'Review', to: '/scm/payment-requests', primary: true },
    });
    expect(raiseJobs(facts({ requests: [req('Kian')] }), FINANCE).mine[0]?.title).toBe('Pay 1 payment request');
  });

  it('a utility bill joins To do a week before it is due, on its own job and not under the requests', () => {
    const { mine } = raiseJobs(facts({
      requests: [
        req('TNB', { utility: true, wantedOn: '2026-10-31', amountSen: 20_000 }),
        req('Air Selangor', { utility: true, wantedOn: addDays(TODAY, 7), amountSen: 5_000 }),
        req('Indah Water', { utility: true, wantedOn: addDays(TODAY, 8) }),
        req('Unifi', { utility: true, wantedOn: null }),
      ],
    }), FINANCE);
    expect(mine.map((j) => j.rule)).toEqual(['utilities']);
    expect(mine[0]).toMatchObject({
      title: 'Pay 2 utility bills due by 09/11/2026', tone: 'err', amountSen: 25_000,
      detail: '1 past due · first due 31/10/2026 · TNB · Air Selangor', action: { to: '/scm/payment-requests?tab=utilities' },
    });
  });
});

describe('staff claims', () => {
  const claim = (who: string, stage: 'check' | 'pay', float = false) => ({ no: `CL-${who}`, who, amountSen: 500, since: '2026-11-01', stage, float });

  it('handed in is a Check — on Petty cash when every one is a float\'s; checked with no voucher is a Pay back', () => {
    const { mine } = raiseJobs(facts({ claims: [claim('Ah Wai', 'check'), claim('Siti', 'check', true), claim('Ah Keong', 'pay')] }), FINANCE);
    expect(mine.map((j) => [j.rule, j.title, j.action.to])).toEqual([
      ['claims-check', 'Check 2 staff claims', '/scm/payment-requests'],
      ['claims-pay', 'Pay back 1 staff claim', '/scm/payment-requests'],
    ]);
    expect(mine[0]!.detail).toBe('Handed in by Ah Wai · Siti');
    expect(raiseJobs(facts({ claims: [claim('Siti', 'check', true)] }), FINANCE).mine[0]!.action.to).toBe('/scm/petty-cash');
  });
});

describe('vouchers', () => {
  it('a voucher to check or approve is on its desk; anyone else sees it waiting on that desk', () => {
    const vouchers = [
      { stage: 'check' as const, payee: 'Kian', amountSen: 1_240_000, since: '2026-10-30', by: 'Daniel' },
      { stage: 'approve' as const, payee: 'Lim', amountSen: 118_000, since: '2026-10-31', by: 'Chew' },
    ];
    const finance = raiseJobs(facts({ vouchers }), { ...FINANCE, approver: false });
    expect(finance.mine.map((j) => j.rule)).toEqual(['pv-check']);
    expect(finance.mine[0]).toMatchObject({ title: 'Check 1 payment voucher', detail: 'Prepared by Daniel · Kian', action: { to: '/scm/payment-vouchers?status=PREPARED' } });
    expect(finance.others[0]).toMatchObject({ rule: 'pv-approve', who: 'Approver', title: 'Approve 1 payment voucher', detail: 'Checked by Chew · Lim', action: { to: '/scm/payment-vouchers?status=CHECKED' } });
  });
});

describe('supplier bills', () => {
  it('past due is one job (waiting from the day after), due within a week another', () => {
    const { mine } = raiseJobs(facts({ bills: [
      { no: 'AP-2', supplier: 'Kian', outstandingSen: 30_000, dueDate: '2026-10-20' },
      { no: 'AP-1', supplier: 'TNB', outstandingSen: 10_000, dueDate: '2026-10-15' },
      { no: 'AP-3', supplier: 'Ace', outstandingSen: 5_000, dueDate: TODAY },
      { no: 'AP-4', supplier: 'Lim', outstandingSen: 5_000, dueDate: addDays(TODAY, 7) },
    ] }), FINANCE);
    expect(mine[0]).toMatchObject({
      rule: 'ap-overdue', tone: 'err', title: 'Pay 2 overdue supplier bills', detail: 'AP-1 TNB · AP-2 Kian', amountSen: 40_000, since: '2026-10-16',
      action: { to: '/scm/ap-invoices' },
    });
    expect(mine[1]).toMatchObject({ rule: 'ap-due', title: 'Pay 2 supplier bills due within 7 days', detail: 'First due 02/11/2026 · Ace · Lim', amountSen: 10_000, since: null });
  });
});

describe('limit requests', () => {
  const limit = (by: string, byId: string | null) => ({ project: 'Skyline A-01', by, byId, amountSen: 100_000, since: '2026-11-01' });

  it('are on the approvers, never on whoever asked — their own wait on another approver', () => {
    const { mine, others } = raiseJobs(facts({ limits: [limit('Ah Wai', '9'), limit('Mei Ling', '7')] }), FINANCE);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ rule: 'limits', title: 'Decide 1 project limit request', detail: 'Skyline A-01 · asked by Ah Wai', action: { to: '/scm/limit-requests' } });
    expect(others).toEqual([expect.objectContaining({ rule: 'limits', who: 'Approver', title: '1 project limit request you asked for' })]);
    expect(raiseJobs(facts({ limits: [limit('Ah Wai', '9')] }), { ...FINANCE, limitApprover: false }).others[0]?.who).toBe('Approver');
  });
});

describe('bank statements', () => {
  const HLB = { accountCode: '310-0001', bankCode: 'HLB', accountName: 'HONG LEONG CA', createdOn: '2026-09-01' };
  const MBB = { accountCode: '310-0002', bankCode: 'MBB', accountName: 'MAYBANK CA', createdOn: '2026-10-29' };

  it('an account with no statement for three days is an upload', () => {
    const late = raiseJobs(facts({ bankAccounts: [HLB], lastStatementTo: { '310-0001': addDays(TODAY, -4) } }), FINANCE).mine;
    expect(late[0]).toMatchObject({
      rule: 'bank-missing', group: 'bank', title: 'Upload Hong Leong statement', since: '2026-10-30',
      detail: '310-0001 HONG LEONG CA · the last upload stops at 29/10/2026 · 30/10/2026 onward is missing',
      action: { label: 'Upload', to: '/scm/bank-recon' },
    });
    expect(raiseJobs(facts({ bankAccounts: [HLB], lastStatementTo: { '310-0001': addDays(TODAY, -3) } }), FINANCE).mine).toEqual([]);
  });

  it('a setup with no statement yet waits from the day it was set up', () => {
    const { mine } = raiseJobs(facts({ bankAccounts: [MBB], lastStatementTo: { '310-0002': null } }), FINANCE);
    expect(mine[0]).toMatchObject({ title: 'Upload Maybank statement', since: '2026-10-29', detail: '310-0002 MAYBANK CA · no statement uploaded yet' });
  });

  it('lines not matched are one Match per account, the amount counted either way', () => {
    const { mine } = raiseJobs(facts({
      bankAccounts: [HLB], lastStatementTo: { '310-0001': TODAY },
      bankLines: [
        { accountCode: '310-0001', statementId: 4, amountSen: -12_000, periodTo: '2026-10-31', uploadedOn: '2026-11-01', month: '2026-10' },
        { accountCode: '310-0001', statementId: 4, amountSen: 3_000, periodTo: '2026-10-31', uploadedOn: '2026-11-01', month: '2026-09' },
      ],
    }), FINANCE);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      rule: 'bank-decide', title: 'Match 2 Hong Leong lines', amountSen: 15_000, since: '2026-11-01',
      detail: '310-0001 · October statement · uploaded 01/11/2026', action: { label: 'Match', to: '/scm/bank-recon' },
    });
  });

  it('names a bank by its code, and keeps a code it does not know', () => {
    expect(bankName('mbb')).toBe('Maybank');
    expect(bankName('XYZ')).toBe('XYZ');
  });
});

describe('money in', () => {
  it('draft receipts are one job to confirm the money arrived', () => {
    const { mine } = raiseJobs(facts({ receipts: [
      { no: 'DR-1', customer: 'Wong', amountSen: 50_000, paidOn: '2026-10-25' }, { no: 'DR-2', customer: 'Tan', amountSen: 7_000, paidOn: null },
    ] }), FINANCE);
    expect(mine[0]).toMatchObject({
      rule: 'receipts', group: 'in', title: 'Confirm 2 customer payments received', amountSen: 57_000, since: '2026-10-25',
      action: { label: 'Confirm', to: '/scm/official-receipts?status=DRAFT' },
    });
  });

  it('confirmed payments with no deposit invoice, and e-invoices to fix', () => {
    const { mine } = raiseJobs(facts({
      deposits: [{ soDocNo: 'SO-2611-0001', amountSen: 300_000, paidOn: '2026-11-01' }],
      einvoices: [
        { no: 'INV-1', status: 'NOT_READY', missing: ['buyer TIN', 'state'], since: '2026-10-29' },
        { no: 'CN-1', status: 'REJECTED', missing: [], since: '2026-10-30' },
      ],
    }), FINANCE);
    expect(mine.map((j) => j.rule)).toEqual(['deposit-invoices', 'einvoice']);
    expect(mine[0]).toMatchObject({ title: 'Issue 1 deposit invoice', amountSen: 300_000, action: { to: '/scm/deposit-invoices' } });
    expect(mine[1]).toMatchObject({ title: 'Fix 2 e-invoices', tone: 'err', detail: '1 rejected · missing buyer TIN · state · INV-1 · CN-1', since: '2026-10-29', action: { to: '/scm/einvoice' } });
  });

  it('someone who does not work Finance sees its jobs waiting on Finance', () => {
    const { mine, others } = raiseJobs(facts({ receipts: [{ no: 'DR-1', customer: 'A', amountSen: 1, paidOn: TODAY }] }), { ...FINANCE, finance: false });
    expect(mine).toEqual([]);
    expect(others[0]?.who).toBe('Finance');
  });
});

describe('rules switched off', () => {
  it('raise nothing', () => {
    const f = facts({ requests: [req('Kian')], receipts: [{ no: 'DR-1', customer: 'A', amountSen: 1, paidOn: TODAY }] });
    expect(raiseJobs({ ...f, rulesOff: ['requests'] }, FINANCE).mine.map((j) => j.rule)).toEqual(['receipts']);
    expect(raiseJobs({ ...f, rulesOff: [...BUILT_IN_RULES] }, FINANCE).mine).toEqual([]);
  });
});

describe('the page', () => {
  it('the checklist counts what is in and what is open, and last month late after the 15th', () => {
    const accounts = [
      { accountCode: '310-0001', bankCode: 'HLB', accountName: 'HLB', createdOn: '2026-09-01' },
      { accountCode: '310-0002', bankCode: 'MBB', accountName: 'MBB', createdOn: '2026-09-01' },
    ];
    const base = facts({
      bankAccounts: accounts, lastStatementTo: { '310-0001': TODAY, '310-0002': '2026-10-01' }, lockedLastMonth: ['310-0001'],
      vouchers: [{ stage: 'check', payee: 'A', amountSen: 1, since: TODAY, by: null }],
      requests: [req('Kian')], claims: [{ no: 'C', who: 'A', amountSen: 1, since: TODAY, stage: 'check', float: true }],
    });
    const page = buildFinanceTodo(base, FINANCE);
    expect(page.checklist.month).toBe('2026-11');
    expect(page.checklist.daysLeft).toBe(28);
    expect(Object.fromEntries(page.checklist.items.map((c) => [c.label, `${c.value}|${c.state}`]))).toEqual({
      'Bank statements in': '1 / 2|open',
      'Bank lines open': '0|ok',
      'October locked': '1 / 2|open',
      'Vouchers in progress': '1 to check|open',
      'Waiting for payment': '1|open',
      'Payments to confirm': 'none|ok',
      'Trial balance': 'not checked|open',
    });
    const late = buildFinanceTodo({ ...base, today: '2026-11-20' }, FINANCE);
    expect(late.checklist.items.find((c) => c.key === 'months-locked')?.state).toBe('late');
    const tb = (d: number) => buildFinanceTodo(facts({ trialBalanceDiffSen: d }), FINANCE).checklist.items.find((c) => c.key === 'trial-balance');
    expect(tb(0)).toMatchObject({ value: '0.00', state: 'ok', detail: 'Debits equal credits' });
    expect(tb(-1_250)).toMatchObject({ value: '12.50', state: 'late', detail: 'Debits and credits differ' });
  });

  it('done today is newest first, and a failed read is carried to the page', () => {
    const page = buildFinanceTodo(facts({
      done: [{ key: 'a', text: 'A', ref: null, at: '09:05' }, { key: 'b', text: 'B', ref: 'PV-1', at: '11:40' }],
      problems: ['bank lines (timeout)'],
    }), FINANCE);
    expect(page.done.map((d) => d.key)).toEqual(['b', 'a']);
    expect(page.problems).toEqual(['bank lines (timeout)']);
  });
});
