/* Extra limit for a project (Conts, finance phase 1.5; SOP 3.4). Pinned:
     · a request needs a reason; a customer project asks for an amount or a percentage, an internal one for budget;
     · the person who asked cannot approve it; someone with the key can;
     · an approved percentage becomes the project's own share; a decided request cannot be decided again. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly } from '../scm/lib/fake-postgrest';
import { approveLimitRequestHandler, createLimitRequestHandler, rejectLimitRequestHandler } from './project-limit-routes';

const CO = 1;
const world = () => publicTablesOnly(fakeSb({
  projects: [{ id: 7, company_id: CO, name: 'SKYLINE', funding: 'customer', limit_pct_bp: null, budget_sen: null }, { id: 8, company_id: CO, name: 'SHOWROOM', funding: 'internal', budget_sen: 100 }],
  acc_company_settings: [{ company_id: CO, project_limit_pct_bp: 7000 }],
  mfg_sales_orders: [], mfg_sales_order_payments: [], sales_invoices: [], sales_invoice_payments: [], payment_voucher_lines: [], payment_vouchers: [], accounts: [],
  project_limit_requests: [],
}), ['projects', 'project_brands']);
const app = (sb: ReturnType<typeof world>, name: string, perms: string[]) => {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('supabase' as never, sb as never);
    c.set('companyId' as never, CO as never);
    c.set('houzsUser' as never, { name, permissions_set: new Set(perms) } as never);
    await next();
  });
  a.post('/projects/:id/limit-requests', createLimitRequestHandler as never);
  a.post('/limit-requests/:id/approve', approveLimitRequestHandler as never);
  a.post('/limit-requests/:id/reject', rejectLimitRequestHandler as never);
  return a;
};
const post = (a: Hono, path: string, body: unknown = {}) => a.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('extra limit', () => {
  test('a request needs a reason, and the kind that fits the project', async () => {
    const sb = world();
    const asker = app(sb, 'Alvin', ['scm.payment_voucher.create']);
    expect((await post(asker, '/projects/7/limit-requests', { kind: 'amount', amountSen: 50_000, reason: '' })).status).toBe(400);
    expect((await post(asker, '/projects/7/limit-requests', { kind: 'budget', amountSen: 50_000, reason: 'x' })).status).toBe(400);
    expect((await post(asker, '/projects/8/limit-requests', { kind: 'budget', amountSen: 50_000, reason: 'More tiles' })).status).toBe(201);
  });

  test('the asker cannot approve; someone else with the key can; an approved percentage is the project’s own', async () => {
    const sb = world();
    const asker = app(sb, 'Alvin', ['scm.payment_voucher.create', 'scm.project_limit.approve']);
    const made = await (await post(asker, '/projects/7/limit-requests', { kind: 'pct', pctBp: 8500, reason: 'Big order up front' })).json() as { request: { id: string } };
    expect((await post(asker, `/limit-requests/${made.request.id}/approve`)).status).toBe(409);
    const boss = app(sb, 'Chew', ['scm.project_limit.approve']);
    expect((await post(boss, `/limit-requests/${made.request.id}/approve`)).status).toBe(200);
    expect(sb.tables.projects[0].limit_pct_bp).toBe(8500);
    expect((await post(boss, `/limit-requests/${made.request.id}/reject`)).status).toBe(409);
  });

  test('without the key a request is not decided', async () => {
    const sb = world();
    const asker = app(sb, 'Alvin', ['scm.payment_voucher.create']);
    const made = await (await post(asker, '/projects/7/limit-requests', { kind: 'amount', amountSen: 1000, reason: 'x' })).json() as { request: { id: string } };
    expect((await post(app(sb, 'Bob', []), `/limit-requests/${made.request.id}/approve`)).status).toBe(403);
  });
});
