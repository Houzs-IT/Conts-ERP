import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { invalidThreePl, toThreePlPayload, type ThreePlRow } from '../../_lib/threepl-companies';
import { strOrNull, flag, genId } from '../../_lib/scm-util';

const COLS = 'id, code, name, registration_no, contact_name, contact_phone, office_phone, email, address, is_active, notes';

/** GET /api/threepl-companies?active=&search= */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const active = url.searchParams.get('active');
  const search = (url.searchParams.get('search') ?? '').trim();
  const where: string[] = ['1 = 1']; const args: unknown[] = [];
  if (active === '1' || active === '0') { where.push('is_active = ?'); args.push(Number(active)); }
  if (search) { where.push('(lower(code) LIKE ? OR lower(name) LIKE ? OR lower(coalesce(contact_name, \'\')) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q, q); }
  const rows = await all<ThreePlRow>(env, `SELECT ${COLS} FROM threepl_companies WHERE ${where.join(' AND ')} ORDER BY name`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toThreePlPayload) });
};

/** POST /api/threepl-companies — create. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can add 3PL companies.', 403);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const bad = invalidThreePl(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });
  const code = (b.code as string).trim();
  if (await one(env, 'SELECT 1 AS x FROM threepl_companies WHERE lower(code) = lower(?)', code)) return fail('CONFLICT', 'A 3PL company with this code already exists.', 409, { code: 'This code is already used.' });
  const id = genId('tpl');
  const now = nowIso();
  await run(env, `INSERT INTO threepl_companies (id, code, name, registration_no, contact_name, contact_phone, office_phone, email, address, is_active, notes, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, code, (b.name as string).trim(), strOrNull(b.registrationNo), strOrNull(b.contactName), strOrNull(b.contactPhone), strOrNull(b.officePhone),
    strOrNull(b.email), strOrNull(b.address), flag(b.isActive) ?? 1, strOrNull(b.notes), now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'threepl_company.create', entityTable: 'threepl_companies', entityId: id, after: { code, name: b.name } });
  return json({ id, code }, 201);
};
