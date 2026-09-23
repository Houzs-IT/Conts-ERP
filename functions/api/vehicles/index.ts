import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { invalidVehicle, toVehiclePayload, type VehicleRow } from '../../_lib/transport';
import { strOrNull, intOrNull, flag, genId } from '../../_lib/scm-util';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const rows = await all<VehicleRow>(env, 'SELECT id, code, plate, vehicle_type, capacity_m3_milli, active, notes FROM vehicles ORDER BY code');
  return json({ generatedAt: nowIso(), data: rows.map(toVehiclePayload) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can add vehicles.', 403);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const bad = invalidVehicle(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });
  const code = (b.code as string).trim();
  if (await one(env, 'SELECT 1 AS x FROM vehicles WHERE lower(code) = lower(?)', code)) return fail('CONFLICT', 'A vehicle with this code already exists.', 409, { code: 'This code is already used.' });
  const id = genId('veh');
  const now = nowIso();
  await run(env, 'INSERT INTO vehicles (id, code, plate, vehicle_type, capacity_m3_milli, active, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, code, strOrNull(b.plate), strOrNull(b.vehicleType), intOrNull(b.capacityM3Milli) ?? 0, flag(b.active) ?? 1, strOrNull(b.notes), now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'vehicle.create', entityTable: 'vehicles', entityId: id, after: { code } });
  return json({ id, code }, 201);
};
