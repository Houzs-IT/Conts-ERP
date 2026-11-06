import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { bedSizesReady } from '../../_lib/bedSizes';

/** PATCH /api/unit-bed-sizes/:key { label?, isActive? } — rename a bed size, or hide / show it. A hidden size is not
 *  offered for units any more, but the units that have it keep it. The key never changes: units.beds holds it. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change the bed size list.', 403);
  if (!(await bedSizesReady(env))) return fail('NOT_READY', 'The bed size list cannot be changed on this database yet.', 409);

  const key = String(params.key);
  const cur = await one<{ key: string; label: string; is_active: boolean }>(env, 'SELECT key, label, is_active FROM unit_bed_sizes WHERE key = ?', key);
  if (!cur) return fail('NOT_FOUND', 'That bed size is not on the list.', 404);
  const b = await request.json<{ label?: unknown; isActive?: unknown }>().catch(() => null);
  const label = b?.label === undefined ? cur.label : String(b.label).trim();
  if (!label || label.length > 60) return fail('VALIDATION', 'Enter a name of up to 60 characters.', 422, { label: 'Enter a name of up to 60 characters.' });
  const isActive = typeof b?.isActive === 'boolean' ? b.isActive : cur.is_active;
  if (await one(env, 'SELECT 1 AS x FROM unit_bed_sizes WHERE lower(btrim(label)) = lower(?) AND key <> ?', label, key)) {
    return fail('CONFLICT', 'Another bed size has that name.', 409, { label: 'Another bed size has that name.' });
  }

  await run(env, 'UPDATE unit_bed_sizes SET label = ?, is_active = ?, updated_at = ? WHERE key = ?', label, isActive, nowIso(), key);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'unit_bed_size.update', entityTable: 'unit_bed_sizes', entityId: key,
    before: { label: cur.label, isActive: cur.is_active }, after: { label, isActive } });
  return json({ ok: true });
};
