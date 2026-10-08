import { type Env, run, json, fail, audit, nowIso } from '../_lib/db';
import { requireSession, isFieldRole } from '../_lib/auth';
import { findClash, clashResponseBody } from '../_lib/reservations';
import { resolveUnit } from '../_lib/ops';
import { syncAvailabilityIfLinked, channexMappingFor } from '../_lib/channexSync';
import { channexConfigured } from '../_lib/channex';

/** POST /api/blocks { unitId, from, to, reason, issueId? } — takes a unit off sale.
 *  With dates it also holds them on the calendar (`to` is the check-out day). With only an issueId (from a
 *  maintenance job) it marks the unit and the job as blocking, with no calendar dates yet. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot block dates.', 403);

  const b = await request.json<any>().catch(() => null);
  const unit = await resolveUnit(env, b?.unitId, b?.propertyName);
  if (unit === 'ambiguous') return fail('VALIDATION', 'More than one unit has that number. Say which building.', 422);
  if (!unit) return fail('NOT_FOUND', 'That unit does not exist.', 404);

  const now = nowIso();
  let id: string | null = null;
  if (b.from || b.to) {
    if (!b.from || !b.to) return fail('VALIDATION', 'Give both dates.', 422);
    if (b.to <= b.from) return fail('VALIDATION', 'The end date must be after the start date.', 422, { to: 'Pick a later end date.' });
    const clash = await findClash(env, unit.id, b.from, b.to, null);
    if (clash) return json(clashResponseBody(clash), 409);
    id = crypto.randomUUID();
    await run(env, `
      INSERT INTO reservations (id, unit_id, channel, state, check_in, check_out, guests_count, gross_booking_value, currency, notes, created_at, updated_at)
      VALUES (?, ?, 'maintenance_block', 'confirmed', ?, ?, 0, 0, 'MYR', ?, ?, ?)`,
      id, unit.id, b.from, b.to, String(b.reason ?? 'Blocked').slice(0, 200), now, now);
  } else if (!b.issueId) {
    return fail('VALIDATION', 'Give the dates to block.', 422);
  }

  if (b.issueId) {
    await run(env, `UPDATE maintenance_issues SET blocks_unit = 1, blocked_from = COALESCE(blocked_from, ?), updated_at = ? WHERE id = ? AND unit_id = ?`, b.from ?? now.slice(0, 10), now, String(b.issueId), unit.id);
    await run(env, `UPDATE units SET readiness = 'maintenance', updated_at = ? WHERE id = ?`, now, unit.id);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'unit.block', entityTable: 'units', entityId: unit.id, after: { from: b.from ?? null, to: b.to ?? null, reason: b.reason ?? null, issueId: b.issueId ?? null } });
  // Says whether the channels were told, so the screen does not claim it when the unit is not linked.
  let channel: 'queued' | 'not_linked' | 'failed' | null = null;
  if (b.from && b.to) {
    try {
      if (!channexConfigured(env) || !(await channexMappingFor(env, unit.id))) channel = 'not_linked';
      else { await syncAvailabilityIfLinked(env, unit.id, b.from, b.to, false); channel = 'queued'; }
    } catch { channel = 'failed'; }
  }
  return json({ id, unitId: unit.id, effects: { channel } }, 201);
};
