import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { maySee } from '../../_lib/access';
import { layoutKeyOf } from '../../_lib/layoutTypes';
import { bedSizes, bedSizesReady } from '../../_lib/bedSizes';

/** GET /api/unit-bed-sizes — the bed size list, hidden sizes too (owner, 4 Nov 2026). `ready` is false before
 *  migration 0210: the fixed list is returned and it cannot be changed. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!maySee(session, ['management'])) return fail('FORBIDDEN', 'Unit records are visible to people with Units access.', 403);
  return json({ ready: await bedSizesReady(env), mayEdit: !!session.manage, data: await bedSizes(env) });
};

/** POST /api/unit-bed-sizes { label } — a new bed size, listed last. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change the bed size list.', 403);
  if (!(await bedSizesReady(env))) return fail('NOT_READY', 'The bed size list cannot be changed on this database yet.', 409);

  const b = await request.json<{ label?: unknown }>().catch(() => null);
  const label = String(b?.label ?? '').trim();
  if (!label || label.length > 60) return fail('VALIDATION', 'Enter a name of up to 60 characters.', 422, { label: 'Enter a name of up to 60 characters.' });
  const key = layoutKeyOf(label);
  if (!key) return fail('VALIDATION', 'Use letters or numbers in the name.', 422, { label: 'Use letters or numbers.' });
  if (await one(env, 'SELECT 1 AS x FROM unit_bed_sizes WHERE key = ? OR lower(btrim(label)) = lower(?)', key, label)) {
    return fail('CONFLICT', 'That bed size is already on the list.', 409, { label: 'Already on the list. Show it again if it is hidden.' });
  }
  const next = await one<{ n: number }>(env, 'SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM unit_bed_sizes');
  const now = nowIso();
  await run(env, 'INSERT INTO unit_bed_sizes (key, label, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, true, ?, ?)',
    key, label, Number(next?.n ?? 10), now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'unit_bed_size.create', entityTable: 'unit_bed_sizes', entityId: key, after: { label } });
  return json({ key }, 201);
};
