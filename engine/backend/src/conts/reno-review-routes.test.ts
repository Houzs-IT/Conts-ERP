/* The Reno review of a Direct Claim to Me (migration 0378). Pinned:
     · a claim finance pays back with a line on a Reno-review sub-department waits as RENO_REVIEW; any other is HANDED_IN;
     · a claim paid from a float is never reviewed;
     · the reviewer sends it on with the lines and amount they leave, or sends it back with a reason;
     · only the forwarded mount carries the review routes. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly } from '../scm/lib/fake-postgrest';
import { myClaimsRouter } from './my-claims-routes';
import type { Staff } from './staff-identity';
/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they test */

const CO = 1;
const CLAIMANT: Staff = { userId: 'u-ops', name: 'Wei Wen', email: 'o@x', departmentId: 'ops', side: 'both', role: 'operations_staff', field: false };
const REVIEWER: Staff = { userId: 'u-rev', name: 'Mei Ling', email: 'r@x', departmentId: 'reno', side: 'both', role: 'operations_staff', field: false };
const PNG = { name: 'r.png', mime: 'image/png', dataBase64: btoa('png-bytes') };
const BANK = { bankName: 'Maybank', accountNo: '1234567890', accountName: 'WEI WEN' };
const sub = (id: string, department: string, name: string, fixed_key: string | null, reno_review = false) =>
  ({ id, company_id: CO, department, name, fixed_key, staff_department_id: null, active: true, sort: 0, reno_review });

const world = () => publicTablesOnly(fakeSb({
  acc_sub_departments: [
    sub('s-gen', 'rental', 'Rental (general)', 'rental_general'), sub('s-dc', 'supply', 'Renovation (Dream Crafter)', 'dreamcrafter', true),
    sub('s-tc', 'supply', 'In-house Reno (The Conts)', 'theconts', true), sub('s-co', 'shared', 'Company', 'company'),
  ],
  petty_cash_floats: [{ id: 'F1', company_id: CO, department_id: 'ops', keeper_user_id: 'u-keeper', float_sen: 100000, warn_pct: 20, active: true, topup_requested_at: null }],
  petty_cash_overrides: [], petty_cash_events: [],
  staff_receipts: [], staff_receipt_lines: [], staff_receipt_files: [], staff_receipt_recoveries: [], conts_staff: [],
  accounts: [],
}), ['conts_staff']);

const bucket = () => { const m = new Map<string, ArrayBuffer>(); return { put: async (k: string, v: ArrayBuffer) => { m.set(k, v); }, get: async (k: string) => (m.has(k) ? { body: m.get(k) } : null), delete: async (k: string) => { m.delete(k); } }; };
const env = { SLIPS: bucket() };
const appFor = (sb: ReturnType<typeof world>, staff: Staff, source: 'session' | 'forward' = 'forward') => {
  const a = new Hono<{ Variables: Record<string, unknown> }>();
  a.use('*', async (c, next) => { c.set('supabase', sb); c.set('companyId', CO); c.set('staff', staff); await next(); });
  a.route('/', myClaimsRouter(source));
  return a;
};
const post = (a: Hono<any>, path: string, body: unknown) => a.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }, env);
const directClaim = (a: Hono<any>, subDepartmentId: string, over: Record<string, unknown> = {}) =>
  post(a, '/receipts', { spendDate: '2026-10-03', amountSen: 4500, files: [PNG], payBack: 'finance', bank: BANK, lines: [{ amountSen: 4500, subDepartmentId }], ...over });
const inReview = async () => {
  const sb = world();
  const { id } = await (await directClaim(appFor(sb, CLAIMANT), 's-dc')).json() as { id: string };
  return { sb, id };
};

