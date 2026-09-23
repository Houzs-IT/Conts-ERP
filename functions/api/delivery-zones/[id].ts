import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MASTER_ROLES } from '../../_lib/properties';
import { invalidZone } from '../../_lib/delivery-zones';
import { strOrNull, flag } from '../../_lib/scm-util';

/** PATCH /api/delivery-zones/:id — edit a prefix rule (zone, range, label, active). */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit the zone map.', 403);
  const id = String(params.id);
  if (!await one(env, 'SELECT 1 AS x FROM delivery_zone_postcodes WHERE id = ?', id)) return fail('NOT_FOUND', 'That zone rule does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  // When zone/prefixes are present, validate the full trio together.
  if (b.zone !== undefined || b.prefixStart !== undefined || b.prefixEnd !== undefined) {
    const bad = invalidZone({ zone: b.zone, prefixStart: b.prefixStart, prefixEnd: b.prefixEnd });
    if (bad) return fail('VALIDATION', bad.message, 422, { [bad.field]: bad.message });
  }
  const sets: string[] = []; const args: unknown[] = [];
  if (b.zone !== undefined) { sets.push('zone = ?'); args.push((b.zone as string).trim()); }
  if (b.prefixStart !== undefined) { sets.push('prefix_start = ?'); args.push(Number(b.prefixStart)); }
  if (b.prefixEnd !== undefined) { sets.push('prefix_end = ?'); args.push(Number(b.prefixEnd)); }
  if (b.label !== undefined) { sets.push('label = ?'); args.push(strOrNull(b.label)); }
  if (b.isActive !== undefined) { sets.push('is_active = ?'); args.push(flag(b.isActive) ?? 1); }
  if (!sets.length) return json({ id });
  sets.push('updated_at = ?'); args.push(nowIso()); args.push(id);
  await run(env, `UPDATE delivery_zone_postcodes SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'delivery_zone.update', entityTable: 'delivery_zone_postcodes', entityId: id, after: b });
  return json({ id });
};

/** DELETE /api/delivery-zones/:id — remove a prefix rule. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MASTER_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit the zone map.', 403);
  const id = String(params.id);
  const cur = await one<{ zone: string }>(env, 'SELECT zone FROM delivery_zone_postcodes WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That zone rule does not exist.', 404);
  await run(env, 'DELETE FROM delivery_zone_postcodes WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'delivery_zone.delete', entityTable: 'delivery_zone_postcodes', entityId: id, before: { zone: cur.zone } });
  return new Response(null, { status: 204 });
};
