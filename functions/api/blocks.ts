import { type Env, one, run, json, fail, audit, nowIso } from '../_lib/db';
import { requireSession, isFieldRole } from '../_lib/auth';
import { findClash, clashResponseBody } from '../_lib/reservations';

/** POST /api/blocks { unitId, from, to, reason } — takes the dates off sale on every channel. `to` is the check-out day. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot block dates.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!b?.unitId || !b.from || !b.to) return fail('VALIDATION', 'Unit and dates are required.', 422);
  if (b.to <= b.from) return fail('VALIDATION', 'The end date must be after the start date.', 422, { to: 'Pick a later end date.' });
  if (!(await one(env, 'SELECT 1 AS x FROM units WHERE id = ?', b.unitId))) return fail('NOT_FOUND', 'That unit does not exist.', 404);

  const clash = await findClash(env, b.unitId, b.from, b.to, null);
  if (clash) return json(clashResponseBody(clash), 409);

  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `
    INSERT INTO reservations (id, unit_id, channel, state, check_in, check_out, guests_count, gross_booking_value, currency, notes, created_at, updated_at)
    VALUES (?, ?, 'maintenance_block', 'confirmed', ?, ?, 0, 0, 'MYR', ?, ?, ?)`,
    id, b.unitId, b.from, b.to, String(b.reason ?? 'Blocked').slice(0, 200), now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'unit.block', entityTable: 'units', entityId: b.unitId, after: { from: b.from, to: b.to, reason: b.reason ?? null } });
  return json({ id }, 201);
};
