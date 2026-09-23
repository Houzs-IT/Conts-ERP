import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { strOrNull, intOrNull, flag } from '../../_lib/scm-util';

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit vehicles.', 403);
  const id = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM vehicles WHERE id = ?', id)) return fail('NOT_FOUND', 'That vehicle does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const sets: string[] = []; const args: unknown[] = [];
  if (b.code !== undefined) { const c = String(b.code).trim(); if (!c) return fail('VALIDATION', 'Enter a vehicle code.', 422, { code: 'Enter a vehicle code.' }); if (await one(env, 'SELECT 1 AS x FROM vehicles WHERE lower(code)=lower(?) AND id<>?', c, id)) return fail('CONFLICT', 'A vehicle with this code already exists.', 409, { code: 'This code is already used.' }); sets.push('code = ?'); args.push(c); }
  if (b.plate !== undefined) { sets.push('plate = ?'); args.push(strOrNull(b.plate)); }
  if (b.vehicleType !== undefined) { sets.push('vehicle_type = ?'); args.push(strOrNull(b.vehicleType)); }
  if (b.capacityM3Milli !== undefined) { sets.push('capacity_m3_milli = ?'); args.push(intOrNull(b.capacityM3Milli) ?? 0); }
  if (b.active !== undefined) { sets.push('active = ?'); args.push(flag(b.active) ?? 1); }
  if (b.notes !== undefined) { sets.push('notes = ?'); args.push(strOrNull(b.notes)); }
  if (!sets.length) return json({ id });
  sets.push('updated_at = ?'); args.push(nowIso()); args.push(id);
  await run(env, `UPDATE vehicles SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'vehicle.update', entityTable: 'vehicles', entityId: id, after: b });
  return json({ id });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete vehicles.', 403);
  const id = String(params.id);
  const cur = await one<{ code: string }>(env, 'SELECT code FROM vehicles WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That vehicle does not exist.', 404);
  await run(env, 'DELETE FROM vehicles WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'vehicle.delete', entityTable: 'vehicles', entityId: id, before: { code: cur.code } });
  return new Response(null, { status: 204 });
};
