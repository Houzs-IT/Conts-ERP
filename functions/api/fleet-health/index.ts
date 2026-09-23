import { type Env, all, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { invalidFleetRecord, isFleetRecordType, toFleetRecordPayload, type FleetRecordRow } from '../../_lib/fleet-maintenance';
import { strOrNull, intOrNull, genId } from '../../_lib/scm-util';

const LIST_SQL = `
  SELECT r.id, r.vehicle_id, r.record_type, r.service_date, r.odometer_km, r.cost_sen, r.next_due_date, r.next_due_km,
         r.status, r.vendor, r.notes, v.code AS vehicle_code, v.plate AS vehicle_plate
  FROM fleet_maintenance_records r JOIN vehicles v ON v.id = r.vehicle_id`;

/** GET /api/fleet-health?vehicleId=&status=&search= */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const vehicleId = url.searchParams.get('vehicleId');
  const status = url.searchParams.get('status');
  const search = (url.searchParams.get('search') ?? '').trim();
  const where: string[] = ['1 = 1']; const args: unknown[] = [];
  if (vehicleId) { where.push('r.vehicle_id = ?'); args.push(vehicleId); }
  if (status === 'SCHEDULED' || status === 'DONE') { where.push('r.status = ?'); args.push(status); }
  if (search) { where.push('(lower(v.code) LIKE ? OR lower(coalesce(v.plate, \'\')) LIKE ? OR lower(coalesce(r.vendor, \'\')) LIKE ?)'); const q = `%${search.toLowerCase()}%`; args.push(q, q, q); }
  const rows = await all<FleetRecordRow>(env, `${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY r.service_date DESC`, ...args);
  return json({ generatedAt: nowIso(), data: rows.map(toFleetRecordPayload) });
};

/** POST /api/fleet-health — log a service / repair / inspection record. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can log fleet maintenance.', 403);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const bad = invalidFleetRecord(b);
  if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });
  const vehicleId = (b.vehicleId as string).trim();
  if (!await one(env, 'SELECT 1 AS x FROM vehicles WHERE id = ?', vehicleId)) return fail('VALIDATION', 'Unknown vehicle.', 422, { vehicleId: 'Unknown vehicle.' });
  const id = genId('fmr');
  const now = nowIso();
  await run(env, `INSERT INTO fleet_maintenance_records (id, vehicle_id, record_type, service_date, odometer_km, cost_sen, next_due_date, next_due_km, status, vendor, notes, created_by, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, vehicleId, isFleetRecordType(b.recordType) ? b.recordType : 'SERVICE', b.serviceDate, intOrNull(b.odometerKm), Math.max(0, intOrNull(b.costSen) ?? 0),
    strOrNull(b.nextDueDate), intOrNull(b.nextDueKm), b.status === 'SCHEDULED' ? 'SCHEDULED' : 'DONE', strOrNull(b.vendor), strOrNull(b.notes), session.userId, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'fleet_maintenance.create', entityTable: 'fleet_maintenance_records', entityId: id, after: { vehicleId, recordType: b.recordType } });
  return json({ id }, 201);
};
