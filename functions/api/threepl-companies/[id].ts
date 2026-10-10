import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { toThreePlPayload, type ThreePlRow } from '../../_lib/threepl-companies';
import { strOrNull, flag } from '../../_lib/scm-util';
import { checkPhone, invalid, type Fields } from '../../_lib/validate';

const COLS = 'id, code, name, registration_no, contact_name, contact_phone, office_phone, email, address, is_active, notes';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const row = await one<ThreePlRow>(env, `SELECT ${COLS} FROM threepl_companies WHERE id = ?`, String(params.id));
  if (!row) return fail('NOT_FOUND', 'That 3PL company does not exist.', 404);
  return json({ data: toThreePlPayload(row) });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit 3PL companies.', 403);
  const id = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM threepl_companies WHERE id = ?', id)) return fail('NOT_FOUND', 'That 3PL company does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const fields: Fields = {};
  checkPhone(fields, 'contactPhone', b.contactPhone, { label: 'Contact phone' });
  checkPhone(fields, 'officePhone', b.officePhone, { label: 'Office phone' });
  const bad = invalid(fields); if (bad) return bad;
  const sets: string[] = []; const args: unknown[] = [];
  const setStr = (col: string, k: string) => { if (b[k] !== undefined) { sets.push(`${col} = ?`); args.push(strOrNull(b[k])); } };
  if (b.name !== undefined) { const n = String(b.name).trim(); if (!n) return fail('VALIDATION', 'Enter a name.', 422, { name: 'Enter a name.' }); sets.push('name = ?'); args.push(n); }
  if (b.code !== undefined) { const c = String(b.code).trim(); if (!c) return fail('VALIDATION', 'Enter a company code.', 422, { code: 'Enter a company code.' }); if (await one(env, 'SELECT 1 AS x FROM threepl_companies WHERE lower(code)=lower(?) AND id<>?', c, id)) return fail('CONFLICT', 'A 3PL company with this code already exists.', 409, { code: 'This code is already used.' }); sets.push('code = ?'); args.push(c); }
  if (b.isActive !== undefined) { sets.push('is_active = ?'); args.push(flag(b.isActive) ?? 1); }
  setStr('registration_no', 'registrationNo'); setStr('contact_name', 'contactName'); setStr('contact_phone', 'contactPhone');
  setStr('office_phone', 'officePhone'); setStr('email', 'email'); setStr('address', 'address'); setStr('notes', 'notes');
  if (!sets.length) return json({ id });
  sets.push('updated_at = ?'); args.push(nowIso()); args.push(id);
  await run(env, `UPDATE threepl_companies SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'threepl_company.update', entityTable: 'threepl_companies', entityId: id, after: b });
  return json({ id });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete 3PL companies.', 403);
  const id = String(params.id);
  const cur = await one<{ code: string }>(env, 'SELECT code FROM threepl_companies WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That 3PL company does not exist.', 404);
  await run(env, 'DELETE FROM threepl_companies WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'threepl_company.delete', entityTable: 'threepl_companies', entityId: id, before: { code: cur.code } });
  return new Response(null, { status: 204 });
};
