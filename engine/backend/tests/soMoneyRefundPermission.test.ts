import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { soMoneyRefundHandler } from '../src/scm/routes/so-money-routes';

/* Sales edit opens this route; the refund it raises is a payment voucher, so the voucher's own permission decides. */
const app = (perms: string[]) => {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('houzsUser' as never, { id: 1, name: 'T', permissions: perms, permissions_set: new Set(perms) } as never);
    c.set('companyId' as never, 1 as never);
    c.set('supabase' as never, { from: () => { throw new Error('reached the data'); } } as never);
    await next();
  });
  a.post('/x/:docNo/money/refund', soMoneyRefundHandler as never);
  return a;
};
const post = (a: Hono) => a.request('/x/SO-1/money/refund', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amountSen: 0 }) });

describe('refund from a sales order', () => {
  test('Sales edit alone is refused', async () => {
    expect((await post(app(['scm.sales.edit']))).status).toBe(403);
  });
  test('the voucher permission goes on to the amount check', async () => {
    expect((await post(app(['scm.payment_voucher.create']))).status).toBe(400);
  });
});
