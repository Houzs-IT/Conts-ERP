import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { strOrNull, flag } from '../../_lib/scm-util';

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit drivers.', 403);
  const id = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM drivers WHERE id = ?', id)) return fail('NOT_FOUND', 'That driver does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const sets: string[] = []; const args: unknown[] = [];
  if (b.driverCode !== undefined) { const c = String(b.driverCode).trim(); if (!c) return fail('VALIDATION', 'Enter a driver code.', 422, { driverCode: 'Enter a driver code.' }); if (await one(env, 'SELECT 1 AS x FROM drivers WHERE lower(driver_code)=lower(?) AND id<>?', c, id)) return fail('CONFLICT', 'A driver with this code already exists.', 409, { driverCode: 'This code is already used.' }); sets.push('driver_code = ?'); args.push(c); }
  if (b.name !== undefined) { const n = String(b.name).trim(); if (!n) return fail('VALIDATION', 'Enter a name.', 422, { name: 'Enter a name.' }); sets.push('name = ?'); args.push(n); }
  if (b.phone !== undefined) { sets.push('phone = ?'); args.push(strOrNull(b.phone)); }
  if (b.icNumber !== undefined) { sets.push('ic_number = ?'); args.push(strOrNull(b.icNumber)); }
  if (b.vehicle !== undefined) { sets.push('vehicle = ?'); args.push(strOrNull(b.vehicle)); }
  if (b.active !== undefined) { sets.push('active = ?'); args.push(flag(b.active) ?? 1); }
  if (!sets.length) return json({ id });
  sets.push('updated_at = ?'); args.push(nowIso()); args.push(id);
  await run(env, `UPDATE drivers SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'driver.update', entityTable: 'drivers', entityId: id, after: b });
  return json({ id });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete drivers.', 403);
  const id = String(params.id);
  const cur = await one<{ driver_code: string }>(env, 'SELECT driver_code FROM drivers WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That driver does not exist.', 404);
  await run(env, 'DELETE FROM drivers WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'driver.delete', entityTable: 'drivers', entityId: id, before: { code: cur.driver_code } });
  return new Response(null, { status: 204 });
};
