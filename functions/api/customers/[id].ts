import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { isCustomerStatus, toCustomerPayload, type CustomerRow } from '../../_lib/customers';
import { strOrNull, intOrNull } from '../../_lib/scm-util';
import { checkSen, checkPhone, checkEmail, invalid, type Fields } from '../../_lib/validate';

const COLS = `id, code, name, status, contact_person, phone, email, address, area, postcode, state, country,
              payment_terms, credit_limit_sen, currency, tin_number, business_reg_no, customer_type, notes`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const row = await one<CustomerRow>(env, `SELECT ${COLS} FROM customers WHERE id = ?`, String(params.id));
  if (!row) return fail('NOT_FOUND', 'That customer does not exist.', 404);
  return json({ data: toCustomerPayload(row) });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit customers.', 403);
  const id = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM customers WHERE id = ?', id)) return fail('NOT_FOUND', 'That customer does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const fields: Fields = {};
  checkPhone(fields, 'phone', b.phone);
  checkEmail(fields, 'email', b.email);
  checkSen(fields, 'creditLimitSen', b.creditLimitSen, { label: 'Credit limit' });
  const bad = invalid(fields); if (bad) return bad;
  const sets: string[] = []; const args: unknown[] = [];
  const setStr = (col: string, k: string) => { if (b[k] !== undefined) { sets.push(`${col} = ?`); args.push(strOrNull(b[k])); } };
  if (b.name !== undefined) { const n = String(b.name).trim(); if (!n) return fail('VALIDATION', 'Enter a name.', 422, { name: 'Enter a name.' }); sets.push('name = ?'); args.push(n); }
  if (b.code !== undefined) { const c = String(b.code).trim(); if (!c) return fail('VALIDATION', 'Enter a customer code.', 422, { code: 'Enter a customer code.' }); if (await one(env, 'SELECT 1 AS x FROM customers WHERE lower(code)=lower(?) AND id<>?', c, id)) return fail('CONFLICT', 'A customer with this code already exists.', 409, { code: 'This code is already used.' }); sets.push('code = ?'); args.push(c); }
  if (b.status !== undefined) { if (!isCustomerStatus(b.status)) return fail('VALIDATION', 'Unknown status.', 422); sets.push('status = ?'); args.push(b.status); }
  if (b.country !== undefined) { sets.push('country = ?'); args.push(strOrNull(b.country) ?? 'Malaysia'); }
  if (b.currency !== undefined) { sets.push('currency = ?'); args.push(strOrNull(b.currency) ?? 'MYR'); }
  if (b.creditLimitSen !== undefined) { sets.push('credit_limit_sen = ?'); args.push(intOrNull(b.creditLimitSen) ?? 0); }
  setStr('contact_person', 'contactPerson'); setStr('phone', 'phone'); setStr('email', 'email'); setStr('address', 'address');
  setStr('area', 'area'); setStr('postcode', 'postcode'); setStr('state', 'state'); setStr('payment_terms', 'paymentTerms');
  setStr('tin_number', 'tinNumber'); setStr('business_reg_no', 'businessRegNo'); setStr('customer_type', 'customerType'); setStr('notes', 'notes');
  if (!sets.length) return json({ id });
  sets.push('updated_at = ?'); args.push(nowIso()); args.push(id);
  await run(env, `UPDATE customers SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'customer.update', entityTable: 'customers', entityId: id, after: b });
  return json({ id });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete customers.', 403);
  const id = String(params.id);
  const cur = await one<{ code: string }>(env, 'SELECT code FROM customers WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That customer does not exist.', 404);
  await run(env, 'DELETE FROM customers WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'customer.delete', entityTable: 'customers', entityId: id, before: { code: cur.code } });
  return new Response(null, { status: 204 });
};
