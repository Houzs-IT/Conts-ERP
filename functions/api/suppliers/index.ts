import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { isSupplierStatus, invalidSupplier, checkSupplierFields, toSupplierPayload, strOrNull, intOrNull, normPhone, type SupplierRow } from '../../_lib/suppliers';
import { invalid, type Fields } from '../../_lib/validate';

const COLS = `id, code, name, status, contact_person, attention, phone, mobile, whatsapp_number, fax, email, website,
              address, area, postcode, state, country, payment_terms, credit_limit_sen, currency, statement_type,
              aging_basis, supplier_type, category, business_nature, tin_number, business_reg_no, rating, notes`;

/** GET /api/suppliers?status=&search=&category= — supplier master, ordered by name. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const search = (url.searchParams.get('search') ?? '').trim();
  const category = (url.searchParams.get('category') ?? '').trim();

  const where: string[] = ['1 = 1'];
  const args: unknown[] = [];
  if (isSupplierStatus(status)) { where.push('status = ?'); args.push(status); }
  if (category) { where.push('lower(coalesce(category, \'\')) LIKE ?'); args.push(`%${category.toLowerCase()}%`); }
  if (search) {
    where.push(`(lower(code) LIKE ? OR lower(name) LIKE ? OR lower(coalesce(contact_person, '')) LIKE ?)`);
    const q = `%${search.toLowerCase()}%`;
    args.push(q, q, q);
  }

  const rows = await all<SupplierRow>(env, `SELECT ${COLS} FROM suppliers WHERE ${where.join(' AND ')} ORDER BY name`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toSupplierPayload) });
};

/** POST /api/suppliers — create a supplier. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can add suppliers.', 403);

  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const bad = invalidSupplier(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });
  const fields: Fields = {};
  checkSupplierFields(fields, b);
  const badField = invalid(fields); if (badField) return badField;

  const code = (b.code as string).trim();
  if (await one(env, 'SELECT 1 AS x FROM suppliers WHERE lower(code) = lower(?)', code)) {
    return fail('CONFLICT', 'A supplier with this code already exists.', 409, { code: 'This code is already used.' });
  }

  const id = `sup-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = nowIso();
  const status = isSupplierStatus(b.status) ? b.status : 'ACTIVE';

  await run(env, `
    INSERT INTO suppliers (id, code, name, status, contact_person, attention, phone, mobile, whatsapp_number, fax,
      email, website, address, area, postcode, state, country, payment_terms, credit_limit_sen, currency,
      statement_type, aging_basis, supplier_type, category, business_nature, tin_number, business_reg_no, rating, notes,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, code, (b.name as string).trim(), status,
    strOrNull(b.contactPerson), strOrNull(b.attention), normPhone(b.phone), normPhone(b.mobile), normPhone(b.whatsappNumber), strOrNull(b.fax),
    strOrNull(b.email), strOrNull(b.website), strOrNull(b.address), strOrNull(b.area), strOrNull(b.postcode), strOrNull(b.state),
    strOrNull(b.country) ?? 'Malaysia', strOrNull(b.paymentTerms), intOrNull(b.creditLimitSen) ?? 0, strOrNull(b.currency) ?? 'MYR',
    strOrNull(b.statementType) ?? 'OPEN_ITEM', strOrNull(b.agingBasis) ?? 'INVOICE_DATE',
    strOrNull(b.supplierType), strOrNull(b.category), strOrNull(b.businessNature), strOrNull(b.tinNumber), strOrNull(b.businessRegNo),
    intOrNull(b.rating) ?? 0, strOrNull(b.notes), now, now);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'supplier.create', entityTable: 'suppliers', entityId: id, after: { code, name: b.name } });
  return json({ id, code }, 201);
};