describe('which claims wait for Reno review', () => {
  test('a direct claim with a flagged sub-department lands RENO_REVIEW', async () => {
    const sb = world();
    const res = await directClaim(appFor(sb, CLAIMANT), 's-tc');
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ route: 'finance', renoReview: true });
    expect(sb.tables.staff_receipts[0]).toMatchObject({ status: 'RENO_REVIEW', float_id: null });
  });
  test('a direct claim with no flagged sub-department lands HANDED_IN', async () => {
    const sb = world();
    expect(await (await directClaim(appFor(sb, CLAIMANT), 's-co')).json()).toMatchObject({ renoReview: false });
    expect(sb.tables.staff_receipts[0]).toMatchObject({ status: 'HANDED_IN' });
  });
  test('a claim paid from a float stays HANDED_IN even on a flagged sub-department', async () => {
    const sb = world();
    const res = await directClaim(appFor(sb, CLAIMANT), 's-dc', { payBack: undefined, bank: undefined });
    expect(await res.json()).toMatchObject({ route: 'float', renoReview: false });
    expect(sb.tables.staff_receipts[0]).toMatchObject({ status: 'HANDED_IN', float_id: 'F1' });
  });
});

describe('the review', () => {
  test('lists the claims in review, with their lines', async () => {
    const { sb } = await inReview();
    sb.tables.staff_receipts.push({ ...sb.tables.staff_receipts[0], id: 'other', receipt_no: 'CLM-X', status: 'HANDED_IN' });
    const list = await (await appFor(sb, REVIEWER).request('/reno-review', {}, env)).json() as any;
    expect(list.receipts).toHaveLength(1);
    expect(list.receipts[0]).toMatchObject({ status: 'RENO_REVIEW', lines: [expect.objectContaining({ subDepartmentId: 's-dc' })] });
  });
  test('send moves it to HANDED_IN with the edited lines and amount', async () => {
    const { sb, id } = await inReview();
    const res = await post(appFor(sb, REVIEWER), `/reno-review/${id}/send`, { lines: [{ amountSen: 3000, subDepartmentId: 's-dc' }, { amountSen: 1000, subDepartmentId: 's-dc' }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, amountSen: 4000 });
    expect(sb.tables.staff_receipts[0]).toMatchObject({ status: 'HANDED_IN', amount_sen: 4000, reno_reviewed_by: 'Mei Ling' });
    expect(sb.tables.staff_receipts[0].reno_reviewed_at).toBeTruthy();
    expect(sb.tables.staff_receipt_lines.map((l) => l.amount_sen)).toEqual([3000, 1000]);
  });
  test('send with no lines keeps them and the amount', async () => {
    const { sb, id } = await inReview();
    expect((await post(appFor(sb, REVIEWER), `/reno-review/${id}/send`, {})).status).toBe(200);
    expect(sb.tables.staff_receipts[0]).toMatchObject({ status: 'HANDED_IN', amount_sen: 4500 });
    expect(sb.tables.staff_receipt_lines).toHaveLength(1);
  });
  test('a claim no longer in review cannot be sent or rejected again', async () => {
    const { sb, id } = await inReview();
    await post(appFor(sb, REVIEWER), `/reno-review/${id}/send`, {});
    expect(await (await post(appFor(sb, REVIEWER), `/reno-review/${id}/send`, {})).json()).toMatchObject({ error: 'not_in_review' });
    expect((await post(appFor(sb, REVIEWER), `/reno-review/${id}/reject`, { reason: 'No' })).status).toBe(409);
  });
  test('reject needs a reason, then sends it back REJECTED', async () => {
    const { sb, id } = await inReview();
    const a = appFor(sb, REVIEWER);
    expect((await post(a, `/reno-review/${id}/reject`, { reason: '   ' })).status).toBe(422);
    expect((await post(a, `/reno-review/${id}/reject`, { reason: 'x'.repeat(501) })).status).toBe(422);
    expect(sb.tables.staff_receipts[0].status).toBe('RENO_REVIEW');
    expect((await post(a, `/reno-review/${id}/reject`, { reason: ' Wrong project ' })).status).toBe(200);
    expect(sb.tables.staff_receipts[0]).toMatchObject({ status: 'REJECTED', reject_reason: 'Wrong project', checked_by: 'Mei Ling' });
  });
});

describe('the engine session mount', () => {
  test('carries no review routes', async () => {
    const { sb, id } = await inReview();
    const a = appFor(sb, REVIEWER, 'session');
    expect((await a.request('/reno-review', {}, env)).status).toBe(404);
    expect((await post(a, `/reno-review/${id}/send`, {})).status).toBe(404);
    expect((await post(a, `/reno-review/${id}/reject`, { reason: 'No' })).status).toBe(404);
  });
});
