/* A purchase invoice line keyed by account (chew, 18 Nov 2026): stock codes are not complete yet, so a line may name
   the purchase account instead of an item. It is saved with its account; an unknown, header or control account is
   refused, and so is a line with neither an item nor an account. */
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { User } from '@supabase/supabase-js';

import { fakeSb } from '../lib/fake-postgrest';
import type { Env, Variables } from '../env';

const sb = fakeSb({
  purchase_invoices: [], purchase_invoice_items: [],
  suppliers: [{ id: 'sup-1', name: 'S', company_id: 1 }],
  accounts: [
    { company_id: 1, account_code: '601-0000', parent_code: null, is_active: true, special_type: null },
    { company_id: 1, account_code: '601-0010', parent_code: '601-0000', is_active: true, special_type: null },
    { company_id: 1, account_code: '400-0000', parent_code: null, is_active: true, special_type: 'SCC' },
  ],
  grns: [], grn_items: [], purchase_orders: [], mfg_products: [], currencies: [], app_config: [], autocount_outbox: [],
  entity_audit_log: [], inventory_lots: [], inventory_movements: [], inventory_lot_consumptions: [], companies: [{ id: 1, code: 'HOUZS' }],
});
vi.mock('../../db/supabase', () => ({ getSupabaseService: () => sb }));

const CALLER = { id: 7, email: 'buyer@houzs.test', app_metadata: {}, user_metadata: { name: 'Buyer' }, aud: 'authenticated', created_at: '' } as unknown as User;
const { purchaseInvoices } = await import('./purchase-invoices');

async function post(items: Array<Record<string, unknown>>) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => { c.set('user', CALLER); c.set('companyId', 1); c.set('companyCode', 'HOUZS'); await next(); });
  app.route('/', purchaseInvoices);
  return app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ supplierId: 'sup-1', invoiceDate: '2026-11-18', currency: 'MYR', exchangeRate: 1, asDraft: true, items }) });
}
const acctLine = (accountCode: string) => ({ itemCode: '', materialName: 'Tiles for ASTRUM', accountCode, qty: 2, unitPriceSen: 5_000 });

describe('a purchase invoice line keyed by account', () => {
  it('saves the line with its account and no item', async () => {
    const res = await post([acctLine('601-0010')]);
    expect(res.status).toBe(201);
    expect(sb.tables.purchase_invoice_items.at(-1)).toMatchObject({ account_code: '601-0010', line_total_sen: 10_000, material_name: 'Tiles for ASTRUM' });
  });

  it('refuses an unknown account, a header, a control, and a line with neither item nor account', async () => {
    const before = sb.tables.purchase_invoice_items.length;
    expect((await post([acctLine('601-9999')])).status).toBe(400);
    expect((await post([acctLine('601-0000')])).status).toBe(400);
    expect((await post([acctLine('400-0000')])).status).toBe(400);
    expect((await post([{ itemCode: '', materialName: 'x', qty: 1, unitPriceSen: 100 }])).status).toBe(400);
    expect(sb.tables.purchase_invoice_items.length).toBe(before);
  });
});
