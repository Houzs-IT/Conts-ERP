/* The Reno review of a Direct pay request. Pinned:
     · a request with a line on a Reno-review sub-department waits as RENO_REVIEW; any other is SUBMITTED;
     · a Claim to Me is never reviewed;
     · the reviewer sends the request on to finance or sends it back with a reason;
     · only the forwarded mount carries the review routes. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { fakeSb, publicTablesOnly } from '../scm/lib/fake-postgrest';
import { myClaimsRouter } from './my-claims-routes';
import type { Staff } from './staff-identity';
/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they test */

const CO = 1;
const ASKER: Staff = { userId: 'u-ops', name: 'Wei Wen', email: 'o@x', departmentId: 'ops', side: 'both', role: 'operations_staff', field: false };
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
  staff_receipts: [], staff_receipt_lines: [], staff_receipt_files: [], staff_receipt_recoveries: [], conts_staff: [{ id: 'u-ops', full_name: 'Wei Wen' }],
  payment_requests: [], payment_request_lines: [], payment_request_files: [], payment_vouchers: [], payment_voucher_lines: [],
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
const get = (a: Hono<any>, path: string) => a.request(path, {}, env);
const directPay = (a: Hono<any>, subDepartmentId: string, over: Record<string, unknown> = {}) =>
  post(a, '/requests', { type: 'PAYMENT', payeeName: 'KEDAI PAIP', amountSen: 4500, files: [PNG], lines: [{ amountSen: 4500, subDepartmentId }], ...over });
const inReview = async () => {
  const sb = world();
  const { id } = await (await directPay(appFor(sb, ASKER), 's-dc')).json() as { id: string };
  return { sb, id };
};

describe('which requests wait for Reno review', () => {
  test('a request with a flagged sub-department lands RENO_REVIEW', async () => {
    const sb = world();
    const res = await directPay(appFor(sb, ASKER), 's-tc');
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ renoReview: true });
    expect(sb.tables.payment_requests[0]).toMatchObject({ status: 'RENO_REVIEW' });
  });
  test('a request with no flagged sub-department lands SUBMITTED', async () => {
    const sb = world();
    expect(await (await directPay(appFor(sb, ASKER), 's-co')).json()).toMatchObject({ renoReview: false });
    expect(sb.tables.payment_requests[0]).toMatchObject({ status: 'SUBMITTED' });
  });
  test('a Claim to Me on a flagged sub-department is HANDED_IN, with no review', async () => {
    const sb = world();
    const res = await post(appFor(sb, ASKER), '/receipts', {
      spendDate: '2026-10-03', amountSen: 4500, files: [PNG], payBack: 'finance', bank: BANK, lines: [{ amountSen: 4500, subDepartmentId: 's-dc' }],
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: expect.any(String), receiptNo: expect.any(String), route: 'finance' });
    expect(sb.tables.staff_receipts[0]).toMatchObject({ status: 'HANDED_IN', float_id: null });
  });
  test('a withdrawn request is changed and sent again, and waits for review once more', async () => {
    const { sb, id } = await inReview();
    expect((await post(appFor(sb, ASKER), `/requests/${id}/withdraw`, {})).status).toBe(200);
    expect(sb.tables.payment_requests[0].status).toBe('WITHDRAWN');
    const res = await post(appFor(sb, ASKER), `/requests/${id}/resubmit`, { type: 'PAYMENT', payeeName: 'KEDAI PAIP', amountSen: 4500, keepFileIds: [sb.tables.payment_request_files[0].id], lines: [{ amountSen: 4500, subDepartmentId: 's-tc' }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ renoReview: true });
    expect(sb.tables.payment_requests[0].status).toBe('RENO_REVIEW');
  });
});

