import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { fakeSb, publicTablesOnly } from '../scm/lib/fake-postgrest';
import { signStaffAssertion, verifyStaffAssertion, staffByEmail, staffFromAssertion, staffFromSession } from './staff-identity';
/* eslint-disable @typescript-eslint/no-explicit-any -- Hono context and PostgREST client, untyped as in the routes they sit beside */

const SECRET = 'x'.repeat(40);
const STAFF = [
  { id: 'u-tech', full_name: 'Ah Keong', email: 'u-tech@no-email.invalid', department_id: 'maint', department_side: 'conts', role: 'technician', active: true },
  { id: 'u-ops', full_name: 'Wei Wen', email: 'WeiWen@theconts.com', department_id: 'ops', department_side: 'both', role: 'operations_staff', active: true },
  { id: 'u-gone', full_name: 'Gone', email: 'gone@theconts.com', department_id: 'ops', department_side: 'both', role: 'operations_staff', active: false },
];
const sbOf = () => publicTablesOnly(fakeSb({ conts_staff: STAFF }), ['conts_staff']);

describe('the staff assertion', () => {
  test('round-trips', async () => {
    const t = await signStaffAssertion(SECRET, { userId: 'u-tech', email: 'u-tech@no-email.invalid', exp: Date.now() + 30_000 });
    expect(await verifyStaffAssertion(SECRET, t)).toEqual({ userId: 'u-tech', email: 'u-tech@no-email.invalid' });
  });
  test('refuses an expired one, a wrong secret, and one too far ahead', async () => {
    const old = await signStaffAssertion(SECRET, { userId: 'a', email: 'a@x', exp: Date.now() - 1 });
    expect(await verifyStaffAssertion(SECRET, old)).toBeNull();
    const other = await signStaffAssertion('y'.repeat(40), { userId: 'a', email: 'a@x', exp: Date.now() + 30_000 });
    expect(await verifyStaffAssertion(SECRET, other)).toBeNull();
    const far = await signStaffAssertion(SECRET, { userId: 'a', email: 'a@x', exp: Date.now() + 10 * 60_000 });
    expect(await verifyStaffAssertion(SECRET, far)).toBeNull();
    expect(await verifyStaffAssertion(SECRET, 'garbage')).toBeNull();
  });
});

describe('staffByEmail', () => {
  test('finds a person whatever the case of the email; an inactive one is nobody', async () => {
    expect(await staffByEmail(sbOf(), 'weiwen@theconts.com')).toMatchObject({ userId: 'u-ops', side: 'both', field: false });
    expect(await staffByEmail(sbOf(), 'u-tech@no-email.invalid')).toMatchObject({ userId: 'u-tech', field: true });
    expect(await staffByEmail(sbOf(), 'gone@theconts.com')).toBeNull();
    expect(await staffByEmail(sbOf(), 'nobody@x.com')).toBeNull();
  });
});

const appWith = (mw: Parameters<Hono['use']>[1], user?: { email: string }) => {
  const a = new Hono();
  const sb = sbOf();
  a.use('*', async (c, next) => { (c as any).set('supabase', sb); if (user) (c as any).set('user', user); await next(); });
  a.use('*', mw);
  a.get('/me', c => c.json((c as any).get('staff')));
  return a;
};
const env = { CONTS_SSO_SECRET: SECRET };

describe('staffFromAssertion', () => {
  test('a signed header names the person', async () => {
    const t = await signStaffAssertion(SECRET, { userId: 'u-tech', email: 'u-tech@no-email.invalid', exp: Date.now() + 30_000 });
    const res = await appWith(staffFromAssertion).request('/me', { headers: { 'x-conts-staff': t } }, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { userId: string }).userId).toBe('u-tech');
  });
  test('no header, a bad one, or an id that is not the email\'s person: 401', async () => {
    const a = appWith(staffFromAssertion);
    expect((await a.request('/me', {}, env)).status).toBe(401);
    expect((await a.request('/me', { headers: { 'x-conts-staff': 'bad' } }, env)).status).toBe(401);
    const lie = await signStaffAssertion(SECRET, { userId: 'u-ops', email: 'u-tech@no-email.invalid', exp: Date.now() + 30_000 });
    expect((await a.request('/me', { headers: { 'x-conts-staff': lie } }, env)).status).toBe(401);
    const gone = await signStaffAssertion(SECRET, { userId: 'u-gone', email: 'gone@theconts.com', exp: Date.now() + 30_000 });
    expect((await a.request('/me', { headers: { 'x-conts-staff': gone } }, env)).status).toBe(401);
  });
  test('no secret configured: 503', async () => {
    expect((await appWith(staffFromAssertion).request('/me', { headers: { 'x-conts-staff': 'x.y' } }, {})).status).toBe(503);
  });
});

describe('staffFromSession', () => {
  test('the signed-in engine user, by email', async () => {
    const res = await appWith(staffFromSession, { email: 'weiwen@theconts.com' }).request('/me', {}, env);
    expect(((await res.json()) as { userId: string }).userId).toBe('u-ops');
  });
  test('an engine user who is not Conts staff: 401', async () => {
    expect((await appWith(staffFromSession, { email: 'houzs@x.com' }).request('/me', {}, env)).status).toBe(401);
  });
});
