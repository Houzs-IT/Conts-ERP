/* The Ledger area (Conts, finance phase 1, 21 Oct 2026). Property OS sends a
   ninth level at sign-on, `ledger`. It turns into the engine permission
   `scm.ledger.use`, which every ledger route asks for LITERALLY: the `*`
   wildcard never counts. Pinned:
     · a sign-on without `ledger` still signs in, as None;
     · Full in the eight supply areas without the ledger keeps the plain `*`
       role, exactly as before;
     · Full everywhere with the ledger gets that role's permissions plus the
       ledger keys, one role per ledger level;
     · the ledger guard refuses `*` alone, lets the key through, and leaves the
       official receipts and the shared account list open. */

import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { contsPageAccess, contsPermissions, parseContsAccess, type ContsAccess } from '../src/conts/access';
import { ACCOUNTING_OPEN_PATHS, LEDGER_KEY, ledgerPermissions, requireLedgerAccess } from '../src/conts/ledger-access';
import { roleIdFor } from '../src/conts/sso';

const EIGHT = ['scSales', 'scInvoices', 'scConsignment', 'scProcurement', 'scTransportPlan', 'scWarehouse', 'serviceCases', 'projects'];
const levels = (level: string, ledger?: string) => ({
  ...Object.fromEntries(EIGHT.map((k) => [k, level])),
  ...(ledger ? { ledger } : {}),
});

type Role = { id: number; name: string; permissions: string };

/* Just the statements sso.ts and access.ts send, over two in-memory tables. */
function fakeDb(roles: Role[]) {
  const settings = new Map<string, string>();
  const run = (sql: string, args: unknown[]) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith("SELECT id FROM roles WHERE permissions LIKE")) {
      const hit = roles.filter((r) => r.permissions.includes('"*"') && !r.name.startsWith('Conts: ')).sort((a, b) => a.id - b.id)[0];
      return hit ? { id: hit.id } : null;
    }
    if (s.startsWith('SELECT permissions FROM roles WHERE id = ?')) {
      const r = roles.find((x) => x.id === args[0]);
      return r ? { permissions: r.permissions } : null;
    }
    if (s.startsWith('SELECT id, permissions FROM roles WHERE name = ?')) {
      const r = roles.find((x) => x.name === args[0]);
      return r ? { id: r.id, permissions: r.permissions } : null;
    }
    if (s.startsWith('SELECT id FROM roles WHERE name = ?')) {
      const r = roles.find((x) => x.name === args[0]);
      return r ? { id: r.id } : null;
    }
    if (s.startsWith('INSERT INTO roles')) {
      roles.push({ id: Math.max(0, ...roles.map((r) => r.id)) + 1, name: String(args[0]), permissions: String(args[2]) });
      return null;
    }
    if (s.startsWith('UPDATE roles SET permissions = ? WHERE id = ?')) {
      const r = roles.find((x) => x.id === args[1]);
      if (r) r.permissions = String(args[0]);
      return null;
    }
    if (s.startsWith('INSERT INTO app_settings')) { settings.set(String(args[0]), String(args[1])); return null; }
    throw new Error(`fakeDb: unexpected SQL ${s}`);
  };
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind: (...a: unknown[]) => { args = a; return stmt; },
      first: async () => run(sql, args),
      run: async () => { run(sql, args); return { success: true }; },
    };
    return stmt;
  };
  return { DB: { prepare }, roles, settings };
}

const OWNER: Role = { id: 1, name: 'Owner', permissions: JSON.stringify(['*', 'projects.approve']) };

describe('the sign-on levels', () => {
  test('parseContsAccess treats a missing ledger as none', () => {
    const a = parseContsAccess(levels('full'));
    expect(a).not.toBeNull();
    expect(a!.ledger).toBe('none');
  });

  test('a ledger level that is not a level is refused, like any other area', () => {
    expect(parseContsAccess(levels('full', 'owner'))).toBeNull();
  });

  test('ledgerPermissions grants the payment voucher keys by level', () => {
    expect(ledgerPermissions('none')).toEqual([]);
    expect(ledgerPermissions('view')).toEqual([LEDGER_KEY]);
    expect(ledgerPermissions('edit')).toEqual([LEDGER_KEY, 'scm.payment_voucher.create', 'scm.payment_voucher.write']);
    expect(ledgerPermissions('full')).toEqual([
      LEDGER_KEY, 'scm.payment_voucher.create', 'scm.payment_voucher.write',
      'scm.payment_voucher.check', 'scm.payment_voucher.approve', 'scm.payment_voucher.post', 'scm.payment_voucher.cancel',
    ]);
  });

  test('a role short of Full gets the ledger keys and the accounting page at the higher of its two levels', () => {
    const a = parseContsAccess({ ...levels('edit'), scInvoices: 'view', ledger: 'full' }) as ContsAccess;
    expect(contsPermissions(a)).toEqual(expect.arrayContaining(ledgerPermissions('full')));
    expect(contsPageAccess(a)['scm.finance.accounting']).toBe('full');
    const none = parseContsAccess({ ...levels('edit'), scInvoices: 'view' }) as ContsAccess;
    expect(contsPermissions(none)).not.toContain(LEDGER_KEY);
    expect(contsPageAccess(none)['scm.finance.accounting']).toBe('view');
  });
});