describe('the review', () => {
  test('lists the requests in review, with their lines and files', async () => {
    const { sb } = await inReview();
    sb.tables.payment_requests.push({ ...sb.tables.payment_requests[0], id: 'other', request_no: 'PRQ-X', status: 'SUBMITTED' });
    const list = await (await get(appFor(sb, REVIEWER), '/reno-review')).json() as any;
    expect(list.requests).toHaveLength(1);
    expect(list.requests[0]).toMatchObject({
      status: 'RENO_REVIEW', requesterName: 'Wei Wen', renoReviewedBy: null, renoReviewedAt: null,
      lines: [expect.objectContaining({ subDepartmentId: 's-dc' })], files: [expect.objectContaining({ fileName: 'r.png' })],
    });
  });
  test('a file opens only while its request is in review', async () => {
    const { sb, id } = await inReview();
    const fileId = sb.tables.payment_request_files[0].id;
    expect((await get(appFor(sb, REVIEWER), `/reno-review/${id}/files/${fileId}`)).status).toBe(200);
    sb.tables.payment_requests[0].status = 'SUBMITTED';
    expect((await get(appFor(sb, REVIEWER), `/reno-review/${id}/files/${fileId}`)).status).toBe(404);
  });
  test('send moves it to SUBMITTED and records the reviewer', async () => {
    const { sb, id } = await inReview();
    const res = await post(appFor(sb, REVIEWER), `/reno-review/${id}/send`, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, requestNo: sb.tables.payment_requests[0].request_no });
    expect(sb.tables.payment_requests[0]).toMatchObject({ status: 'SUBMITTED', reno_reviewed_by: 'Mei Ling' });
    expect(sb.tables.payment_requests[0].reno_reviewed_at).toBeTruthy();
  });
  test('send with an edited form saves the changes and moves it to SUBMITTED', async () => {
    const { sb, id } = await inReview();
    const res = await post(appFor(sb, REVIEWER), `/reno-review/${id}/send`, {
      type: 'PAYMENT', payeeName: 'KEDAI BARU', amountSen: 7000, keepFileIds: [sb.tables.payment_request_files[0].id], lines: [{ amountSen: 7000, subDepartmentId: 's-tc' }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, edited: true });
    expect(sb.tables.payment_requests[0]).toMatchObject({ status: 'SUBMITTED', payee_name: 'KEDAI BARU', amount_sen: 7000, requester_user_id: 'u-ops', reno_reviewed_by: 'Mei Ling' });
    expect(sb.tables.payment_request_lines).toHaveLength(1);
    expect(sb.tables.payment_request_lines[0]).toMatchObject({ amount_sen: 7000, sub_department_id: 's-tc' });
    expect(sb.tables.payment_request_files).toHaveLength(1);
  });
  test('send with an empty body still sends it as it is', async () => {
    const { sb, id } = await inReview();
    expect(await (await post(appFor(sb, REVIEWER), `/reno-review/${id}/send`, {})).json()).toMatchObject({ id, edited: false });
    expect(sb.tables.payment_requests[0]).toMatchObject({ status: 'SUBMITTED', amount_sen: 4500, payee_name: 'KEDAI PAIP' });
  });
  test('an edited send on a request no longer in review is refused and writes nothing', async () => {
    const { sb, id } = await inReview();
    sb.tables.payment_requests[0].status = 'SUBMITTED';
    const res = await post(appFor(sb, REVIEWER), `/reno-review/${id}/send`, { type: 'PAYMENT', payeeName: 'KEDAI BARU', amountSen: 7000, keepFileIds: [sb.tables.payment_request_files[0].id], lines: [{ amountSen: 7000, subDepartmentId: 's-tc' }] });
    expect(res.status).toBe(409);
    expect(sb.tables.payment_requests[0]).toMatchObject({ amount_sen: 4500, payee_name: 'KEDAI PAIP' });
    expect(sb.tables.payment_request_lines[0].amount_sen).toBe(4500);
  });
  test('an edited send with no file kept and none added is refused', async () => {
    const { sb, id } = await inReview();
    const res = await post(appFor(sb, REVIEWER), `/reno-review/${id}/send`, { type: 'PAYMENT', payeeName: 'KEDAI BARU', amountSen: 7000, lines: [{ amountSen: 7000, subDepartmentId: 's-tc' }] });
    expect(res.status).toBe(422);
    expect(sb.tables.payment_requests[0].status).toBe('RENO_REVIEW');
    expect(sb.tables.payment_request_files).toHaveLength(1);
  });
  test('a request no longer in review cannot be sent or rejected again', async () => {
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
    expect(sb.tables.payment_requests[0].status).toBe('RENO_REVIEW');
    expect((await post(a, `/reno-review/${id}/reject`, { reason: ' Wrong project ' })).status).toBe(200);
    expect(sb.tables.payment_requests[0]).toMatchObject({ status: 'REJECTED', reason: 'Wrong project', decided_by: 'Mei Ling' });
  });
  test('the asker can withdraw a request while it waits for review', async () => {
    const { sb, id } = await inReview();
    expect((await post(appFor(sb, ASKER), `/requests/${id}/withdraw`, {})).status).toBe(200);
    expect(sb.tables.payment_requests[0].status).toBe('WITHDRAWN');
  });
});

describe('the engine session mount', () => {
  test('carries no review routes', async () => {
    const { sb, id } = await inReview();
    const a = appFor(sb, REVIEWER, 'session');
    expect((await get(a, '/reno-review')).status).toBe(404);
    expect((await post(a, `/reno-review/${id}/send`, {})).status).toBe(404);
    expect((await post(a, `/reno-review/${id}/reject`, { reason: 'No' })).status).toBe(404);
  });
});
