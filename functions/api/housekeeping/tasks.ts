import { type Env, all, one, json, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { MYT_DATE, hhmm, linenSet } from '../../_lib/ops';

/** GET /api/housekeeping/tasks?date=YYYY-MM-DD | from..to — the cleaning roster.
 *  When the range starts today, cleaning left over from earlier days is included until it is done. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const today = (await one<{ d: string }>(env, `SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS d`))!.d;
  const raw = new URL(request.url).searchParams.get('date') ?? today;
  const [from, to = from] = raw.split('..');

  const mine = isFieldRole(session.role);
  const when = MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)');
  const rows = await all<any>(env, `
    SELECT t.id, t.state, t.title, t.instructions, t.scheduled_for, t.due_at, t.next_guest_at, t.requires_photo, t.assignee_id,
           u.unit_number, u.readiness, u.bedrooms, p.name AS property_name,
           COALESCE(a.full_name, '') AS assignee_name,
           COALESCE(r.external_ref, 'Manual') AS source_ref,
           (SELECT COUNT(*) FROM documents d WHERE d.task_id = t.id AND d.kind = 'photo') AS photo_count
    FROM tasks t
    JOIN units u ON u.id = t.unit_id
    JOIN properties p ON p.id = u.property_id
    LEFT JOIN users a ON a.id = t.assignee_id
    LEFT JOIN reservations r ON r.id = t.reservation_id
    WHERE t.kind IN ('turnover','deep_clean','light_clean')
      AND ((${when} BETWEEN ? AND ?) OR (? = ? AND ${when} < ? AND t.state != 'resolved'))
      ${mine ? 'AND t.assignee_id = ?' : ''}
    ORDER BY COALESCE(t.scheduled_for, t.due_at, t.created_at)`,
    ...[from, to, from, today, from, ...(mine ? [session.userId] : [])]);

  return json({
    generatedAt: nowIso(), date: from,
    rows: rows.map((r, i) => ({
      id: r.id, unitNumber: r.unit_number, propertyName: r.property_name, sourceRef: r.source_ref,
      title: r.title, linenSet: linenSet(Number(r.bedrooms)), instructions: r.instructions,
      scheduledFor: hhmm(r.scheduled_for), dueAt: hhmm(r.due_at), nextGuestAt: hhmm(r.next_guest_at),
      assigneeId: r.assignee_id, assigneeName: r.assignee_name || null,
      sequence: i + 1, state: r.state, readiness: r.readiness,
      requiresPhoto: !!r.requires_photo, photoCount: Number(r.photo_count),
    })),
  });
};