describe('the engine role at sign-on', () => {
  test('Full in the eight supply areas without the ledger keeps the * role, unchanged', async () => {
    const env = fakeDb([{ ...OWNER }]);
    const id = await roleIdFor(env as never, 'operations_manager', parseContsAccess(levels('full', 'none'))!);
    expect(id).toBe(1);
    expect(env.roles).toEqual([OWNER]);
  });

  test('Full everywhere with the ledger at Full gets the * role permissions plus the ledger keys', async () => {
    const env = fakeDb([{ ...OWNER }]);
    const id = await roleIdFor(env as never, 'management', parseContsAccess(levels('full', 'full'))!);
    const role = env.roles.find((r) => r.id === id)!;
    expect(role.name).toBe('Conts: full + ledger full');
    expect(JSON.parse(role.permissions)).toEqual(['*', 'projects.approve', ...ledgerPermissions('full')]);
  });

  test('each ledger level has its own role, so two people never overwrite one another', async () => {
    const env = fakeDb([{ ...OWNER }]);
    const full = await roleIdFor(env as never, 'management', parseContsAccess(levels('full', 'full'))!);
    const view = await roleIdFor(env as never, 'finance_admin', parseContsAccess(levels('full', 'view'))!);
    expect(full).not.toBe(view);
    expect(JSON.parse(env.roles.find((r) => r.id === full)!.permissions)).toContain('scm.payment_voucher.post');
    expect(JSON.parse(env.roles.find((r) => r.id === view)!.permissions)).not.toContain('scm.payment_voucher.post');
  });

  test('the plain * role is still the one found after a ledger role exists', async () => {
    const env = fakeDb([{ ...OWNER }]);
    await roleIdFor(env as never, 'management', parseContsAccess(levels('full', 'full'))!);
    expect(await roleIdFor(env as never, 'operations_manager', parseContsAccess(levels('full'))!)).toBe(1);
  });

  test('a role with only the ledger can still sign in', async () => {
    const env = fakeDb([{ ...OWNER }]);
    const id = await roleIdFor(env as never, 'finance_admin', parseContsAccess({ ...levels('none'), ledger: 'view' })!);
    expect(id).not.toBeNull();
    expect(JSON.parse(env.roles.find((r) => r.id === id)!.permissions)).toContain(LEDGER_KEY);
  });
});

describe('the ledger guard', () => {
  const app = (perms: string[]) => {
    const a = new Hono();
    a.use('*', async (c, next) => { c.set('user' as never, { permissions: perms, permissions_set: new Set(perms) } as never); await next(); });
    a.use('/api/scm/accounting/*', requireLedgerAccess({ except: ACCOUNTING_OPEN_PATHS }) as never);
    a.use('/api/scm/payment-vouchers/*', requireLedgerAccess() as never);
    a.all('*', (c) => c.json({ ok: true }));
    return a;
  };

  test('refuses * without the ledger key', async () => {
    const res = await app(['*']).request('/api/scm/payment-vouchers/abc');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Your role cannot open the accounts.' });
    expect((await app(['*']).request('/api/scm/accounting/gl')).status).toBe(403);
  });

  test('lets the ledger key through', async () => {
    expect((await app(['*', LEDGER_KEY]).request('/api/scm/payment-vouchers/abc')).status).toBe(200);
    expect((await app([LEDGER_KEY]).request('/api/scm/accounting/gl')).status).toBe(200);
  });

  test('official receipt paths stay open without the ledger key', async () => {
    const a = app(['*']);
    expect((await a.request('/api/scm/accounting/receipts')).status).toBe(200);
    expect((await a.request('/api/scm/accounting/receipts/ensure', { method: 'POST' })).status).toBe(200);
    expect((await a.request('/api/scm/accounting/receipts/r-1/formalise', { method: 'POST' })).status).toBe(200);
    expect((await a.request('/api/scm/accounting/receipts/r-1/files')).status).toBe(200);
  });

  test('the account list stays readable for the credit notes screen, but not writable', async () => {
    const a = app(['*']);
    expect((await a.request('/api/scm/accounting/accounts')).status).toBe(200);
    expect((await a.request('/api/scm/accounting/accounts', { method: 'POST' })).status).toBe(403);
    expect((await a.request('/api/scm/accounting/receipts-payments')).status).toBe(403);
  });
});
