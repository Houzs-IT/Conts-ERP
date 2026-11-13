/* Scanned utility bills (plan docs/superpowers/plans/2026-11-02-utility-bill-scan.md Tasks 1-2). Pinned:
     · a page is read for office staff only, and says so when reading is not set up;
     · one payment request per provider per scan: one Rental line per bill with its unit, no account, total = the bills;
       the provider's supplier when one is on the list, else the payee to check; the same scan twice is one request. */
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { asCopies, fakeSb, publicTablesOnly } from '../scm/lib/fake-postgrest';
import { myClaimsRouter } from './my-claims-routes';
import type { Staff } from './staff-identity';
/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they test */

const CO = 1;
const FIN: Staff = { userId: 'u-fin', name: 'Mei', email: 'f@x', departmentId: 'fin', side: 'both', role: 'finance', field: false };
const TECH: Staff = { userId: 'u-tech', name: 'Ah Wai', email: 't@x', departmentId: 'maint', side: 'conts', role: 'technician', field: true };
const PNG = { name: 'p.png', mime: 'image/png', dataBase64: btoa('png-bytes') };

const world = () => publicTablesOnly(fakeSb({
  payment_requests: [], payment_request_lines: [], payment_request_files: [],
  suppliers: [{ id: 'S-IWK', company_id: CO, code: '400-I001', name: 'INDAH WATER KONSORTIUM SDN BHD' }, { id: 'S-X', company_id: 2, code: '400-T001', name: 'TNB' }],
  conts_units: [{ id: 'U1', building: 'Skyline', unit_number: 'C15-13' }, { id: 'U2', building: 'Agile', unit_number: 'C37-13A' }],
}), ['conts_units']);

const bucket = () => { const m = new Map<string, ArrayBuffer>(); return { m, put: async (k: string, v: ArrayBuffer) => { m.set(k, v); }, get: async (k: string) => (m.has(k) ? { body: m.get(k) } : null) }; };
const appFor = (sb: ReturnType<typeof world>, staff: Staff) => {
  const a = new Hono<{ Variables: Record<string, unknown> }>();
  a.use('*', async (c, next) => { c.set('supabase', sb); c.set('companyId', CO); c.set('staff', staff); await next(); });
  a.route('/', myClaimsRouter('forward'));
  return a;
};
const post = (a: Hono<any>, path: string, body: unknown, env: Record<string, unknown> = { SLIPS: bucket() }) =>
  a.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }, env);

const BILLS = [
  { unitId: 'U1', kind: 'electricity', billMonth: '2026-10', accountNo: '2104010945XX02', amountSen: 13_118 },
  { unitId: 'U2', kind: 'electricity', billMonth: '2026-10', accountNo: '2200118899XX11', amountSen: 4_510 },
];
const ask = (a: Hono<any>, over: Record<string, unknown> = {}) => post(a, '/utility-bills/payment-request', { provider: 'TNB', scanBatchId: 'B1', bills: BILLS, ...over });

describe('reading a page', () => {
  test('field staff are refused; without a key it says reading is not set up', async () => {
    const sb = world();
    expect((await post(appFor(sb, TECH), '/utility-bills/read', { file: PNG }, { SLIPS: bucket(), ANTHROPIC_API_KEY: 'k' })).status).toBe(403);
    const r = await post(appFor(sb, FIN), '/utility-bills/read', { file: PNG });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ error: 'SCAN_NOT_SET_UP' });
  });
  test('a file that is not a photo or a PDF is refused before any call', async () => {
    const r = await post(appFor(world(), FIN), '/utility-bills/read', { file: { name: 'a.txt', mime: 'text/plain', dataBase64: btoa('x') } }, { ANTHROPIC_API_KEY: 'k' });
    expect(r.status).toBe(400);
  });
});

describe('a payment request for a provider', () => {
  test('one request, one Rental line per bill with its unit, no account, total = the bills', async () => {
    const sb = world();
    const r = await ask(appFor(sb, FIN));
    expect(r.status, await r.clone().text()).toBe(201);
    expect(await r.json()).toMatchObject({ amountSen: 17_628 });
    expect(sb.tables.payment_requests).toHaveLength(1);
    expect(sb.tables.payment_requests[0]).toMatchObject({ type: 'PAYMENT', amount_sen: 17_628, payee_name: 'TNB', payee_to_check: true, supplier_id: null, requester_user_id: 'u-fin', source_key: 'utility:B1:TNB', status: 'SUBMITTED' });
    expect(sb.tables.payment_request_lines.map(l => [l.department, l.unit_id, l.account_code, l.amount_sen, l.description])).toEqual([
      ['rental', 'U1', null, 13_118, 'Electricity 2026-10 2104010945XX02'],
      ['rental', 'U2', null, 4_510, 'Electricity 2026-10 2200118899XX11'],
    ]);
  });
  test("the provider's supplier when one is on the list (this company's only)", async () => {
    const sb = world();
    expect((await ask(appFor(sb, FIN), { provider: 'Indah Water', bills: [{ ...BILLS[0], kind: 'sewerage' }] })).status).toBe(201);
    expect(sb.tables.payment_requests[0]).toMatchObject({ supplier_id: 'S-IWK', payee_name: 'INDAH WATER KONSORTIUM SDN BHD', payee_to_check: false });
  });
  test('the same scan and provider twice is one request; files are optional and kept when sent', async () => {
    const sb = world();
    const a = appFor(sb, FIN);
    const first = await (await ask(a, { files: [PNG] })).json() as { requestNo: string };
    const again = await ask(a);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ requestNo: first.requestNo });
    expect(sb.tables.payment_requests).toHaveLength(1);
    expect(sb.tables.payment_request_files).toHaveLength(1);
  });
  test('refused: field staff, no bills, a bill with no unit or amount, a unit that does not exist', async () => {
    const sb = world();
    expect((await ask(appFor(sb, TECH))).status).toBe(403);
    expect((await ask(appFor(sb, FIN), { bills: [] })).status).toBe(422);
    expect((await ask(appFor(sb, FIN), { bills: [{ ...BILLS[0], unitId: '' }] })).status).toBe(422);
    expect((await ask(appFor(sb, FIN), { bills: [{ ...BILLS[0], amountSen: 0 }] })).status).toBe(422);
    expect((await ask(appFor(sb, FIN), { bills: [{ ...BILLS[0], unitId: 'NOPE' }] })).status).toBe(422);
    expect((await ask(appFor(sb, FIN), { scanBatchId: '' })).status).toBe(422);
    expect(sb.tables.payment_requests).toHaveLength(0);
  });
});

