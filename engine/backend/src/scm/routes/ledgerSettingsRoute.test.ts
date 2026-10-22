/* GET / PUT /settings/ledger: the ledger start date and the fiscal year end
 * (finance 2026-10-21). Only someone who may post to the GL may change them.
 */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { User } from '@supabase/supabase-js';

import { fakeSb } from '../lib/fake-postgrest';
import type { Env, Variables } from '../env';

const CO = 1;
const tables: Record<string, Record<string, unknown>[]> = {
  acc_company_settings: [{ company_id: CO, deposit_invoice_enabled: true }],
};
const sb = fakeSb(tables);

vi.mock('../../db/supabase', () => ({ getSupabaseService: () => sb }));

const CALLER = {
  id: '7', email: 'acct@conts.test', app_metadata: {},
  user_metadata: { name: 'Acct' }, aud: 'authenticated', created_at: '',
} as unknown as User;

const { ledgerSettingsGet, ledgerSettingsPut } = await import('./accounting');

function app(perms: string[], db: unknown = sb) {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.use('*', async (c, next) => {
    c.set('user', CALLER);
    c.set('companyId', CO);
    c.set('supabase', db as never);
    c.set('houzsUser' as never, { id: 9, name: 'Acct', permissions_set: new Set(perms) } as never);
    await next();
  });
  a.get('/settings/ledger', ledgerSettingsGet as never);
  a.put('/settings/ledger', ledgerSettingsPut as never);
  return a;
}

const put = (body: unknown, perms = ['*']) => app(perms).request('/settings/ledger', {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('the ledger settings route', () => {
  it('answers the defaults before anything is set', async () => {
    const res = await app(['*']).request('/settings/ledger');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ledgerStartDate: null, fiscalYearEndMonth: 8 });
  });

  it('saves the start date and the year end month', async () => {
    const res = await put({ ledgerStartDate: '2026-12-01', fiscalYearEndMonth: 8 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ledgerStartDate: '2026-12-01', fiscalYearEndMonth: 8 });
    expect(tables.acc_company_settings[0].deposit_invoice_enabled).toBe(true);
    expect(tables.acc_company_settings[0].updated_by).toBe('Acct');
  });

  it('refuses a date that is not YYYY-MM-DD', async () => {
    const res = await put({ ledgerStartDate: '1/12/2026' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Enter a date like 2026-12-01.' });
  });

  /* The start date decides what posts: a day that does not exist is refused here, not by the database's 500. */
  it('refuses a day that does not exist', async () => {
    const res = await put({ ledgerStartDate: '2026-02-30' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Enter a date like 2026-12-01.' });
  });

  it('writes who changed the start date, from what to what, to the history', async () => {
    tables.entity_audit_log = [];
    await put({ ledgerStartDate: '2026-12-01' });
    tables.entity_audit_log = [];
    const res = await put({ ledgerStartDate: '2027-01-01', fiscalYearEndMonth: 8 });
    expect(res.status).toBe(200);
    expect(tables.entity_audit_log).toHaveLength(1);
    expect(tables.entity_audit_log[0]).toMatchObject({
      entity_type: 'LEDGER_SETTINGS', entity_id: String(CO), company_id: CO, action: 'UPDATE', actor_name_snapshot: 'Acct',
      field_changes: [{ field: 'ledger_start_date', from: '2026-12-01', to: '2027-01-01' }],
    });
  });

  it('saves nothing when the history cannot be written', async () => {
    const t: Record<string, Record<string, unknown>[]> = { acc_company_settings: [{ company_id: CO, ledger_start_date: '2026-12-01' }], entity_audit_log: [] };
    const broken = fakeSb(t, { entity_audit_log: ['id'] });
    const res = await app(['*'], broken).request('/settings/ledger', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ledgerStartDate: '2027-01-01' }),
    });
    expect(res.status).toBe(409);
    expect(t.acc_company_settings[0].ledger_start_date).toBe('2026-12-01');
  });

  it('refuses a month outside 1 to 12', async () => {
    const res = await put({ fiscalYearEndMonth: 13 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Choose a month from 1 to 12.' });
  });

  it('refuses someone who cannot post to the GL', async () => {
    const res = await put({ ledgerStartDate: '2026-12-01' }, ['scm.sales_order.read']);
    expect(res.status).toBe(403);
  });
});
