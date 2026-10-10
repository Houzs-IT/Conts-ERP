import { type Env, one, json } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** GET /api/notifications/count — the bell's badge: how many of the person's notices are unread. Polled. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  try {
    const r = await one<{ n: number; latest: string | null }>(env,
      'SELECT count(*)::int AS n, max(created_at) AS latest FROM user_notifications WHERE user_id = ? AND read_at IS NULL', session.userId);
    return json({ unread: r?.n ?? 0, latest: r?.latest ?? null });
  } catch {
    return json({ unread: 0, latest: null });
  }
};
