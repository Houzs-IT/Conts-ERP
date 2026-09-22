import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { isSupplierStatus, toSupplierPayload, strOrNull, intOrNull, normPhone, type SupplierRow } from '../../_lib/suppliers';

const COLS = `id, code, name, status, contact_person, attention, phone, mobile, whatsapp_number, fax, email, website,
              address, area, postcode, state, country, payment_terms, credit_limit_sen, currency, statement_type,
              aging_basis, supplier_type, category, business_nature, tin_number, business_reg_no, rating, notes`;

/** GET /api/suppliers/:id */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const row = await one<SupplierRow>(env, `SELECT ${COLS} FROM suppliers WHERE id = ?`, String(params.id));
  if (!row) return fail('NOT_FOUND', 'That supplier does not exist.', 404);
  return json({ data: toSupplierPayload(row) });
};

/** PATCH /api/suppliers/:id — only the fields present in the body change. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit suppliers.', 403);

  const id = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM suppliers WHERE id = ?', id)) return fail('NOT_FOUND', 'That supplier does not exist.', 404);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const sets: string[] = [];
  const args: unknown[] = [];
  const put = (col: string, v: unknown) => { sets.push(`${col} = ?`); args.push(v); };
  const setStr = (col: string, k: string) => { if (b[k] !== undefined) put(col, strOrNull(b[k])); };
  const setPhone = (col: string, k: string) => { if (b[k] !== undefined) put(col, normPhone(b[k])); };

  if (b.name !== undefined) { const name = String(b.name).trim(); if (!name) return fail('VALIDATION', 'Enter a name.', 422, { name: 'Enter a name.' }); put('name', name); }
  if (b.code !== undefined) {
    const code = String(b.code).trim();
    if (!code) return fail('VALIDATION', 'Enter a supplier code.', 422, { code: 'Enter a supplier code.' });
    if (await one(env, 'SELECT 1 AS x FROM suppliers WHERE lower(code) = lower(?) AND id <> ?', code, id)) {
      return fail('CONFLICT', 'A supplier with this code already exists.', 409, { code: 'This code is already used.' });
    }
    put('code', code);
  }
  if (b.status !== undefined) { if (!isSupplierStatus(b.status)) return fail('VALIDATION', 'Unknown status.', 422); put('status', b.status); }
  if (b.country !== undefined) put('country', strOrNull(b.country) ?? 'Malaysia');
  if (b.currency !== undefined) put('currency', strOrNull(b.currency) ?? 'MYR');
  if (b.statementType !== undefined) put('statement_type', strOrNull(b.statementType) ?? 'OPEN_ITEM');
  if (b.agingBasis !== undefined) put('aging_basis', strOrNull(b.agingBasis) ?? 'INVOICE_DATE');
  if (b.creditLimitSen !== undefined) put('credit_limit_sen', intOrNull(b.creditLimitSen) ?? 0);
  if (b.rating !== undefined) put('rating', intOrNull(b.rating) ?? 0);
  setStr('contact_person', 'contactPerson'); setStr('attention', 'attention');
  setPhone('phone', 'phone'); setPhone('mobile', 'mobile'); setPhone('whatsapp_number', 'whatsappNumber');
  setStr('fax', 'fax'); setStr('email', 'email'); setStr('website', 'website');
  setStr('address', 'address'); setStr('area', 'area'); setStr('postcode', 'postcode'); setStr('state', 'state');
  setStr('payment_terms', 'paymentTerms'); setStr('supplier_type', 'supplierType'); setStr('category', 'category');
  setStr('business_nature', 'businessNature'); setStr('tin_number', 'tinNumber'); setStr('business_reg_no', 'businessRegNo');
  setStr('notes', 'notes');

  if (!sets.length) return json({ id });
  put('updated_at', nowIso());
  args.push(id);
  await run(env, `UPDATE suppliers SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'supplier.update', entityTable: 'suppliers', entityId: id, after: b });
  return json({ id });
};

/** DELETE /api/suppliers/:id */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete suppliers.', 403);

  const id = String(params.id);
  const cur = await one<{ code: string }>(env, 'SELECT code FROM suppliers WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That supplier does not exist.', 404);
  await run(env, 'DELETE FROM suppliers WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'supplier.delete', entityTable: 'suppliers', entityId: id, before: { code: cur.code } });
  return new Response(null, { status: 204 });
};
