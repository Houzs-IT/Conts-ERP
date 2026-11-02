import { type Env, all, one, json, fail, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { channexConfigured } from '../../_lib/channex';
import { THREAD_FROM, THREAD_COLUMNS, threadOut } from '../../_lib/messageThreads';

const PAGE = 40;
const CHANNELS = ['airbnb', 'booking_com', 'agoda', 'direct'];

/** GET /api/messages/threads — conversations across every channel, newest first, a page at a time.
 *    ?cursor=<from the last page>    the next page (40 each)
 *    &q=<text>                       guest name, unit, subject or any message in it
 *    &channel=airbnb|booking_com|agoda|direct   &unitId=<unit>   &unread=1   &kind=inquiry|stay
 *  Each conversation carries its last message only; GET /api/messages/threads/:id has the messages.
 *  `unread` and `units` are over every conversation, whatever the filters, so the tabs and the unit list stay put. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'The inbox is for operations and management.', 403);

  const url = new URL(request.url);
  const where: string[] = [], args: unknown[] = [];
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
    where.push(`(COALESCE(g.full_name, t.guest_name, '') ILIKE ? OR COALESCE(t.subject, '') ILIKE ? OR COALESCE(u.unit_number, '') ILIKE ? OR COALESCE(p.name, '') ILIKE ?
      OR EXISTS (SELECT 1 FROM messages mq WHERE mq.thread_id = t.id AND mq.body ILIKE ?))`);
    args.push(like, like, like, like, like);
  }
  const channel = url.searchParams.get('channel');
  if (channel && CHANNELS.includes(channel)) { where.push('t.channel = ?'); args.push(channel); }
  const unitId = url.searchParams.get('unitId');
  if (unitId) { where.push('COALESCE(r.unit_id, t.unit_id) = ?'); args.push(unitId); }
  if (url.searchParams.get('unread') === '1') where.push('t.is_read = 0');
  const kind = url.searchParams.get('kind');
  if (kind === 'inquiry') where.push('t.reservation_id IS NULL');
  else if (kind === 'stay') where.push('t.reservation_id IS NOT NULL');
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  if (cursor) { where.push('(t.last_message_at, t.id) < (?, ?)'); args.push(cursor.at, cursor.id); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows, totals, units] = await Promise.all([
    all<any>(env, `
      SELECT ${THREAD_COLUMNS},
        lm.body AS last_body, lm.direction AS last_direction, lm.delivery_state AS last_delivery
      ${THREAD_FROM}
      LEFT JOIN LATERAL (SELECT m.body, m.direction, m.delivery_state FROM messages m WHERE m.thread_id = t.id ORDER BY m.sent_at DESC LIMIT 1) lm ON true
      ${cond}
      ORDER BY t.last_message_at DESC, t.id DESC
      LIMIT ?`, ...args, PAGE + 1),
    one<{ n: number; unread: number; inquiries: number }>(env, `
      SELECT count(*)::int AS n, count(*) FILTER (WHERE is_read = 0)::int AS unread, count(*) FILTER (WHERE reservation_id IS NULL)::int AS inquiries FROM message_threads`),
    all<{ id: string; label: string }>(env, `
      SELECT DISTINCT u.id, trim(COALESCE(p.name, '') || ' ' || u.unit_number) AS label
      FROM message_threads t LEFT JOIN reservations r ON r.id = t.reservation_id
      JOIN units u ON u.id = COALESCE(r.unit_id, t.unit_id) LEFT JOIN properties p ON p.id = u.property_id
      ORDER BY label`),
  ]);
  const page = rows.slice(0, PAGE);
  const last = page.at(-1);

  return json({
    generatedAt: nowIso(),
    threads: page.map(t => ({ ...threadOut(t), preview: t.last_body ?? null, lastDirection: t.last_direction ?? null, lastDelivery: t.last_delivery ?? null })),
    nextCursor: rows.length > PAGE && last ? encodeCursor(last.last_message_at, last.id) : null,
    totals: { all: totals?.n ?? 0, unread: totals?.unread ?? 0, inquiries: totals?.inquiries ?? 0 },
    units,
    channexConnected: channexConfigured(env),
  });
};

const encodeCursor = (at: string, id: string) => btoa(JSON.stringify([at, id]));
function decodeCursor(s: string | null): { at: string; id: string } | null {
  if (!s) return null;
  try { const [at, id] = JSON.parse(atob(s)); return typeof at === 'string' && typeof id === 'string' ? { at, id } : null; } catch { return null; }
}
