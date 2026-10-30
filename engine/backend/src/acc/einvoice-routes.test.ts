/* E-invoice settings and outbox routes (plan 2026-10-30-renovation-einvoice-ready.md Task 6). Pinned: reading is for
   whoever has the Ledger (the router's guard); saving needs the post key; SST stays refused; the outbox lists rows with
   counts by status; "Re-check all" prepares the open rows again. */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { fakeSb, type Row } from '../scm/lib/fake-postgrest';
import { einvoiceOutboxGet, einvoiceOutboxList, einvoiceRefresh, einvoiceSettingsGet, einvoiceSettingsPut } from './einvoice-routes';
import { EINVOICE_DEFAULTS } from './einvoice-settings';

const CO = 2;
const SELLER = {
  tin: 'C12345678901', brn: '202001012345', sstNo: '', msicCode: '43301', activityDesc: 'Renovation works', address1: '1 Jalan Contoh', address2: '',
  city: 'Kuala Lumpur', postcode: '50000', stateCode: '14', phone: '0312345678', email: '',
};

function world(over: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    acc_company_settings: [{ company_id: CO }],
    acc_einvoice_outbox: [
      { id: 'o1', company_id: CO, doc_kind: 'INVOICE', doc_number: 'SI-1', sales_invoice_id: 'si-1', debtor_code: '301-M002', status: 'NOT_READY',
        missing: ['buyer ID number'], payload: { id: 'SI-1', issueDate: '2026-11-03', buyer: { name: 'MS LEE' }, totals: { payable: '15000.00' } }, prepared_at: '2026-11-03T02:00:00Z' },
      { id: 'o2', company_id: CO, doc_kind: 'CREDIT_NOTE', doc_number: 'CN-1', credit_note_id: 'cn-1', debtor_code: '301-M002', status: 'CANCELLED',
        missing: [], payload: { id: 'CN-1', issueDate: '2026-11-04', buyer: { name: 'MS LEE' }, totals: { payable: '100.00' } }, prepared_at: '2026-11-04T02:00:00Z' },
      { id: 'o3', company_id: 9, doc_kind: 'INVOICE', doc_number: 'OTHER', status: 'READY', missing: [], payload: {} },
    ],
    ...over,
  };
  return { sb: fakeSb(tables), tables };
}

function app(sb: unknown, perms: string[] = ['scm.payment_voucher.post']) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('houzsUser' as never, { id: 9, name: 'Chew', permissions_set: new Set(perms) } as never);
    await next();
  });
  a.get('/einvoice/settings', einvoiceSettingsGet as never);
  a.put('/einvoice/settings', einvoiceSettingsPut as never);
  a.get('/einvoice/outbox', einvoiceOutboxList as never);
  a.get('/einvoice/outbox/:id', einvoiceOutboxGet as never);
  a.post('/einvoice/outbox/refresh', einvoiceRefresh as never);
  return a;
}
const put = (a: Hono, body: unknown) => a.request('/einvoice/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('e-invoice routes', () => {
  it('reads the settings with what the seller still lacks', async () => {
    const res = await app(world().sb).request('/einvoice/settings');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ active: false, classificationCode: '022', taxType: '06' });
    expect(body.sellerMissing).toContain('seller TIN');
    expect(body.taxTypes).toMatchObject({ '06': 'Not applicable' });
  });

  it('saving needs the post key', async () => {
    const res = await put(app(world().sb, []), { ...EINVOICE_DEFAULTS });
    expect(res.status).toBe(403);
  });

  it('PUT refuses SST on with the settings message', async () => {
    const res = await put(app(world().sb), { ...EINVOICE_DEFAULTS, sstEnabled: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_setting', field: 'sstEnabled', message: 'SST postings are not built yet. Leave SST off until they are.' });
  });

  it('PUT saves and answers the saved settings', async () => {
    const { sb, tables } = world({ acc_einvoice_outbox: [] });
    const res = await put(app(sb), { ...EINVOICE_DEFAULTS, seller: SELLER, active: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ active: true, seller: { tin: 'C12345678901' }, sellerMissing: [] });
    expect(tables.acc_company_settings[0]).toMatchObject({ einvoice_active: true, seller_msic: '43301', updated_by: 'Chew' });
  });

  it('PUT refuses a body that is not settings', async () => {
    const res = await put(app(world().sb), { active: 'yes' });
    expect(res.status).toBe(400);
  });

  it('outbox lists counts by status, this company only', async () => {
    const res = await app(world().sb).request('/einvoice/outbox');
    const body = await res.json() as { rows: Array<Record<string, unknown>>; counts: Record<string, number> };
    expect(body.counts).toEqual({ NOT_READY: 1, READY: 0, SUBMITTED: 0, VALID: 0, REJECTED: 0, CANCELLED: 1 });
    expect(body.rows.map((r) => r.docNumber)).toEqual(['CN-1', 'SI-1']);
    expect(body.rows[1]).toEqual({
      id: 'o1', docKind: 'INVOICE', docNumber: 'SI-1', debtorCode: '301-M002', debtorName: 'MS LEE', date: '2026-11-03', amountSen: 1_500_000,
      status: 'NOT_READY', missing: ['buyer ID number'],
    });
  });

  it('outbox filters by status', async () => {
    const res = await app(world().sb).request('/einvoice/outbox?status=NOT_READY');
    const body = await res.json() as { rows: Array<{ docNumber: string }> };
    expect(body.rows.map((r) => r.docNumber)).toEqual(['SI-1']);
  });

  it('one row comes with its payload; another company\'s is not found', async () => {
    const a = app(world().sb);
    const res = await a.request('/einvoice/outbox/o1');
    expect(await res.json()).toMatchObject({ id: 'o1', payload: { id: 'SI-1' } });
    expect((await a.request('/einvoice/outbox/o3')).status).toBe(404);
  });

  it('refresh re-prepares NOT_READY rows', async () => {
    const { sb } = world({
      acc_einvoice_outbox: [],
    });
    const res = await app(sb).request('/einvoice/outbox/refresh', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refreshed: 0 });
    expect((await app(sb, []).request('/einvoice/outbox/refresh', { method: 'POST' })).status).toBe(403);
  });
});
