import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { invalidResRule, toResRulePayload, type ResRuleRow } from '../../_lib/residence-rules';
import { strOrNull, intOrNull, flag } from '../../_lib/scm-util';

const COLS = 'id, building_type, service_duration_minutes, earliest_delivery_time, latest_delivery_time, requires_lift_booking, requires_registration, notes, is_active';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const row = await one<ResRuleRow>(env, `SELECT ${COLS} FROM delivery_residence_rules WHERE id = ?`, String(params.id));
  if (!row) return fail('NOT_FOUND', 'That residence rule does not exist.', 404);
  return json({ data: toResRulePayload(row) });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit residence rules.', 403);
  const id = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM delivery_residence_rules WHERE id = ?', id)) return fail('NOT_FOUND', 'That residence rule does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  if (b.buildingType !== undefined || b.earliestDeliveryTime !== undefined || b.latestDeliveryTime !== undefined) {
    const bad = invalidResRule({ buildingType: b.buildingType ?? 'x', earliestDeliveryTime: b.earliestDeliveryTime, latestDeliveryTime: b.latestDeliveryTime });
    if (bad && bad.field !== 'buildingType') return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });
  }
  const sets: string[] = []; const args: unknown[] = [];
  if (b.buildingType !== undefined) { const t = String(b.buildingType).trim(); if (!t) return fail('VALIDATION', 'Enter a building type.', 422, { buildingType: 'Enter a building type.' }); if (await one(env, 'SELECT 1 AS x FROM delivery_residence_rules WHERE lower(building_type)=lower(?) AND id<>?', t, id)) return fail('CONFLICT', 'A rule for that building type already exists.', 409, { buildingType: 'This building type already has a rule.' }); sets.push('building_type = ?'); args.push(t); }
  if (b.serviceDurationMinutes !== undefined) { sets.push('service_duration_minutes = ?'); args.push(Math.max(0, intOrNull(b.serviceDurationMinutes) ?? 0)); }
  if (b.earliestDeliveryTime !== undefined) { sets.push('earliest_delivery_time = ?'); args.push(strOrNull(b.earliestDeliveryTime)); }
  if (b.latestDeliveryTime !== undefined) { sets.push('latest_delivery_time = ?'); args.push(strOrNull(b.latestDeliveryTime)); }
  if (b.requiresLiftBooking !== undefined) { sets.push('requires_lift_booking = ?'); args.push(flag(b.requiresLiftBooking) ?? 0); }
  if (b.requiresRegistration !== undefined) { sets.push('requires_registration = ?'); args.push(flag(b.requiresRegistration) ?? 0); }
  if (b.notes !== undefined) { sets.push('notes = ?'); args.push(strOrNull(b.notes)); }
  if (b.isActive !== undefined) { sets.push('is_active = ?'); args.push(flag(b.isActive) ?? 1); }
  if (!sets.length) return json({ id });
  sets.push('updated_at = ?'); args.push(nowIso()); args.push(id);
  await run(env, `UPDATE delivery_residence_rules SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'residence_rule.update', entityTable: 'delivery_residence_rules', entityId: id, after: b });
  return json({ id });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete residence rules.', 403);
  const id = String(params.id);
  const cur = await one<{ building_type: string }>(env, 'SELECT building_type FROM delivery_residence_rules WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That residence rule does not exist.', 404);
  await run(env, 'DELETE FROM delivery_residence_rules WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'residence_rule.delete', entityTable: 'delivery_residence_rules', entityId: id, before: { buildingType: cur.building_type } });
  return new Response(null, { status: 204 });
};
