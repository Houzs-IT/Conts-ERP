/* Pay is one press: no voucher asked for, the journal made behind it, and a refusal never undoes the payment. */
import { beforeEach, describe, expect, it } from 'vitest';
import { poVoucherDeps, voucherBody, voucherForPoPayment, withVoucherKeys, type PoPaymentFacts } from './renovation-po-voucher';

const facts: PoPaymentFacts = { paidOn: '2026-11-07', amountSen: 30000, label: 'Mobilise', poNumber: 'TC-PO-1', projectId: 7, supplier: { id: 's1', name: 'Kim Hup', code: '400-K001', control_account: null } };
const roles = { BANK_DEFAULT: '310-0010', AP: '400-0000', AP_OTHER: '405-0000' } as never;
const updates: unknown[] = [];
const c = { req: { param: () => '' }, get: (k: string) => {
  if (k === 'supabase') return { from: () => ({ update: (r: unknown) => { updates.push(r); return { eq: async () => ({}) }; } }) };
  if (k === 'houzsUser') return { permissions: ['x'] };
  return 1;
} };

describe('voucherForPoPayment', () => {
  beforeEach(() => {
    updates.length = 0;
    poVoucherDeps.roles = async () => roles;
    poVoucherDeps.create = async () => new Response(JSON.stringify({ id: 'pv1', pvNumber: 'PV-1' }), { status: 201 });
    poVoucherDeps.post = async () => new Response('{"ok":true}', { status: 200 });
  });
  it('pays the supplier control from the default bank', () => {
    expect(voucherBody(facts, roles)).toMatchObject({ creditAccountCode: '310-0010', supplierId: 's1', voucherDate: '2026-11-07', lines: [{ debitAccountCode: '400-0000', amountSen: 30000 }] });
  });
  it('makes the voucher, ties it to the payment and posts it', async () => {
    expect(await voucherForPoPayment(c, 'p1', facts)).toEqual({ pvNumber: 'PV-1', posted: true, problem: null });
    expect(updates).toEqual([{ payment_voucher_id: 'pv1' }]);
  });
  it('a refused post leaves the voucher a draft and says why', async () => {
    poVoucherDeps.post = async () => new Response('{"message":"No series letter"}', { status: 409 });
    expect(await voucherForPoPayment(c, 'p1', facts)).toEqual({ pvNumber: 'PV-1', posted: false, problem: 'No series letter' });
  });
  it('never throws: the payment stands', async () => {
    poVoucherDeps.create = async () => { throw new Error('down'); };
    expect((await voucherForPoPayment(c, 'p1', facts)).problem).toBe('down');
  });
  it('carries the voucher keys and its id for this voucher only', () => {
    const inner = withVoucherKeys(c, 'pv1');
    expect(inner.req.param('id')).toBe('pv1');
    expect(inner.get('houzsUser').permissions).toContain('scm.payment_voucher.approve');
  });
});
