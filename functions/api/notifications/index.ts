import { type Env, all, run, json, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** In-app notifications. The client polls this; the bell badge reads `unread`. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const rows = await all<any>(env, `
    SELECT id, template, entity_table, entity_id, state, error, queued_at, sent_at
    FROM notification_log
    WHERE channel = 'in_app' AND state != 'failed'
    ORDER BY queued_at DESC LIMIT 50`);

  const failed = await all<any>(env, `
    SELECT id, template, recipient, error, queued_at FROM notification_log
    WHERE state = 'failed' ORDER BY queued_at DESC LIMIT 20`);

  return json({
    generatedAt: new Date().toISOString(),
    unread: rows.filter((r: any) => !r.sent_at).length,
    data: rows,
    // A failed send is surfaced, never dropped silently.
    failed: failed.map((f: any) => ({
      id: f.id, template: f.template, recipient: f.recipient,
      error: f.error, queuedAt: f.queued_at,
    })),
  });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const { ids } = await request.json<{ ids: string[] }>();
  if (!ids?.length) return json({ ok: true });
  const ph = ids.map(() => '?').join(',');
  await run(env, `UPDATE notification_log SET sent_at = ? WHERE id IN (${ph})`, nowIso(), ...ids);
  return json({ ok: true, read: ids.length });
};
