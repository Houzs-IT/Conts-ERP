import { type Env, all, run, json, fail, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

const MANAGE = ['management', 'operations_manager'];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const rows = await all<any>(env, 'SELECT * FROM automations ORDER BY name');
  return json({
    generatedAt: new Date().toISOString(),
    // Quiet hours are a delivery rule, not a per-rule setting — stated once here
    // so the UI can show it without inventing its own copy.
    quietHours: { from: '22:00', to: '08:00', timezone: 'Asia/Kuala_Lumpur',
      note: 'Non-urgent guest and owner messages queue until 08:00. Check-in risk and payout failure override.' },
    data: rows.map(r => ({
      id: r.id, name: r.name, trigger: r.trigger,
      offsetHours: r.offset_hours, template: r.template, isActive: !!r.is_active,
    })),
  });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MANAGE.includes(session.role)) {
    return fail('FORBIDDEN', 'You can view automations but cannot change them. Ask an operations manager.', 403);
  }

  const { id, isActive } = await request.json<{ id: string; isActive: boolean }>();
  await run(env, 'UPDATE automations SET is_active = ? WHERE id = ?', isActive ? 1 : 0, id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName,
    action: isActive ? 'automation.activate' : 'automation.pause',
    entityTable: 'automations', entityId: id, after: { isActive },
  });
  return json({ ok: true });
};
