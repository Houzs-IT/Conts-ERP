import { type Env, all, one, json, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { MYT_DATE } from '../../_lib/ops';

/** GET /api/field/tasks?date=today — the signed-in person's own jobs for the day (plus anything left over from earlier).
 *  Never carries revenue, fees or payout figures. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;

  const today = (await one<{ d: string }>(env, `SELECT to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') AS d`))!.d;
  const asked = new URL(request.url).searchParams.get('date');
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today;

  const rows = await all<any>(env, `
    SELECT t.id, t.unit_id, t.title, t.state, t.due_at, t.scheduled_for, t.next_guest_at, t.requires_photo, t.sync, t.updated_at,
           u.unit_number, u.readiness, p.name AS property_name, p.address_line,
           (SELECT c.instruction FROM access_credentials c WHERE c.unit_id = u.id ORDER BY c.updated_at DESC LIMIT 1) AS access_instruction,
           (SELECT COUNT(*) FROM documents d WHERE d.task_id = t.id AND d.kind = 'photo') AS photo_count
    FROM tasks t JOIN units u ON u.id = t.unit_id JOIN properties p ON p.id = u.property_id
    WHERE t.assignee_id = ?
      AND (${MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)')} = ? OR (t.state != 'resolved' AND ${MYT_DATE('COALESCE(t.scheduled_for, t.due_at, t.created_at)')} < ?))
    ORDER BY COALESCE(t.due_at, t.scheduled_for, t.created_at)`, session.userId, date, date);

  return json({
    generatedAt: nowIso(), date,
    rows: rows.map(r => {
      const sameDay = r.next_guest_at && r.due_at && r.next_guest_at.slice(0, 10) === r.due_at.slice(0, 10);
      return {
        id: r.id, unitId: r.unit_id,
        unit: { unitNumber: r.unit_number, propertyName: r.property_name },
        addressLine: String(r.address_line ?? '').replace(/[\s,]+$/, ''), accessInstruction: r.access_instruction ?? null,
        work: r.title, dueAt: r.due_at, nextGuestAt: r.next_guest_at,
        readiness: r.readiness, done: r.state === 'resolved', flag: sameDay ? 'Same-day turnaround' : null,
        requiresPhoto: !!r.requires_photo, photoCount: Number(r.photo_count),
        sync: r.state === 'resolved' ? 'synced' : r.sync === 'synced' ? null : r.sync,
        syncedAt: r.state === 'resolved' ? r.updated_at : null,
      };
    }),
  });
};
