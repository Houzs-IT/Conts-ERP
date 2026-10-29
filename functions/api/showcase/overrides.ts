import { type Env, json, fail, run, audit, nowIso, transaction } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { isShowcaseKey, readOverrides, showcaseReady, type ShowcaseKey } from '../../_lib/showcase';

/** GET /api/showcase/overrides — the figures Showcase control has replaced, one copy for the company. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  return json({ overrides: await readOverrides(env), ready: await showcaseReady(env) });
};

type Change = { key: ShowcaseKey; value?: number | null; active?: boolean };

/** PUT /api/showcase/overrides — { changes: [{ key, value?, active? }] } or { resetAll: true }.
 *  value: a number stores it (and shows it unless active is false); null clears the figure back to live for good.
 *  active alone switches a stored figure between live and its override. resetAll switches every figure back to live
 *  and keeps the typed values. Writes need Edit on Performance (session middleware). */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await showcaseReady(env))) return fail('NOT_CONFIGURED', 'Showcase control is not set up on this database yet (migration 0164).', 501);

  const body = await request.json().catch(() => null) as { changes?: unknown; resetAll?: unknown } | null;
  const before = await readOverrides(env);
  const stamp = nowIso();

  if (body?.resetAll === true) {
    await run(env, 'UPDATE showcase_overrides SET active = 0, updated_by = ?, updated_at = ? WHERE active = 1', session.userId, stamp);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'showcase.reset', entityTable: 'showcase_overrides', entityId: 'all', before });
    return json({ overrides: await readOverrides(env) });
  }

  if (!Array.isArray(body?.changes) || !body.changes.length || body.changes.length > 40) return fail('VALIDATION', 'Say which figures to change.', 422);
  const changes: Change[] = [];
  for (const c of body.changes as Record<string, unknown>[]) {
    if (!c || !isShowcaseKey(c.key)) return fail('VALIDATION', 'That figure is not on the showcase.', 422);
    if (c.value !== undefined && c.value !== null && !(typeof c.value === 'number' && Number.isFinite(c.value) && c.value >= 0 && c.value < 1e9)) {
      return fail('VALIDATION', 'Enter a number of zero or more.', 422, { [c.key]: 'Enter a number of zero or more.' });
    }
    if (c.active !== undefined && typeof c.active !== 'boolean') return fail('VALIDATION', 'Choose live or override.', 422);
    if (c.value === undefined && c.active === undefined) return fail('VALIDATION', 'Say what to change.', 422);
    if (c.value === undefined && c.active === true && !before[c.key]) return fail('VALIDATION', 'Type a value before switching to the override.', 422, { [c.key]: 'Type a value first.' });
    if (changes.some(x => x.key === c.key)) return fail('VALIDATION', 'Change each figure once per save.', 422);
    changes.push({ key: c.key, value: c.value as number | null | undefined, active: c.active as boolean | undefined });
  }

  // One statement per kind of change, each taking every figure of that kind at once.
  const cleared = changes.filter(c => c.value === null).map(c => c.key);
  const stored = changes.filter(c => typeof c.value === 'number').map(c => ({ key: c.key, value: c.value, active: c.active === false ? 0 : 1 }));
  const switched = changes.filter(c => c.value === undefined).map(c => ({ key: c.key, active: c.active ? 1 : 0 }));
  await transaction(env, async tx => {
    if (cleared.length) await run(tx, 'DELETE FROM showcase_overrides WHERE key IN (SELECT jsonb_array_elements_text(?::text::jsonb))', JSON.stringify(cleared));
    if (stored.length) {
      await run(tx, `
        INSERT INTO showcase_overrides (key, value, active, updated_by, updated_at)
        SELECT x.key, x.value, x.active, ?, ? FROM jsonb_to_recordset(?::text::jsonb) AS x(key text, value float8, active int)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, active = EXCLUDED.active, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
        session.userId, stamp, JSON.stringify(stored));
    }
    if (switched.length) {
      await run(tx, `
        UPDATE showcase_overrides o SET active = x.active, updated_by = ?, updated_at = ?
        FROM jsonb_to_recordset(?::text::jsonb) AS x(key text, active int) WHERE o.key = x.key`,
        session.userId, stamp, JSON.stringify(switched));
    }
  });
  const after = await readOverrides(env);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'showcase.override', entityTable: 'showcase_overrides',
    entityId: changes.map(c => c.key).join(','), before: Object.fromEntries(changes.map(c => [c.key, before[c.key] ?? null])), after: Object.fromEntries(changes.map(c => [c.key, after[c.key] ?? null])),
  });
  return json({ overrides: after });
};
