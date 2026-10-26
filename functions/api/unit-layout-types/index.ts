import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { maySee } from '../../_lib/access';
import { layoutTypes, layoutTypesReady, layoutKeyOf } from '../../_lib/layoutTypes';

/** GET /api/unit-layout-types — the unit Type list, hidden types too (staff sheet UNIT, 26 Oct 2026). `ready` is false
 *  before migration 0147: the fixed list is returned and it cannot be changed. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!maySee(session, ['management'])) return fail('FORBIDDEN', 'Unit records are visible to people with Units access.', 403);
  return json({ ready: await layoutTypesReady(env), mayEdit: !!session.manage, data: await layoutTypes(env) });
};

/** POST /api/unit-layout-types { label } — a new Type, listed before Other. It gets its own row in the cleaning price grid. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only management, finance and operations managers can change the Type list.', 403);
  if (!(await layoutTypesReady(env))) return fail('NOT_READY', 'The Type list cannot be changed on this database yet.', 409);

  const b = await request.json<{ label?: unknown }>().catch(() => null);
  const label = String(b?.label ?? '').trim();
  if (!label || label.length > 60) return fail('VALIDATION', 'Enter a name of up to 60 characters.', 422, { label: 'Enter a name of up to 60 characters.' });
  const key = layoutKeyOf(label);
  if (!key) return fail('VALIDATION', 'Use letters or numbers in the name.', 422, { label: 'Use letters or numbers.' });
  if (await one(env, 'SELECT 1 AS x FROM unit_layout_types WHERE key = ? OR lower(btrim(label)) = lower(?)', key, label)) {
    return fail('CONFLICT', 'That Type is already on the list.', 409, { label: 'Already on the list. Show it again if it is hidden.' });
  }
  const next = await one<{ n: number }>(env, "SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM unit_layout_types WHERE key <> 'other'");
  const now = nowIso();
  await run(env, 'INSERT INTO unit_layout_types (key, label, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, true, ?, ?)',
    key, label, Math.min(Number(next?.n ?? 10), 999), now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'unit_layout_type.create', entityTable: 'unit_layout_types', entityId: key, after: { label } });
  return json({ key }, 201);
};
