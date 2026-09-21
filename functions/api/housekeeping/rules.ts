import { type Env, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** PUT /api/housekeeping/rules { rule } — how cleaning is sequenced and auto-assigned. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!['management', 'operations_manager'].includes(session.role)) return fail('FORBIDDEN', 'Only operations managers and management can change the rule.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!['earliest_checkin', 'building', 'manual'].includes(b?.rule)) return fail('VALIDATION', 'Pick a valid ordering rule.', 422);

  await run(env, `
    INSERT INTO settings (key, value, updated_at) VALUES ('housekeeping.ordering_rule', ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, b.rule, nowIso());
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'housekeeping.rule', entityTable: 'settings', entityId: 'housekeeping.ordering_rule', after: { rule: b.rule } });
  return json({ ok: true });
};
