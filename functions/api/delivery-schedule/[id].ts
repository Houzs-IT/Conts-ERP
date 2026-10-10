import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { deriveStatus, isTimeSlot } from '../../_lib/delivery-schedule';
import { strOrNull, intOrNull } from '../../_lib/scm-util';
import { checkInt, checkDate, checkTime, invalid, type Fields } from '../../_lib/validate';

interface Cur { status: string; planned_date: string | null; driver_id: string | null }

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change the schedule.', 403);
  const id = String(params.id);
  const cur = await one<Cur>(env, 'SELECT status, planned_date, driver_id FROM delivery_schedule WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That schedule entry does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const now = nowIso();
  const action = String(b.action ?? '');

  // ── Status actions (Last Mile + cancel) ──────────────────────────────────
  if (action) {
    if (action === 'dispatch') {
      if (cur.status !== 'SCHEDULED') return fail('CONFLICT', 'Only a scheduled delivery can be dispatched.', 409);
      await run(env, 'UPDATE delivery_schedule SET status = ?, dispatched_at = ?, updated_at = ? WHERE id = ?', 'DISPATCHED', now, now, id);
    } else if (action === 'deliver') {
      if (cur.status !== 'DISPATCHED') return fail('CONFLICT', 'Only a dispatched delivery can be marked delivered.', 409);
      await run(env, 'UPDATE delivery_schedule SET status = ?, delivered_at = ?, updated_at = ? WHERE id = ?', 'DELIVERED', now, now, id);
    } else if (action === 'cancel') {
      if (cur.status === 'DELIVERED') return fail('CONFLICT', 'A delivered entry cannot be cancelled.', 409);
      await run(env, 'UPDATE delivery_schedule SET status = ?, updated_at = ? WHERE id = ?', 'CANCELLED', now, id);
    } else if (action === 'reopen') {
      const next = deriveStatus('UNPLANNED', cur.planned_date, cur.driver_id);
      await run(env, 'UPDATE delivery_schedule SET status = ?, dispatched_at = NULL, delivered_at = NULL, updated_at = ? WHERE id = ?', next, now, id);
    } else return fail('VALIDATION', 'Unknown action.', 422);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: `delivery_schedule.${action}`, entityTable: 'delivery_schedule', entityId: id });
    return json({ id });
  }

  // ── Field edits (Date / Time / Planning) ─────────────────────────────────
  const fields: Fields = {};
  checkDate(fields, 'plannedDate', b.plannedDate, { label: 'Planned date' });
  checkTime(fields, 'plannedTime', b.plannedTime, { label: 'Planned time' });
  checkInt(fields, 'sequenceNo', b.sequenceNo, { label: 'Sequence', min: 0 });
  const bad = invalid(fields); if (bad) return bad;
  const sets: string[] = []; const args: unknown[] = [];
  let nextDate = cur.planned_date, nextDriver = cur.driver_id;
  if (b.plannedDate !== undefined) { nextDate = strOrNull(b.plannedDate); sets.push('planned_date = ?'); args.push(nextDate); }
  if (b.timeSlot !== undefined) { sets.push('time_slot = ?'); args.push(isTimeSlot(b.timeSlot) ? b.timeSlot : null); }
  if (b.plannedTime !== undefined) { sets.push('planned_time = ?'); args.push(strOrNull(b.plannedTime)); }
  if (b.driverId !== undefined) { nextDriver = strOrNull(b.driverId); sets.push('driver_id = ?'); args.push(nextDriver); }
  if (b.vehicleId !== undefined) { sets.push('vehicle_id = ?'); args.push(strOrNull(b.vehicleId)); }
  if (b.sequenceNo !== undefined) { sets.push('sequence_no = ?'); args.push(intOrNull(b.sequenceNo)); }
  if (b.address !== undefined) { sets.push('address = ?'); args.push(strOrNull(b.address)); }
  if (b.zone !== undefined) { sets.push('zone = ?'); args.push(strOrNull(b.zone)); }
  if (b.notes !== undefined) { sets.push('notes = ?'); args.push(strOrNull(b.notes)); }
  if (!sets.length) return json({ id });
  // Re-derive the open/scheduled status from what is now filled.
  const nextStatus = deriveStatus(cur.status, nextDate, nextDriver);
  sets.push('status = ?'); args.push(nextStatus);
  sets.push('updated_at = ?'); args.push(now); args.push(id);
  await run(env, `UPDATE delivery_schedule SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'delivery_schedule.update', entityTable: 'delivery_schedule', entityId: id, after: { status: nextStatus } });
  return json({ id, status: nextStatus });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can remove a schedule entry.', 403);
  const id = String(params.id);
  const cur = await one<{ so_doc_no: string }>(env, 'SELECT so_doc_no FROM delivery_schedule WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That schedule entry does not exist.', 404);
  await run(env, 'DELETE FROM delivery_schedule WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'delivery_schedule.delete', entityTable: 'delivery_schedule', entityId: id, before: { soDocNo: cur.so_doc_no } });
  return new Response(null, { status: 204 });
};