describe('a withdrawn or rejected utility request is sent again with its bills as they are now (chew, 13 Nov 2026)', () => {
  const again = (a: Hono<any>, id: string, bills: unknown) => post(a, `/utility-bills/payment-request/${id}/resubmit`, { bills });
  const sent = async (sb: ReturnType<typeof world>) => (await (await ask(appFor(sb, FIN))).json()) as { id: string; requestNo: string };

  test('the same request and number, a line per bill as it is now, the new total, back with finance; a rejection reason stays', async () => {
    const sb = world();
    const first = await sent(sb);
    Object.assign(sb.tables.payment_requests[0], { status: 'REJECTED', reason: 'C37-13A is 45.10, not 4.51', decided_by: 'Chew' });
    const fixed = [BILLS[0], { ...BILLS[1], amountSen: 45_100 }];
    const r = await again(appFor(sb, FIN), first.id, fixed);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: first.id, requestNo: first.requestNo, amountSen: 13_118 + 45_100 });
    expect(sb.tables.payment_requests).toHaveLength(1);
    expect(sb.tables.payment_requests[0]).toMatchObject({ status: 'SUBMITTED', amount_sen: 58_218, reason: 'C37-13A is 45.10, not 4.51', decided_by: 'Chew' });
    expect(sb.tables.payment_request_lines.map((l: any) => [l.unit_id, l.amount_sen, l.department])).toEqual([['U1', 13_118, 'rental'], ['U2', 45_100, 'rental']]);
  });

  test('a bill taken off (owner paid, deleted) leaves its line; withdrawn by the person who sent it works the same', async () => {
    const sb = world();
    const first = await sent(sb);
    sb.tables.payment_requests[0].status = 'WITHDRAWN';
    expect((await again(appFor(sb, FIN), first.id, [BILLS[0]])).status).toBe(200);
    expect(sb.tables.payment_request_lines.map((l: any) => l.unit_id)).toEqual(['U1']);
    expect(sb.tables.payment_requests[0]).toMatchObject({ status: 'SUBMITTED', amount_sen: 13_118 });
  });

  test('two people press Send again at once: one goes, the other is told; one set of lines (review, 13 Nov 2026)', async () => {
    const sb = world();
    const first = await sent(sb);
    Object.assign(sb.tables.payment_requests[0], { status: 'REJECTED', updated_at: '2026-11-13T01:00:00.000Z' });
    const OPS: Staff = { userId: 'u-ops', name: 'Wei Wen', email: 'o@x', departmentId: 'ops', side: 'both', role: 'operations_staff', field: false };
    const copyApp = (staff: Staff) => { const a = new Hono<{ Variables: Record<string, unknown> }>(); a.use('*', async (c, next) => { c.set('supabase', asCopies(sb)); c.set('companyId', CO); c.set('staff', staff); await next(); }); a.route('/', myClaimsRouter('forward')); return a; };
    const fixed = [BILLS[0], { ...BILLS[1], amountSen: 45_100 }];
    const [ra, rb] = await Promise.all([again(copyApp(FIN), first.id, fixed), again(copyApp(OPS), first.id, fixed)]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    expect(sb.tables.payment_request_lines).toHaveLength(2);
    expect(sb.tables.payment_requests[0]).toMatchObject({ status: 'SUBMITTED', amount_sen: 58_218 });
  });

  test('refused: still with finance, not a utility request, field staff, no bills, a unit that does not exist; nothing changes', async () => {
    const sb = world();
    const first = await sent(sb);
    expect((await again(appFor(sb, FIN), first.id, BILLS)).status).toBe(409);
    sb.tables.payment_requests[0].status = 'WITHDRAWN';
    expect((await again(appFor(sb, TECH), first.id, BILLS)).status).toBe(403);
    expect((await again(appFor(sb, FIN), first.id, [])).status).toBe(422);
    expect((await again(appFor(sb, FIN), first.id, [{ ...BILLS[0], unitId: 'NOPE' }])).status).toBe(422);
    sb.tables.payment_requests.push({ id: 'R-OTHER', company_id: CO, request_no: 'PRQ-2611-0002', status: 'WITHDRAWN', source_key: null, amount_sen: 100 });
    expect((await again(appFor(sb, FIN), 'R-OTHER', BILLS)).status).toBe(404);
    expect(sb.tables.payment_requests[0]).toMatchObject({ status: 'WITHDRAWN', amount_sen: 17_628 });
    expect(sb.tables.payment_request_lines).toHaveLength(2);
  });
});
