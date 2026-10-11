import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { isCustomerStatus, invalidCustomer, toCustomerPayload, type CustomerRow } from '../../_lib/customers';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';
import { checkSen, checkPhone, checkEmail, invalid as invalidFields, type Fields } from '../../_lib/validate';

const COLS = `id, code, name, status, contact_person, phone, email, address, area, postcode, state, country,
              payment_terms, credit_limit_sen, currency, tin_number, business_reg_no, customer_type, notes`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const search = (url.searchParams.get('search') ?? '').trim();
  const where: string[] = ['1 = 1']; const args: unknown[] = [];
  if (isCustomerStatus(status)) { where.push('status = ?'); args.push(status); }
  if (search) { where.push('(lower(code) LIKE ? OR lower(name) LIKE ? OR lower(coalesce(contact_person, \'\')) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q, q); }
  const rows = await all<CustomerRow>(env, `SELECT ${COLS} FROM customers WHERE ${where.join(' AND ')} ORDER BY name`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toCustomerPayload) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can add customers.', 403);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const bad = invalidCustomer(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });
  const fields: Fields = {};
  checkPhone(fields, 'phone', b.phone);
  checkEmail(fields, 'email', b.email);
  checkSen(fields, 'creditLimitSen', b.creditLimitSen, { label: 'Credit limit' });
  const badFields = invalidFields(fields); if (badFields) return badFields;
  const code = (b.code as string).trim();
  if (await one(env, 'SELECT 1 AS x FROM customers WHERE lower(code) = lower(?)', code)) return fail('CONFLICT', 'A customer with this code already exists.', 409, { code: 'This code is already used.' });
  const id = genId('cust');
  const now = nowIso();
  await run(env, `INSERT INTO customers (id, code, name, status, contact_person, phone, email, address, area, postcode, state, country,
      payment_terms, credit_limit_sen, currency, tin_number, business_reg_no, customer_type, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, code, (b.name as string).trim(), isCustomerStatus(b.status) ? b.status : 'ACTIVE', strOrNull(b.contactPerson), strOrNull(b.phone), strOrNull(b.email),
    strOrNull(b.address), strOrNull(b.area), strOrNull(b.postcode), strOrNull(b.state), strOrNull(b.country) ?? 'Malaysia',
    strOrNull(b.paymentTerms), intOrNull(b.creditLimitSen) ?? 0, strOrNull(b.currency) ?? 'MYR', strOrNull(b.tinNumber), strOrNull(b.businessRegNo), strOrNull(b.customerType), strOrNull(b.notes), now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'customer.create', entityTable: 'customers', entityId: id, after: { code, name: b.name } });
  return json({ id, code }, 201);
};
