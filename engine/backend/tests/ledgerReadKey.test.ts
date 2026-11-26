import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { canReadBooks } from '../src/scm/lib/houzs-perms';
import { itemGroupCreate, itemGroupsList } from '../src/scm/routes/accounting-item-groups';

const callerWith = (permissions: string[]) => ({ get: (key: string) => (key === 'houzsUser' ? { id: 7, name: 'Reader', permissions_set: new Set(permissions) } : undefined) });

function harness(permissions: string[]) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('houzsUser' as never, { id: 7, name: 'Reader', permissions_set: new Set(permissions) } as never);
    await next();
  });
  app.get('/item-groups', itemGroupsList as never);
  app.post('/item-groups', itemGroupCreate as never);
  return app;
}

describe('canReadBooks', () => {
  test('a caller holding the ledger area and the reports key can read the books', () => {
    expect(canReadBooks(callerWith(['scm.ledger.use', 'scm.ledger.reports']) as never)).toBe(true);
  });

  test('a caller holding only the ledger area cannot read the books', () => {
    expect(canReadBooks(callerWith(['scm.ledger.use']) as never)).toBe(false);
  });

  test('a caller holding the post key can still read the books', () => {
    expect(canReadBooks(callerWith(['scm.payment_voucher.post']) as never)).toBe(true);
  });
});

describe('item groups routes for a reports-key holder', () => {
  test('the read route is not refused', async () => {
    const res = await harness(['scm.ledger.use', 'scm.ledger.reports']).request('/item-groups');
    expect(res.status).not.toBe(403);
  });

  test('the write route is still refused', async () => {
    const res = await harness(['scm.ledger.use', 'scm.ledger.reports']).request('/item-groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  test('the read route is refused for a caller without either key', async () => {
    const res = await harness(['scm.ledger.use']).request('/item-groups');
    expect(res.status).toBe(403);
  });
});
