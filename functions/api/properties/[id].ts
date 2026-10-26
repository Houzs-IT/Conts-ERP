import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, hasColumn } from '../../_lib/auth';

/** PATCH /api/properties/:id { name, city, state, fullAccessCard? } — correct a building's name or location, and say
 *  whether its card alone opens the lobby, lift and car park (0147). */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can edit buildings.', 403);

  const id = String(params.id);
  const cur = await one<{ id: string; name: string; city: string; state: string }>(env, 'SELECT id, name, city, state FROM properties WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That building does not exist.', 404);
  const b = await request.json<any>().catch(() => null);
  const name = String(b?.name ?? cur.name).trim(), city = String(b?.city ?? cur.city).trim(), state = String(b?.state ?? cur.state).trim();
  if (!name) return fail('VALIDATION', 'Enter the building name.', 422, { name: 'Enter the building name.' });
  if (!state) return fail('VALIDATION', 'Pick a state.', 422, { state: 'Pick a state.' });
  if (await one(env, 'SELECT 1 AS x FROM properties WHERE lower(name) = lower(?) AND id <> ?', name, id)) return fail('CONFLICT', 'A building with that name already exists.', 409, { name: 'That name is taken.' });

  await run(env, 'UPDATE properties SET name = ?, city = ?, state = ?, updated_at = ? WHERE id = ?', name, city, state, nowIso(), id);
  const card = typeof b?.fullAccessCard === 'boolean' && (await hasColumn(env, 'properties', 'full_access_card').catch(() => false)) ? b.fullAccessCard as boolean : undefined;
  if (card !== undefined) await run(env, 'UPDATE properties SET full_access_card = ? WHERE id = ?', card, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'property.update', entityTable: 'properties', entityId: id, before: { name: cur.name, city: cur.city, state: cur.state }, after: { name, city, state, ...(card !== undefined ? { fullAccessCard: card } : {}) } });
  return json({ ok: true });
};

/** DELETE /api/properties/:id — only a building with no units; units are removed or moved first. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can delete buildings.', 403);

  const id = String(params.id);
  const cur = await one<{ name: string }>(env, 'SELECT name FROM properties WHERE id = ?', id);
  if (!cur) return fail('NOT_FOUND', 'That building does not exist.', 404);
  const units = await one<{ n: number }>(env, 'SELECT count(*)::int AS n FROM units WHERE property_id = ?', id);
  if (Number(units?.n) > 0) return fail('HAS_UNITS', `${cur.name} still has ${units!.n} unit${Number(units!.n) === 1 ? '' : 's'}. Move or remove them first.`, 409);

  await run(env, 'DELETE FROM properties WHERE id = ?', id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'property.delete', entityTable: 'properties', entityId: id, before: { name: cur.name } });
  return json({ ok: true });
};
