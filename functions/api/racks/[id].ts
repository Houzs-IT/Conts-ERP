import { type Env, one, run, json, fail, nowIso, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { strOrNull, flag } from '../../_lib/scm-util';

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit racks.', 403);
  const id = String(params.id);
  const cur = await one<{ warehouse_id: string }>(env, 'SELECT warehouse_id FROM warehouse_racks WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That rack does not exist.', 404);
  const b = await request.json<Record<string, unknown>>().catch(() => null) ?? {};
  const sets: string[] = []; const args: unknown[] = [];
  if (b.rack !== undefined) { const rk = String(b.rack).trim(); if (!rk) return fail('VALIDATION', 'Enter a rack code.', 422, { rack: 'Enter a rack code.' }); if (await one(env, 'SELECT 1 AS x FROM warehouse_racks WHERE warehouse_id = ? AND lower(rack)=lower(?) AND id<>?', cur.warehouse_id, rk, id)) return fail('CONFLICT', 'That rack already exists in this warehouse.', 409, { rack: 'This rack code is already used here.' }); sets.push('rack = ?'); args.push(rk); }
  if (b.position !== undefined) { sets.push('position = ?'); args.push(strOrNull(b.position)); }
  if (b.status !== undefined) { sets.push('status = ?'); args.push(b.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'); }
  if (b.reserved !== undefined) { sets.push('reserved = ?'); args.push(flag(b.reserved) ?? 0); }
  if (b.notes !== undefined) { sets.push('notes = ?'); args.push(strOrNull(b.notes)); }
  if (!sets.length) return json({ id });
  sets.push('updated_at = ?'); args.push(nowIso()); args.push(id);
  await run(env, `UPDATE warehouse_racks SET ${sets.join(', ')} WHERE id = ?`, ...args);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'rack.update', entityTable: 'warehouse_racks', entityId: id, after: b });
  return json({ id });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete racks.', 403);
  const id = String(params.id);
  const cur = await one<{ rack: string }>(env, 'SELECT rack FROM warehouse_racks WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That rack does not exist.', 404);
  await run(env, 'DELETE FROM warehouse_racks WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'rack.delete', entityTable: 'warehouse_racks', entityId: id, before: { rack: cur.rack } });
  return new Response(null, { status: 204 });
};
