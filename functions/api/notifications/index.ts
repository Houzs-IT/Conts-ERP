import { type Env, all, one, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

export interface NoticeRow {
  id: string; kind: string; title: string; body: string | null; link: string | null;
  entity_table: string | null; entity_id: string | null; read_at: string | null; created_at: string;
}

export const toNotice = (r: NoticeRow) => ({
  id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link,
  entityTable: r.entity_table, entityId: r.entity_id, readAt: r.read_at, createdAt: r.created_at,
});

/** Before migration 0095 the table is missing; the bell then shows nothing instead of an error on every page. */
const missing = (e: unknown) => /user_notifications/.test(e instanceof Error ? e.message : String(e));

/** GET /api/notifications?unread=1&page=1&pageSize=20 — the signed-in person's own notices, newest first,
 *  with how many are unread. Nobody can read anyone else's. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get('unread') === '1';
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get('pageSize')) || 20)));
  try {
    const [rows, counts] = await Promise.all([
      all<NoticeRow>(env, `
        SELECT id, kind, title, body, link, entity_table, entity_id, read_at, created_at FROM user_notifications
        WHERE user_id = ? ${unreadOnly ? 'AND read_at IS NULL' : ''}
        ORDER BY created_at DESC, id LIMIT ? OFFSET ?`, session.userId, pageSize, (page - 1) * pageSize),
      one<{ total: number; unread: number }>(env, `
        SELECT count(*)::int AS total, count(*) FILTER (WHERE read_at IS NULL)::int AS unread FROM user_notifications WHERE user_id = ?`, session.userId),
    ]);
    return json({
      page, pageSize, total: unreadOnly ? counts?.unread ?? 0 : counts?.total ?? 0, unread: counts?.unread ?? 0,
      data: rows.map(toNotice),
    });
  } catch (e) {
    if (missing(e)) return json({ page, pageSize, total: 0, unread: 0, data: [] });
    throw e;
  }
};

/** PATCH /api/notifications { ids } marks those of the person's own notices read; { all: true } marks every one. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const b = await request.json<{ ids?: unknown; all?: unknown }>().catch(() => null);
  if (b?.all === true) {
    const r = await all<{ id: string }>(env, 'UPDATE user_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL RETURNING id', nowIso(), session.userId);
    return json({ ok: true, read: r.length, unread: 0 });
  }
  return markRead(env, session.userId, b?.ids);
};

/** Reading a notice is the person's own view state, not a change to a business record, so it is not audited. */
async function markRead(env: Env, userId: string, ids: unknown) {
  if (!Array.isArray(ids) || !ids.every(i => typeof i === 'string')) return fail('VALIDATION', 'Say which notices to mark read.', 422);
  if (!ids.length) return json({ ok: true, read: 0 });
  if (ids.length > 500) return fail('VALIDATION', 'Mark at most 500 notices at once.', 422);
  const r = await all<{ id: string }>(env, `
    UPDATE user_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
    RETURNING id`, nowIso(), userId, JSON.stringify(ids));
  const left = await one<{ n: number }>(env, 'SELECT count(*)::int AS n FROM user_notifications WHERE user_id = ? AND read_at IS NULL', userId);
  return json({ ok: true, read: r.length, unread: left?.n ?? 0 });
}

