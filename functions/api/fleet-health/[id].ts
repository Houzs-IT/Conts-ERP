import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { isFleetRecordType } from '../../_lib/fleet-maintenance';
import { strOrNull, intOrNull } from '../../_lib/scm-util';

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit fleet maintenance.', 403);
  const id = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM fleet_maintenance_records WHERE id = ?', id)) return fail('NOT_FOUND', 'That record does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const sets: string[] = []; const args: unknown[] = [];
  if (b.recordType !== undefined && isFleetRecordType(b.recordType)) { sets.push('record_type = ?'); args.push(b.recordType); }
  if (b.serviceDate !== undefined) { sets.push('service_date = ?'); args.push(String(b.serviceDate)); }
  if (b.odometerKm !== undefined) { sets.push('odometer_km = ?'); args.push(intOrNull(b.odometerKm)); }
  if (b.costSen !== undefined) { sets.push('cost_sen = ?'); args.push(Math.max(0, intOrNull(b.costSen) ?? 0)); }
  if (b.nextDueDate !== undefined) { sets.push('next_due_date = ?'); args.push(strOrNull(b.nextDueDate)); }
  if (b.nextDueKm !== undefined) { sets.push('next_due_km = ?'); args.push(intOrNull(b.nextDueKm)); }
  if (b.status !== undefined) { sets.push('status = ?'); args.push(b.status === 'SCHEDULED' ? 'SCHEDULED' : 'DONE'); }
  if (b.vendor !== undefined) { sets.push('vendor = ?'); args.push(strOrNull(b.vendor)); }
  if (b.notes !== undefined) { sets.push('notes = ?'); args.push(strOrNull(b.notes)); }
  if (!sets.length) return json({ id });
  sets.push('updated_at = ?'); args.push(nowIso()); args.push(id);
  await run(env, `UPDATE fleet_maintenance_records SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'fleet_maintenance.update', entityTable: 'fleet_maintenance_records', entityId: id, after: b });
  return json({ id });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete fleet maintenance.', 403);
  const id = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM fleet_maintenance_records WHERE id = ?', id)) return fail('NOT_FOUND', 'That record does not exist.', 404);
  await run(env, 'DELETE FROM fleet_maintenance_records WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'fleet_maintenance.delete', entityTable: 'fleet_maintenance_records', entityId: id });
  return new Response(null, { status: 204 });
};
